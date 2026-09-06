import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyTextToClipboard } from "../src/lib/clipboardFeedback";
import { providerWorkflowHref } from "../src/lib/providerWorkflowHref";
import { extractIntakeNoteFields } from "../src/lib/parseIntakeNotes";

async function main() {
  let copiedText = "";
  assert.equal(await copyTextToClipboard("synthetic-link", { writeText: async (text) => { copiedText = text; } }), true);
  assert.equal(copiedText, "synthetic-link");
  assert.equal(await copyTextToClipboard("synthetic-link", null), false, "Missing clipboard support offers manual copying");
  assert.equal(await copyTextToClipboard("synthetic-link", { writeText: async () => { throw new Error("Permission denied"); } }), false);
  let release!: () => void;
  const delayedClipboard = new Promise<void>((resolve) => { release = resolve; });
  let result: boolean | undefined;
  const pending = copyTextToClipboard("synthetic-link", { writeText: () => delayedClipboard }).then((value) => { result = value; });
  await Promise.resolve();
  assert.equal(result, undefined, "Copy success is reported only after the browser accepts the text");
  release(); await pending;
  assert.equal(result, true);

  const dashboard = readFileSync("src/app/dashboard/page.tsx", "utf8");
  const action = dashboard.slice(dashboard.indexOf("async function runRowAction"), dashboard.indexOf("async function copyLink"));
  assert.match(action, /catch \{[\s\S]*The action could not be confirmed/);
  assert.match(action, /finally \{[\s\S]*busyRowIdsRef.current.delete\(rowId\)/, "Failures always unlock the row");
  assert.equal((action.match(/await action\(\)/g) || []).length, 1, "An uncertain delivery is never retried automatically");
  assert.match(dashboard, /manualIntakeLink.token === row.token/, "A renewed intake token hides the old manual-copy fallback");
  assert.match(dashboard, /readOnly value=\{manualIntakeLink.link\}/);
  assert.match(dashboard, /if \(noticeTimerRef.current\) clearTimeout/, "An earlier notice must not immediately erase a new action failure");
  const batch = readFileSync("src/app/intakes/new-many/page.tsx", "utf8");
  assert.match(batch, /copyingLinksRef.current \|\| !created.length/);
  assert.match(batch, /role="status">\{copyNotice\}/);
  assert.match(batch, /readOnly value=\{manualCopyText\}/);

  assert.match(dashboard, /providerWorkflowHref\("\/provider\/directory", activeProviderId\)/);
  const directory = readFileSync("src/components/PlanBenefitDirectory.tsx", "utf8");
  assert.match(directory, /providerWorkflowHref\("\/dashboard", providerId\)/);
  const detail = readFileSync("src/app/intakes/[id]/page.tsx", "utf8");
  assert.match(detail, /providerWorkflowHref\("\/dashboard", i.providerId\)/);
  for (const page of ["review", "plans"]) {
    const source = readFileSync(`src/app/intakes/[id]/${page}/page.tsx`, "utf8");
    assert.match(source, /setProviderId\(d.intake.providerId\)/, "Intake data, not a selected-provider cookie, supplies the return context");
    assert.match(source, /providerWorkflowHref\(`\/intakes\/\$\{params.id\}`, providerId\)/);
  }
  assert.equal(providerWorkflowHref("/intakes/synthetic/review?focus=client_full_name&return=preflight#staff-signatures", "provider-a"),
    "/intakes/synthetic/review?focus=client_full_name&return=preflight&providerId=provider-a#staff-signatures", "Provider binding preserves focus, return state and anchors");

  const extracted = extractIntakeNoteFields("Name:Synthetic E2E Intake\nDOB:02/03/1991\nPhone:202-555-0146\nAddress:100 Test Example Lane");
  assert.equal(extracted.find((field) => field.key === "client_phone_cell")?.value, "202-555-0146");
  const create = readFileSync("src/app/intakes/new/page.tsx", "utf8");
  assert.match(create, /client_phone_cell: \{ kind: "form", key: "phone" \}/);
  assert.match(create, /value=\{form.phone \|\| ""\}/);
  assert.match(create, /assignIntakeContacts\(form.email \|\| "", form.phone \|\| ""\)/);
  console.log("Dashboard feedback: clipboard success/denial/missing support, manual fallbacks, uncertain-action notice and provider return links passed. Quick-note phone mapping matches its visible field.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
