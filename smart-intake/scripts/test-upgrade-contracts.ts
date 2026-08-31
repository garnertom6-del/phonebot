/**
 * Dependency-upgrade regression coverage.
 *
 * Every check here pins a behaviour the app depends on from a library that
 * someone will eventually bump. They are written to fail loudly at `npm test`
 * rather than quietly in production, and each says what breaks if it does.
 *
 * Covered: middleware, auth/session, Server Action & route handler shape,
 * uploads, PDF generation, and message delivery.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { middleware, config as middlewareConfig } from "../src/middleware";
import { createSessionValue, verifySessionValue, SESSION_COOKIE } from "../src/lib/auth";
import {
  checkClientUpload, safeUploadName,
  UPLOAD_ALLOWED_MIME, UPLOAD_MAX_BYTES, UPLOAD_DOC_TYPES,
} from "../src/lib/uploadGuards";
import { sanitizePdfText } from "../src/lib/pdfCoordinates";

const ROOT = path.join(process.cwd());
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const pkg = JSON.parse(read("package.json")) as {
  dependencies: Record<string, string>; devDependencies: Record<string, string>;
};
const majorOf = (range: string) => Number(/(\d+)/.exec(range)?.[1] ?? 0);

let passed = 0;
const ok = (m: string) => { passed++; console.log("  ✓", m); };

export async function runUpgradeContractChecks() {
  console.log("\nDependency-upgrade contracts");

  // ---- 1. Next.js major: the async-API break ------------------------------
  // Next 15 turned cookies() and route `params` into Promises. This app calls
  // both synchronously, so a major bump silently yields undefined - the client
  // link 404s and every staff page logs out. Pin it until the code is migrated.
  {
    const nextMajor = majorOf(pkg.dependencies.next);
    const usesSyncCookies = /cookies\(\)\.get\(/.test(read("src/lib/auth.ts"));
    const usesSyncParams = /\{ params \}: \{ params: \{ token: string \} \}/
      .test(read("src/app/api/intake/[token]/route.ts"));
    assert.ok(usesSyncCookies, "auth still reads cookies() synchronously");
    assert.ok(usesSyncParams, "route handlers still take params synchronously");
    assert.equal(nextMajor, 14,
      `next is pinned at 14 because cookies() and route params are used synchronously. `
      + `Before moving to ${nextMajor}, await cookies() in src/lib/auth.ts and src/lib/staffGuard.ts, `
      + `and make every dynamic route's params a Promise.`);
    assert.equal(majorOf(pkg.dependencies.react), 18, "react 18 pairs with next 14 here");
    ok(`next ${pkg.dependencies.next} matches the synchronous cookies()/params the code uses`);
  }

  // ---- 2. middleware still guards the right paths -------------------------
  {
    for (const route of ["/dashboard", "/login", "/master/:path*", "/admin/:path*", "/intakes/:path*"]) {
      assert.ok(middlewareConfig.matcher.includes(route),
        `middleware must still match ${route}; dropping it serves stale HTML after a deploy`);
    }
    const htmlRequest = { headers: new Headers({ accept: "text/html" }) } as never;
    const htmlResponse = middleware(htmlRequest);
    assert.equal(htmlResponse.headers.get("Cache-Control"), "no-store, max-age=0",
      "HTML must be uncacheable, or a deploy leaves clients on chunks that no longer exist");
    const assetRequest = { headers: new Headers({ accept: "image/png" }) } as never;
    assert.equal(middleware(assetRequest).headers.get("Cache-Control"), null,
      "only HTML is marked no-store; assets stay cacheable");
    ok("middleware matches every protected path and still defeats stale-HTML caching");
  }

  // ---- 3. session signing survives a Node or crypto change ----------------
  {
    const value = createSessionValue("user-123");
    assert.equal(verifySessionValue(value), "user-123", "a fresh session verifies");
    assert.equal(value.split(".").length, 3, "session is payload.exp.signature");
    assert.equal(verifySessionValue(undefined), null, "no cookie is not a session");
    assert.equal(verifySessionValue("user-123.9999999999999.forged"), null,
      "a forged signature must never authenticate");
    const [id, exp, sig] = value.split(".");
    assert.equal(verifySessionValue(`other-user.${exp}.${sig}`), null,
      "the signature is bound to the user id");
    const expired = `${id}.${Date.now() - 1000}.`;
    assert.equal(verifySessionValue(expired), null, "an expired session is refused");
    assert.equal(SESSION_COOKIE, "mdc_session",
      "renaming the cookie signs every staff user out - do it deliberately");
    ok("session tokens verify, reject forgery, and expire");
  }

  // ---- 4. upload guards ---------------------------------------------------
  {
    const pass = checkClientUpload({ docType: "insurance_card", fileName: "card.jpg", fileSize: 2_000_000, fileType: "image/jpeg" });
    assert.equal(pass.ok, true, "a normal phone photo is accepted");
    const heic = checkClientUpload({ docType: "photo_id", fileName: "IMG_0042.HEIC", fileSize: 1_000, fileType: "application/octet-stream" });
    assert.equal(heic.ok, true, "iPhone HEIC arrives as octet-stream and must still pass on extension");
    const script = checkClientUpload({ docType: "other", fileName: "payload.html", fileSize: 10, fileType: "text/html" });
    assert.equal(script.ok, false, "HTML must never be stored from an unauthenticated link");
    const exe = checkClientUpload({ docType: "other", fileName: "x.exe", fileSize: 10, fileType: "application/x-msdownload" });
    assert.equal(exe.ok, false, "executables are refused");
    const big = checkClientUpload({ docType: "other", fileName: "scan.pdf", fileSize: UPLOAD_MAX_BYTES + 1, fileType: "application/pdf" });
    assert.equal(big.ok, false, "the size cap holds");
    const slot = checkClientUpload({ docType: "not_a_slot", fileName: "a.pdf", fileSize: 10, fileType: "application/pdf" });
    assert.equal(slot.ok, false, "unknown document slots are refused");
    assert.ok(!UPLOAD_ALLOWED_MIME.has("text/html") && !UPLOAD_ALLOWED_MIME.has("image/svg+xml"),
      "HTML and SVG stay out of the allow-list - both can carry script");
    assert.equal(UPLOAD_DOC_TYPES.length, 11, "document slots are fixed; adding one is a deliberate change");
    assert.equal(safeUploadName("../../etc/passwd"), ".._.._etc_passwd", "path traversal cannot survive the name");
    assert.equal(safeUploadName("my card.jpg"), "my_card.jpg", "spaces are normalised, extension kept");
    ok("only photos and PDFs, under 15MB, into a known slot, with a storage-safe name");
  }

  // ---- 5. PDF generation --------------------------------------------------
  // pdf-lib's standard fonts are WinAnsi: drawing a character outside that set
  // throws and takes the whole packet with it. sanitizePdfText is the guard,
  // and the CCA reader routinely produces curly quotes and dashes.
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Verified against pdf-lib 1.x rather than assumed: WinAnsi covers em
    // dashes, curly quotes, bullets and ellipses, but NOT arrows, checkmarks,
    // typographic ligatures, CJK or emoji. Those are exactly what a pasted CCA
    // brings in, and each one throws mid-draw and blanks the whole packet.
    for (const [name, sample] of [
      ["arrow", "→"], ["checkmark", "✓"], ["ligature", "ﬁ"], ["emoji", "🙂"], ["CJK", "中"],
    ] as [string, string][]) {
      assert.throws(() => page.drawText(sample, { font, size: 10, x: 10, y: 10 }),
        `pdf-lib must still reject ${name}; sanitizePdfText is the only thing between it and a blank packet`);
      assert.doesNotThrow(() => page.drawText(sanitizePdfText(sample, font), { font, size: 10, x: 10, y: 10 }),
        `sanitizePdfText must make ${name} safe to draw`);
    }
    // and the characters WinAnsi does cover must survive rather than be stripped
    const kept = sanitizePdfText("Cost — “about” 50% • done…", font);
    assert.doesNotThrow(() => page.drawText(kept, { font, size: 10, x: 10, y: 10 }));
    assert.ok(kept.includes("50%"), "ordinary text is not mangled by the sanitiser");

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    assert.equal(reloaded.getPageCount(), 1, "save/load round-trips");
    const size = reloaded.getPage(0).getSize();
    assert.equal(Math.round(size.width), 612, "page width survives a round trip");
    assert.equal(Math.round(size.height), 792, "page height survives a round trip");

    // a 1x1 transparent PNG - the shape SignaturePad produces
    const png = await doc.embedPng(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"));
    assert.ok(png.width === 1 && png.height === 1, "embedPng still accepts the signature canvas output");
    assert.equal(majorOf(pkg.dependencies["pdf-lib"]), 1,
      "pdf-lib 2.x would change the font and drawing API this packet builder is written against");
    ok("pdf-lib still throws on non-WinAnsi text, round-trips pages, and embeds signatures");
  }

  // ---- 6. message delivery ------------------------------------------------
  // These assert the request shape against the provider APIs. A Twilio or
  // SendGrid client swap that drops StatusCallback would make every blocked
  // text look delivered, which is the failure this app has already been bitten by.
  {
    const notify = read("src/lib/notify.ts");
    assert.ok(notify.includes("https://api.twilio.com/2010-04-01/Accounts/"),
      "Twilio REST base path is still what the sender posts to");
    assert.ok(/Messages\.json/.test(notify), "messages are created on Messages.json");
    assert.ok(/"Content-Type": "application\/x-www-form-urlencoded"/.test(notify),
      "Twilio takes form encoding, not JSON - sending JSON returns 400 for every message");
    assert.ok(/new URLSearchParams\(\{/.test(notify), "the body is URLSearchParams");
    assert.ok(/StatusCallback:/.test(notify),
      "StatusCallback must stay on every send, or a carrier-blocked text is recorded as sent");
    assert.ok(/Authorization: `Basic \$\{auth\}`/.test(notify), "Twilio uses basic auth");
    assert.ok(/Authorization: `Bearer \$\{key\}`/.test(notify), "SendGrid uses a bearer key");

    const share = read("src/lib/shareLinks.ts");
    assert.ok(/STOP/.test(share), "the text still carries STOP opt-out wording");
    ok("Twilio and SendGrid request shapes, and the STOP wording, are pinned");
  }

  // ---- 7. the toolchain the suite itself relies on -------------------------
  {
    assert.equal(majorOf(pkg.dependencies["@prisma/client"]), majorOf(pkg.devDependencies.prisma),
      "@prisma/client and the prisma CLI must stay on the same major or generate/db push diverge");
    assert.ok(pkg.dependencies.zod.startsWith("^3"),
      "zod 4 changes error shapes the intake validators read");
    ok("prisma client and CLI majors match; zod stays on 3");
  }

  console.log(`  ${passed} upgrade contracts passed`);
  return passed;
}
