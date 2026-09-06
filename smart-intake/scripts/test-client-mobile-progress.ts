import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { flattenVisible } from "../src/components/EasyQuestionnaire";
import { SECTIONS } from "../src/config/mooreDivineQuestions";
import { createQuestionAdvanceTimer, leaveAfterSave, resumeVisibleIndex } from "../src/lib/clientProgress";
import { createAnswerSaveQueue, type SaveableAnswers } from "../src/lib/answerSaveQueue";
import VoiceInput from "../src/components/VoiceInput";

async function main() {
  // Real questionnaire filtering reproduced the mobile reload bug: gender is
  // visible before the first answer, then hidden as a saved prefill on reload.
  const initial = { client_full_name: "Synthetic Mobile Test", dob: "2000-01-01" };
  const savedAnswers = { ...initial, client_email: "test@example.invalid", gender: "Male" };
  const before = flattenVisible(savedAnswers, initial, false, false, false, new Set());
  const oldIndex = before.findIndex((item) => item.q.key === "race");
  const after = flattenVisible(savedAnswers, savedAnswers, false, false, false, new Set());
  const keys = after.map((item) => item.q.key);
  const catalog = SECTIONS.flatMap((section) => section.questions.map((question) => question.key));
  assert.equal(after[oldIndex].q.key, "marital_status", "This fixture must exercise the original index drift");
  assert.equal(keys[resumeVisibleIndex(keys, "race", catalog, savedAnswers)], "race", "Reload keeps the actual saved question");
  assert.equal(keys[resumeVisibleIndex(keys, undefined, catalog, savedAnswers)], "race", "Old numeric bookmarks resume at the first unanswered question");
  assert.equal(keys[resumeVisibleIndex(keys, "gender", catalog, savedAnswers)], "race", "A newly hidden current question resumes at its visible successor");
  assert.equal(resumeVisibleIndex(["basic", "consents", "__signature"], "consents", ["welcome", "basic", "clinical", "consents", "__signature"]), 1,
    "Full-mode bookmarks survive earlier sections being removed");

  // Live mobile regression: choosing Working inserted Work phone before the
  // numeric cursor, so Next returned to Employment instead of advancing.
  const employmentInitial = { client_full_name: "Synthetic Employment Test", dob: "1991-02-03", client_phone_cell: "2025550146" };
  const employmentFields = ["occupation", "employer_name", "employer_address", "employer_phone", "client_phone_work"];
  for (const quick of [true, false]) {
    const unselected = flattenVisible(employmentInitial, employmentInitial, quick, false, false, new Set()).map((item) => item.q.key);
    for (const employment_status of ["Employed", "Self-Employed"]) {
      const workingAnswers = { ...employmentInitial, employment_status };
      const working = flattenVisible(workingAnswers, employmentInitial, quick, false, false, new Set()).map((item) => item.q.key);
      const selectedIndex = resumeVisibleIndex(working, "employment_status", catalog, workingAnswers);
      assert.equal(working[selectedIndex], "employment_status", `Changing employment retains the current question in ${quick ? "quick" : "full"} mode`);
      assert.deepEqual(working.slice(selectedIndex + 1, selectedIndex + 1 + employmentFields.length), employmentFields,
        "Next visits every newly visible employment field, including work phone, without repeating the trigger");
      assert.equal(working[selectedIndex - 1], unselected[unselected.indexOf("employment_status") - 1], "Back returns to the prior question rather than a newly inserted field");
      const changedAnswers = { ...workingAnswers, employment_status: "Unemployed" };
      const changed = flattenVisible(changedAnswers, employmentInitial, quick, false, false, new Set()).map((item) => item.q.key);
      assert.equal(changed[resumeVisibleIndex(changed, "employment_status", catalog, changedAnswers)], "employment_status");
      assert(!employmentFields.some((key) => changed.includes(key)), "Changing back removes all job-only questions");
      assert.equal(changed[resumeVisibleIndex(changed, "occupation", catalog, changedAnswers)], "income_sources", "An externally hidden current question resumes at its visible successor");
    }
    const beforeHousing = flattenVisible({ ...employmentInitial, living_arrangement: "Homeless" }, employmentInitial, quick, false, false, new Set()).map((item) => item.q.key);
    const afterHousing = flattenVisible({ ...employmentInitial, living_arrangement: "Adult Alone" }, employmentInitial, quick, false, false, new Set()).map((item) => item.q.key);
    assert.notEqual(beforeHousing.indexOf("employment_status"), afterHousing.indexOf("employment_status"), "The fixture inserts an earlier question");
    assert.equal(afterHousing[resumeVisibleIndex(afterHousing, "employment_status", catalog)], "employment_status", "Earlier visibility changes cannot move the active question");
    assert.equal(afterHousing[resumeVisibleIndex(afterHousing, "living_arrangement", catalog) + 1], "address_street", "Changing housing exposes the unanswered street address on Next");
  }
  for (const question of SECTIONS.flatMap((section) => section.questions)) {
    if (!question.askIf) continue;
    const trigger = catalog.indexOf(question.askIf.key);
    assert(trigger < 0 || trigger < catalog.indexOf(question.key), `${question.key} must follow its trigger ${question.askIf.key}; otherwise newly shown questions can be skipped`);
  }
  const easySource = readFileSync("src/components/EasyQuestionnaire.tsx", "utf8");
  assert.match(easySource, /const \[questionKey, setQuestionKey\]/);
  assert.match(easySource, /idxRef.current = resumeVisibleIndex\(nextFlat/,
    "Immediate Next after a gate change must read the rebased list before React's next render");

  // Deliver canceled callbacks anyway, as if a timeout had already reached the
  // browser's task queue. Explicit navigation must still win.
  const pending: Array<() => void> = [];
  const timer = createQuestionAdvanceTimer({
    schedule: (callback) => { pending.push(callback); return pending.length as unknown as ReturnType<typeof setTimeout>; },
    clear: () => undefined,
  });
  let question = 2;
  timer.schedule(() => question++);
  timer.cancel(); question--; // Back during the selected-answer highlight.
  pending.shift()!();
  assert.equal(question, 1, "A delayed answer tap must not undo Back");
  timer.schedule(() => question++);
  timer.cancel(); question++; // Skip/Next during the highlight.
  pending.shift()!();
  assert.equal(question, 2, "Manual Next/Skip cannot advance a second time later");
  timer.schedule(() => question++);
  timer.schedule(() => question++);
  pending.splice(0).forEach((callback) => callback());
  assert.equal(question, 3, "Changing a selected answer schedules only the latest advance");
  timer.schedule(() => question++);
  timer.cancel(); pending.shift()!();
  assert.equal(question, 3, "Save & exit/unmount cancels any queued advance");

  let draft: SaveableAnswers = { answer: "old" };
  const queue = createAnswerSaveQueue(draft);
  let release!: () => void;
  const response = new Promise<void>((resolve) => { release = resolve; });
  draft = { answer: "first change" };
  const first = queue.save({ readSnapshot: () => draft, write: async () => { await response; return true; } });
  await Promise.resolve();
  draft = { answer: "newer draft" };
  let left = false;
  const savedBeforeLeaving: SaveableAnswers[] = [];
  const pause = leaveAfterSave(() => queue.save({ readSnapshot: () => draft, write: async (patch) => {
    savedBeforeLeaving.push(patch); return true;
  } }), () => { left = true; });
  await Promise.resolve();
  assert.equal(left, false, "Save & exit waits for an outstanding network request");
  release(); await first;
  assert.equal(await pause, true);
  assert.deepEqual(savedBeforeLeaving, [{ answer: "newer draft" }], "Exit flushes the latest draft after earlier acknowledgments");
  assert.equal(queue.hasUnsavedChanges(draft), false);
  left = false;
  draft = { answer: "offline edit" };
  assert.equal(await leaveAfterSave(() => queue.save({ readSnapshot: () => draft, write: async () => false }), () => { left = true; }), false);
  assert.equal(left, false, "Rejected saves stay on the form");
  assert.equal(queue.hasUnsavedChanges(draft), true);
  assert.equal(await leaveAfterSave(async () => { throw new Error("offline"); }, () => { left = true; }), false);
  assert.equal(left, false, "Network errors cannot show a saved/exit screen");
  await queue.save({ readSnapshot: () => draft, write: async () => ({ ok: false, conflicts: [{ key: "answer", serverValue: "someone else's edit", serverRevision: 2 }] }) });
  assert.equal(await leaveAfterSave(() => queue.save({ readSnapshot: () => draft, write: async () => true }), () => { left = true; }), false);
  assert.equal(left, false, "Unresolved conflicts cannot leave the form");

  // tsx uses classic JSX for this repository's preserve setting; Next supplies
  // the automatic runtime in production. Provide React only for this render.
  const jsxGlobal = globalThis as unknown as { React?: typeof React };
  const previousReact = jsxGlobal.React;
  jsxGlobal.React = React;
  let markup: string;
  try {
    markup = renderToStaticMarkup(createElement(VoiceInput, {
      value: "", onChange: () => undefined, multiline: true,
      ariaLabel: "What would you like help with?", ariaDescribedBy: "question-help",
    }));
  } finally {
    if (previousReact) jsxGlobal.React = previousReact;
    else delete jsxGlobal.React;
  }
  assert.match(markup, /aria-label="What would you like help with\?"/);
  assert.match(markup, /aria-describedby="question-help"/);
  console.log("Client mobile progress: stable question identity, quick/full employment and housing dependencies, actual prefill/resume regression, canceled navigation, delayed save/exit, failures/conflicts, and accessible voice fields passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
