import fs from "fs";
import path from "path";

/**
 * Local-disk storage adapter. In production on Vercel the filesystem is
 * ephemeral - swap saveFile/readFile for Supabase Storage (see
 * COWORKER_HANDOFF.md). On Render attach a persistent disk at ./storage.
 */
const ROOT = path.join(process.cwd(), "storage");

export function saveFile(relPath: string, data: Buffer): string {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return full;
}

export function readFile(relPath: string): Buffer {
  return fs.readFileSync(path.join(ROOT, relPath));
}

export function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

export function deleteFile(relPath: string): void {
  const full = path.resolve(ROOT, relPath);
  const root = `${path.resolve(ROOT)}${path.sep}`;
  if (!full.startsWith(root)) throw new Error("Refusing to delete a file outside storage.");
  if (fs.existsSync(full)) fs.rmSync(full, { force: true });
}
