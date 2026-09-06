type ClipboardWriter = { writeText: (text: string) => Promise<void> };

/** A denied or unavailable clipboard must never be reported as a successful copy. */
export async function copyTextToClipboard(
  text: string,
  clipboard: ClipboardWriter | null | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<boolean> {
  try {
    if (!clipboard) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
