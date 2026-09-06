/** Synchronous lock: a second event cannot change the editor before React rerenders. */
export function createClientEditSaveLock() {
  let pending = false;
  return {
    isPending: () => pending,
    async run(action: () => Promise<void>, onPending: (value: boolean) => void): Promise<void> {
      if (pending) return;
      pending = true;
      onPending(true);
      try {
        await action();
      } finally {
        pending = false;
        onPending(false);
      }
    },
  };
}
