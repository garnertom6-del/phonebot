import { revisionsForKeys, type AnswerConflict, type AnswerRevisions } from "./answerRevisions";

export type SaveableAnswers = Record<string, string | boolean | number | string[]>;

function changedAnswers(current: SaveableAnswers, saved: SaveableAnswers): SaveableAnswers {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => (
    JSON.stringify(value) !== JSON.stringify(saved[key])
  )));
}

/** Serialize writes and compare against only the last acknowledged answers. */
export function createAnswerSaveQueue(initialAnswers: SaveableAnswers, initialRevisions: AnswerRevisions = {}) {
  let saved = { ...initialAnswers };
  let revisions = { ...initialRevisions };
  const conflicts = new Map<string, AnswerConflict>();
  let tail: Promise<void> = Promise.resolve();

  return {
    savedAnswers(): SaveableAnswers { return { ...saved }; },
    conflicts(): AnswerConflict[] { return [...conflicts.values()]; },
    resolveConflict(key: string, choice: "server" | "local", currentAnswers: SaveableAnswers): SaveableAnswers {
      const conflict = conflicts.get(key);
      if (!conflict) return currentAnswers;
      const serverValue = conflict.serverValue as SaveableAnswers[string];
      saved[key] = serverValue;
      revisions[key] = conflict.serverRevision;
      conflicts.delete(key);
      return choice === "server" ? { ...currentAnswers, [key]: serverValue } : currentAnswers;
    },
    hasUnsavedChanges(answers: SaveableAnswers): boolean {
      return Object.keys(changedAnswers(answers, saved)).length > 0;
    },
    save(options: {
      readSnapshot: () => SaveableAnswers;
      write: (patch: SaveableAnswers, expectedAnswerRevisions: AnswerRevisions) => Promise<boolean | {
        ok: boolean;
        answerRevisions?: AnswerRevisions;
        conflicts?: AnswerConflict[];
      }>;
      force?: boolean;
    }): Promise<boolean> {
      const operation = tail.then(async () => {
        if (conflicts.size) return false;
        // Read when this operation starts, after earlier acknowledgments. A
        // snapshot captured when queued can overwrite newer typing or reversions.
        const patch = changedAnswers(options.readSnapshot(), saved);
        if (!Object.keys(patch).length && !options.force) return true;
        const result = await options.write(patch, revisionsForKeys(revisions, Object.keys(patch)));
        const accepted = typeof result === "boolean" ? result : result.ok;
        if (accepted) {
          saved = { ...saved, ...patch };
          if (typeof result !== "boolean") revisions = { ...revisions, ...result.answerRevisions };
        } else if (typeof result !== "boolean") {
          for (const conflict of result.conflicts || []) conflicts.set(conflict.key, conflict);
        }
        return accepted;
      });
      // A failed request must not poison the queue or acknowledge unsaved work.
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
