/** Resume by stable keys: saved answers can remove earlier prefilled questions. */
export function resumeVisibleIndex(visibleKeys: string[], savedKey: unknown, catalogKeys: string[], answers: Record<string, unknown> = {}): number {
  const firstUnanswered = () => {
    const index = visibleKeys.findIndex((key) => answers[key] === undefined || answers[key] === "" || answers[key] === false || (Array.isArray(answers[key]) && !(answers[key] as unknown[]).length));
    return index < 0 ? 0 : index;
  };
  if (typeof savedKey !== "string") return firstUnanswered();
  const exact = visibleKeys.indexOf(savedKey);
  if (exact >= 0) return exact;
  const previousPosition = catalogKeys.indexOf(savedKey);
  if (previousPosition < 0) return firstUnanswered();
  const next = visibleKeys.findIndex((key) => catalogKeys.indexOf(key) > previousPosition);
  return next < 0 ? Math.max(visibleKeys.length - 1, 0) : next;
}

/** Cancellation also invalidates a callback already queued by the browser. */
export function createQuestionAdvanceTimer(timers = {
  schedule: (callback: () => void) => setTimeout(callback, 350),
  clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const cancel = () => {
    generation++;
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };
  return {
    cancel,
    schedule(callback: () => void) {
      cancel();
      const scheduledGeneration = generation;
      timer = timers.schedule(() => {
        if (scheduledGeneration !== generation) return;
        timer = undefined;
        callback();
      });
    },
  };
}

/** Navigation is allowed only after the latest draft is acknowledged. */
export async function leaveAfterSave(save: () => Promise<boolean>, leave: () => void): Promise<boolean> {
  try {
    if (!(await save())) return false;
    leave();
    return true;
  } catch { return false; }
}
