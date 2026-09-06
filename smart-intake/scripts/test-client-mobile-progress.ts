import assert from "node:assert/strict";
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
  console.log("Client mobile progress: actual prefill/resume regression, canceled navigation, delayed save/exit, failures/conflicts, and accessible voice fields passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
