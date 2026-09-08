import assert from "node:assert/strict";
import fs from "node:fs";
import { generateKeyPairSync, verify } from "node:crypto";
import { NextRequest } from "next/server";
import { isolatedSqlite } from "./isolatedSqlite";

async function main() {
  const database = isolatedSqlite("docusign-connection.db");
  database.pushSchema(fs.readFileSync("prisma/schema.prisma", "utf8"), "current-schema.prisma");
  const names = ["DATABASE_URL", "SESSION_SECRET", "DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY", "DOCUSIGN_BASE_PATH"];
  const previous = names.map(key => [key, process.env[key]] as const);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, {
    DATABASE_URL: database.databaseUrl, SESSION_SECRET: "synthetic-connection-test",
    DOCUSIGN_INTEGRATION_KEY: "synthetic-integration", DOCUSIGN_USER_ID: "synthetic-user", DOCUSIGN_ACCOUNT_ID: "synthetic-account",
    DOCUSIGN_PRIVATE_KEY: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), DOCUSIGN_BASE_PATH: "https://demo.docusign.net/restapi",
  });
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  let oauthError: { error: string; error_description?: string } | null = null;
  let info: Record<string, unknown>;
  let infoHttp = 200;
  let timeout = false;
  const reset = () => {
    oauthError = null; infoHttp = 200; timeout = false; calls.length = 0;
    process.env.DOCUSIGN_BASE_PATH = "https://demo.docusign.net/restapi";
    info = { sub: "synthetic-user", accounts: [{ account_id: "synthetic-account", account_name: "Synthetic test organization", base_uri: "https://demo.docusign.net", is_default: false }] };
  };
  reset();
  // Every call is intercepted. Any document/envelope request fails the test.
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    assert.match(url, /^https:\/\/account(-d)?\.docusign\.com\/oauth\/(token|userinfo)$/);
    assert.equal(init?.redirect, "error"); assert(init?.signal);
    if (timeout) throw new DOMException("synthetic secret upstream detail", "TimeoutError");
    if (url.endsWith("/token")) {
      assert.equal(init?.method, "POST");
      const form = new URLSearchParams(String(init?.body));
      const jwt = form.get("assertion")!.split(".");
      assert(verify("RSA-SHA256", Buffer.from(`${jwt[0]}.${jwt[1]}`), rsa.publicKey, Buffer.from(jwt[2], "base64url")));
      const claims = JSON.parse(Buffer.from(jwt[1], "base64url").toString());
      assert.equal(claims.aud, new URL(url).host); assert.equal(claims.scope, "signature impersonation");
      return Response.json(oauthError || { access_token: "synthetic-token-never-exposed" }, { status: oauthError ? 400 : 200 });
    }
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-token-never-exposed");
    return Response.json(infoHttp === 200 ? info : { secret: "synthetic secret upstream detail" }, { status: infoHttp });
  };
  const { prisma } = await import("../src/lib/prisma");
  const { bindTestCookies } = await import("../src/lib/requestCookies");
  const { createSessionValue, SESSION_COOKIE } = await import("../src/lib/auth");
  const { checkDocuSignConnection, docuSignConnectionConfiguration, docusignConfigured, checkDocuSignStatus } = await import("../src/lib/docusign");
  const { GET, POST } = await import("../src/app/api/admin/docusign/connection/route");
  const post = (origin = "https://smart.example") => POST(new NextRequest("https://smart.example/api/admin/docusign/connection", { method: "POST", headers: { origin } }));
  const check = async () => {
    const result = await checkDocuSignConnection();
    assert(!JSON.stringify(result).includes("synthetic-token-never-exposed"));
    assert(!JSON.stringify(result).includes("synthetic secret upstream detail"));
    assert(!JSON.stringify(result).includes("PRIVATE KEY"));
    assert(!JSON.stringify(result).includes("synthetic-user"));
    return result;
  };
  try {
    assert.equal(docuSignConnectionConfiguration().status, "not_checked"); assert.equal(calls.length, 0);
    const connected = await check(); assert.equal(connected.status, "connected"); assert.equal(connected.environment, "sandbox"); assert(connected.checkedAt); assert.equal(calls.length, 2);
    reset(); process.env.DOCUSIGN_BASE_PATH = "https://na4.docusign.net/restapi/";
    info = { sub: "synthetic-user", accounts: [{ account_id: "synthetic-account", base_uri: "https://na4.docusign.net" }] };
    assert.equal((await check()).environment, "production"); assert(calls.every(url => !url.includes("account-d")));
    reset(); process.env.DOCUSIGN_BASE_PATH = " ";
    const auto = await check(); assert.equal(auto.status, "connected"); assert.equal(auto.environment, "sandbox"); assert.equal(calls.length, 4);
    reset(); process.env.DOCUSIGN_USER_ID = " ";
    assert.equal(docusignConfigured(), false); assert.equal((await check()).status, "needs_setup"); assert.equal(calls.length, 0); process.env.DOCUSIGN_USER_ID = "synthetic-user";
    reset(); oauthError = { error: "consent_required", error_description: "synthetic secret upstream detail" };
    assert.match((await check()).message, /consent is required/); assert.equal(calls.length, 1);
    reset(); oauthError = { error: "invalid_grant", error_description: "issuer_not_found" }; assert.match((await check()).message, /go-live/);
    reset(); oauthError = { error: "invalid_grant", error_description: "user_not_found" }; assert.match((await check()).message, /user was not found/);
    reset(); oauthError = { error: "unknown", error_description: "synthetic secret upstream detail" }; assert.equal((await check()).status, "failed");
    reset(); infoHttp = 500; assert.match((await check()).message, /HTTP 500/);
    reset(); timeout = true; assert.equal((await check()).status, "failed");
    reset(); info = { sub: "different-user", accounts: [] }; assert.match((await check()).message, /authenticated user/);
    reset(); info = { sub: "synthetic-user", accounts: [{ account_id: "other-account", is_default: true, base_uri: "https://demo.docusign.net" }] };
    assert.match((await check()).message, /not accessible/);
    process.env.DOCUSIGN_BASE_PATH = ""; calls.length = 0;
    await assert.rejects(() => checkDocuSignStatus("synthetic-never-requested"), /userinfo did not include a REST base URI/);
    assert.equal(calls.length, 4, "Normal API discovery must not fall back to a different default account");
    reset(); process.env.DOCUSIGN_BASE_PATH = ""; infoHttp = 500;
    await assert.rejects(() => checkDocuSignStatus("synthetic-never-requested"), error => error instanceof Error && /HTTP 500/.test(error.message) && !error.message.includes("synthetic secret"));
    reset(); info = { sub: "synthetic-user", accounts: [{ account_id: "synthetic-account", base_uri: "https://na4.docusign.net" }] };
    assert.match((await check()).message, /unexpected account server/);
    reset(); process.env.DOCUSIGN_BASE_PATH = "https://na3.docusign.net/restapi";
    info = { sub: "synthetic-user", accounts: [{ account_id: "synthetic-account", base_uri: "https://na4.docusign.net" }] };
    assert.match((await check()).message, /does not match/);
    for (const invalid of ["https://docusign.net.attacker.invalid/restapi", "http://demo.docusign.net/restapi", "https://demo.docusign.net/restapi?key=secret", "https://user:pass@demo.docusign.net/restapi", "https://demo.docusign.net:8443/restapi"]) {
      reset(); process.env.DOCUSIGN_BASE_PATH = invalid; assert.equal((await check()).status, "failed"); assert.equal(calls.length, 0);
    }
    reset();
    const master = await prisma.user.create({ data: { email: "master@example.invalid", name: "Synthetic master", role: "master", passwordHash: "unused" } });
    const staff = await prisma.user.create({ data: { email: "staff@example.invalid", name: "Synthetic staff", role: "staff", passwordHash: "unused" } });
    bindTestCookies({ get: () => undefined }); assert.equal((await GET()).status, 401); assert.equal((await post()).status, 401);
    const login = (user: typeof master) => bindTestCookies({ get: key => key === SESSION_COOKIE ? { value: createSessionValue(user.id) } : undefined });
    login(staff); assert.equal((await GET()).status, 403); assert.equal((await post()).status, 403);
    login(master); const config = await GET(); assert.equal(config.status, 200); assert.equal(config.headers.get("Cache-Control"), "no-store"); assert.equal((await config.json()).status, "not_checked");
    assert.equal((await post("https://unrelated.example")).status, 403); assert.equal(calls.length, 0);
    assert.equal((await post("null")).status, 403); assert.equal(calls.length, 0);
    const response = await post(); assert.equal(response.status, 200); assert.equal((await response.json()).status, "connected"); assert.equal(response.headers.get("Cache-Control"), "no-store");
    const proxied = await POST(new NextRequest("http://localhost:10000/api/admin/docusign/connection", { method: "POST", headers: { origin: "https://smart.example", host: "smart.example" } }));
    assert.equal(proxied.status, 200); assert.equal((await proxied.json()).status, "connected");
    assert.equal(await prisma.intake.count(), 0); assert.equal(await prisma.messageDelivery.count(), 0); assert.equal(await prisma.auditLog.count(), 0);
    console.log("DocuSign connection checks passed: signed JWT, sandbox/live/automatic, missing settings, consent and key errors, timeouts, exact user/account/server match, host validation, redaction, master-only access and no envelope or delivery actions.");
  } finally {
    bindTestCookies(null); globalThis.fetch = realFetch; await prisma.$disconnect();
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    database.cleanup();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
