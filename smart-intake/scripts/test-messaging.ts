import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { sendClientLinkSms } from "../src/lib/notify";

async function main() {
  assert.equal(process.env.DATABASE_URL, "file:./qa-e2e.db", "Use the isolated QA database only");
  const savedFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  const deliveryIds: string[] = [];
  const requests: URLSearchParams[] = [];
  let responses: Array<{ status: number; body: object }> = [];
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    assert(String(input).startsWith("https://api.twilio.com/2010-04-01/Accounts/ACqa/"));
    if (init?.method === "POST") {
      const body = new URLSearchParams(String(init.body));
      requests.push(body);
      deliveryIds.push(new URL(body.get("StatusCallback")!).searchParams.get("deliveryId")!);
      assert.equal(body.get("To"), "+12025550123");
    }
    const response = responses.shift();
    assert(response, "Unexpected request: no real network calls are allowed");
    return new Response(JSON.stringify(response.body), { status: response.status });
  };
  const send = () => sendClientLinkSms("2025550123", "https://example.invalid/qa-test", "QA TEST ONLY");
  const reply = (body: object, status = 201) => ({ status, body });
  try {
    process.env.TWILIO_ACCOUNT_SID = "ACqa";
    process.env.TWILIO_AUTH_TOKEN = "qa-fake-token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MGqa";
    delete process.env.TWILIO_FROM_NUMBER;
    responses = [reply({ sid: "SMqa-service", status: "delivered" })];
    assert.equal((await send()).deliveryStatus, "delivered");
    assert.equal(requests.at(-1)!.get("MessagingServiceSid"), "MGqa");
    assert.equal(requests.at(-1)!.has("From"), false);

    process.env.TWILIO_FROM_NUMBER = "+12025550199";
    responses = [reply({ sid: "SMqa-precedence", status: "delivered" })];
    await send();
    assert.equal(requests.at(-1)!.has("From"), false, "Messaging Service takes precedence");

    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    responses = [reply({ sid: "SMqa-number", status: "delivered" })];
    await send();
    assert.equal(requests.at(-1)!.get("From"), "+12025550199");
    assert.equal(requests.at(-1)!.has("MessagingServiceSid"), false);

    responses = [reply({ sid: "SMqa-pending", status: "queued" }), reply({ sid: "SMqa-pending", status: "sent" }, 200)];
    const pending = await send();
    assert.equal(pending.deliveryStatus, "pending", "Accepted/sent is not delivered");
    assert.equal(pending.ok, true);

    responses = [reply({ sid: "SMqa-blocked", status: "undelivered", error_code: 30034 })];
    const blocked = await send();
    assert.equal(blocked.ok, false);
    assert.match(blocked.detail, /30034/);
    assert.equal(blocked.deliveryStatus, "failed");
    assert.match(blocked.detail, /verified toll-free/);

    responses = [reply({ code: 30034, message: "Unregistered sender" }, 400)];
    assert.match((await send()).detail, /email or the secure QR link/);

    responses = [reply({ code: 21610, message: "Recipient opted out" }, 400)];
    assert.equal((await send()).ok, false);

    responses = [reply({ code: 20500, message: "Service unavailable" }, 500)];
    const callsBeforeFailure = calls;
    assert.equal((await send()).ok, false);
    assert.equal(calls - callsBeforeFailure, 1, "Do not retry non-idempotent message POST after 5xx");

    delete process.env.TWILIO_FROM_NUMBER;
    const callsBeforeUnconfigured = calls;
    assert.equal((await send()).demo, true);
    assert.equal(calls, callsBeforeUnconfigured, "Unconfigured SMS must not claim delivery");

    const rows = await prisma.messageDelivery.findMany({ where: { id: { in: deliveryIds } } });
    assert.equal(rows.length, 8);
    assert(rows.every((row) => row.recipient === "ending 0123"));
    assert.equal(rows.find((row) => row.messageSid === "SMqa-pending")?.isFinal, false);
    console.log("PASS: 10 messaging scenarios; no real SMS or email sent.");
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID"]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await prisma.messageDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
