import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEdi271 } from "../src/lib/edi271";
import { snapshotFrom271 } from "../src/lib/eligibilityState";
import { applyNcTracksResult } from "../src/lib/ncTracksLookup";
import { checkNcTracksEligibility } from "../src/lib/nctracksEdi";
import {
  COMPLETED_COPY_DELIVERY_KEY,
  COMPLETED_COPY_DELIVERY_OPTIONS,
  completedCopyDeliveryChannels,
  completedCopyDeliveryOptions,
  hasUsableCompletedCopyEmail,
} from "../src/lib/clientCopyDelivery";
import { clientFollowUpDeliveryContacts } from "../src/lib/clientDeliveryContacts";

const at = new Date("2026-09-06T00:00:00Z");
const fixture = (file: string) => readFileSync(join(process.cwd(), "test/fixtures/nctracks", file), "utf8");

async function eligibilityRegressions() {
  const originalFetch = globalThis.fetch;
  const envKeys = ["NCTRACKS_EDI_URL", "NCTRACKS_SUBMITTER_ID", "NCTRACKS_PROVIDER_NPI"] as const;
  const originalEnv = envKeys.map((key) => [key, process.env[key]] as const);
  process.env.NCTRACKS_EDI_URL = "https://synthetic.invalid/eligibility";
  process.env.NCTRACKS_SUBMITTER_ID = "SYNTHETIC";
  process.env.NCTRACKS_PROVIDER_NPI = "1234567890";
  try {
    const uncertainResponses = [
      "",
      "<html>Temporary upstream error</html>",
      "ST*999*0001~SE*2*0001~",
      "ST*271*0001~EB*1*IND*30**SYNTHETIC~",
      "ST*271*0001~EB*1*IND*30**SYNTHETIC~SE*3*OTHER~",
      "ST*271*0001~NM1*IL*1*CLIENT*SYNTHETIC~SE*3*0001~",
      "ST*271*0001~EB*D*IND*30**SYNTHETIC~SE*3*0001~",
      fixture("271-notfound.edi"),
      "ST*271*0001~EB*1*IND*30**SYNTHETIC~AAA*Y**75*C~SE*4*0001~",
    ];
    for (const payload of uncertainResponses) {
      globalThis.fetch = async () => new Response(payload, { status: 200 });
      const checked = await checkNcTracksEligibility({
        fullName: "Synthetic Client", dob: "01/01/2000", controlNumber: 1,
        traceNumber: "SYNTHETIC", now: at,
      });
      assert.equal(snapshotFrom271(checked.result, at).status, "needs_review");
      assert.deepEqual(checked.mapped, {}, "Unconfirmed eligibility must not replace packet answers");
      const prior = { has_medicaid: "Yes", mid_number: "SYNTHETIC", mco: "Previously verified plan" };
      assert.deepEqual(applyNcTracksResult(prior, checked.mapped).next, prior);
    }
    for (const [file, status, coverage] of [
      ["271-active.edi", "active", "Yes"],
      ["271-inactive.edi", "inactive", "No"],
    ] as const) {
      const payload = fixture(file);
      globalThis.fetch = async () => new Response(payload, { status: 200 });
      const checked = await checkNcTracksEligibility({
        fullName: "Synthetic Client", dob: "01/01/2000", controlNumber: 1,
        traceNumber: "SYNTHETIC", now: at,
      });
      assert.equal(snapshotFrom271(parseEdi271(payload), at).status, status);
      assert.equal(checked.mapped.has_medicaid, coverage);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function deliveryRegressions() {
  const guardianAnswers = {
    is_minor_or_incompetent: "Yes",
    client_email: "",
    guardian_email: "guardian@example.invalid",
    [COMPLETED_COPY_DELIVERY_KEY]: "Email",
  };
  assert.equal(hasUsableCompletedCopyEmail(guardianAnswers), true);
  assert.deepEqual(completedCopyDeliveryOptions(guardianAnswers), [...COMPLETED_COPY_DELIVERY_OPTIONS]);
  assert.deepEqual(completedCopyDeliveryChannels(guardianAnswers), { sms: false, email: true, label: "email" });
  assert.equal(hasUsableCompletedCopyEmail({ ...guardianAnswers, is_minor_or_incompetent: true }), true);
  assert.deepEqual(completedCopyDeliveryOptions({
    ...guardianAnswers, guardian_email: "", client_email: "client@example.invalid",
  }), ["Text message"], "Another person's email must not enable guardian email delivery");
  assert.deepEqual(completedCopyDeliveryOptions({
    ...guardianAnswers, is_minor_or_incompetent: "No",
  }), ["Text message"], "An adult's copy preference must use the adult's email");

  // Delivery follows the actual signer, which can differ from the initial role answer.
  const contacts = clientFollowUpDeliveryContacts({ guardianEmail: "guardian@example.invalid" }, {
    is_minor_or_incompetent: "No",
  }, [{ role: "guardian" }]);
  assert.equal(contacts.email?.role, "guardian");
  assert.deepEqual(completedCopyDeliveryChannels({
    [COMPLETED_COPY_DELIVERY_KEY]: "Email",
  }, contacts.email), { sms: false, email: true, label: "email" });
  assert.equal(hasUsableCompletedCopyEmail({
    ...guardianAnswers, guardian_email: "",
  }, contacts.email), false, "A cleared email cannot be revived from the client record");
  assert.deepEqual(completedCopyDeliveryChannels(guardianAnswers, null), {
    sms: false, email: true, label: "email",
  }, "An unavailable email does not authorize switching to text");
  assert.equal(hasUsableCompletedCopyEmail(guardianAnswers, null), false);
  assert.deepEqual(completedCopyDeliveryChannels({
    [COMPLETED_COPY_DELIVERY_KEY]: "Text message and email",
  }), { sms: true, email: true, label: "text message and email" });
  assert.deepEqual(completedCopyDeliveryChannels({
    client_email: "client@example.invalid", [COMPLETED_COPY_DELIVERY_KEY]: "Text message",
  }), { sms: true, email: false, label: "text message" });
}

eligibilityRegressions().then(() => {
  deliveryRegressions();
  console.log("Coverage and guardian delivery regression checks passed (synthetic data; no network or messages).");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
