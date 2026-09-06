import assert from "node:assert/strict";
import { createVoiceDraftGuard, stopSpeechRecognition, VOICE_DRAFT_MESSAGE } from "../src/lib/voiceDraft";
import { createAnswerSaveQueue } from "../src/lib/answerSaveQueue";
import { leaveAfterSave } from "../src/lib/clientProgress";

async function main() {
  const guard = createVoiceDraftGuard();
  const queue = createAnswerSaveQueue({ presenting_problem: "" });
  let answers = { presenting_problem: "" };
  let preview = "My corrected speech draft";
  let savedWrites = 0;
  let left = false;
  let message = "";
  const canLeave = () => guard.canLeave((next) => { message = next; });
  const saveBeforeLeaving = async () => {
    if (!canLeave()) return false;
    return queue.save({ readSnapshot: () => answers, write: async () => { savedWrites++; return true; } });
  };
  guard.update("presenting_problem", { recording: true, hasPreview: true });
  assert.equal(await leaveAfterSave(saveBeforeLeaving, () => { left = true; }), false);
  assert.equal(left, false);
  assert.equal(savedWrites, 0, "recording is not an accepted answer");
  assert.equal(message, VOICE_DRAFT_MESSAGE);
  guard.update("presenting_problem", { recording: false, hasPreview: true });
  assert.equal(await leaveAfterSave(saveBeforeLeaving, () => { left = true; }), false);
  assert.equal(left, false, "Save & exit keeps the preview mounted until an explicit choice");
  assert.equal(preview, "My corrected speech draft");
  assert.equal(canLeave(), false, "rights navigation uses the same guard even with no dirty saved answers");
  assert.equal(savedWrites, 0, "a preview is never silently accepted or sent");

  // The explicit Use this answer action moves the preview into the answer,
  // clears the draft, and still awaits the answer save acknowledgment.
  answers = { presenting_problem: preview };
  preview = "";
  guard.update("presenting_problem", { recording: false, hasPreview: false });
  let acknowledge!: (saved: boolean) => void;
  const exit = leaveAfterSave(async () => {
    if (!canLeave()) return false;
    return queue.save({ readSnapshot: () => answers, write: () => new Promise<boolean>((resolve) => { acknowledge = resolve; }) });
  }, () => { left = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(left, false, "accepted speech still cannot exit before the network save finishes");
  acknowledge(true);
  assert.equal(await exit, true);
  assert.equal(queue.savedAnswers().presenting_problem, "My corrected speech draft");

  guard.update("first", { recording: false, hasPreview: true });
  guard.update("second", { recording: false, hasPreview: true });
  guard.update("first", { recording: false, hasPreview: false });
  assert.equal(canLeave(), false, "one accepted/discarded field cannot hide another pending preview");
  guard.update("second", { recording: false, hasPreview: false });
  assert.equal(canLeave(), true, "explicitly discarding the remaining preview permits navigation");
  assert.equal(queue.savedAnswers().presenting_problem, "My corrected speech draft", "discard does not overwrite an accepted answer");

  let stopped = 0, unexpectedCallbacks = 0;
  const recognition = {
    onresult: (() => { unexpectedCallbacks++; }) as (() => void) | null,
    onend: (() => { unexpectedCallbacks++; }) as (() => void) | null,
    onerror: (() => { unexpectedCallbacks++; }) as (() => void) | null,
    stop() { stopped++; this.onresult?.(); this.onend?.(); },
  };
  stopSpeechRecognition(recognition);
  assert.equal(stopped, 1);
  assert.equal(unexpectedCallbacks, 0, "discard/unmount detaches callbacks before stopping recognition");
  assert.equal(recognition.onresult, null);
  assert.equal(recognition.onend, null);
  assert.equal(recognition.onerror, null);
  assert.doesNotThrow(() => stopSpeechRecognition({ ...recognition, stop() { throw new Error("already stopped"); } }));
  console.log("Speech drafts: recording/preview blocks exit and rights without accepting text, explicit accept awaits save, multiple drafts and discard stay separate, recognition stops safely on discard/unmount.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
