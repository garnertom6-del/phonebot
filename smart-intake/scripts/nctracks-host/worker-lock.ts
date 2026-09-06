import { randomUUID } from "node:crypto";
import { promises as fs, type BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { HostError } from "./worker";

type Snapshot = { stat: BigIntStats; text: string };
const locked = () => new HostError("HOST_ALREADY_RUNNING_OR_LOCKED");
const hasCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException)?.code === code;
const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size
  && a.birthtimeNs === b.birthtimeNs && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const sameSnapshot = (a: Snapshot, b: Snapshot) => sameFile(a.stat, b.stat) && a.text === b.text;

// EPERM, an invalid PID, or any other uncertainty must never authorize recovery.
function definitelyDead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return hasCode(error, "ESRCH"); }
}

async function snapshot(file: string): Promise<Snapshot> {
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.size > BigInt(2048)) throw locked();
  const text = await fs.readFile(file, "utf8");
  const after = await fs.lstat(file, { bigint: true });
  if (!sameFile(before, after)) throw locked();
  return { stat: after, text };
}

function ownerPid(value: Snapshot): number {
  let data: { pid?: unknown; startedAt?: unknown };
  try { data = JSON.parse(value.text); } catch { throw locked(); }
  if (!data || !Number.isInteger(data.pid) || (data.pid as number) <= 0 || (data.pid as number) > 2147483647
    || typeof data.startedAt !== "string" || !Number.isFinite(Date.parse(data.startedAt))) throw locked();
  return data.pid as number;
}

async function createOwned(file: string): Promise<{ handle: FileHandle; owner: Snapshot }> {
  const handle = await fs.open(file, "wx", 0o600);
  try {
    const text = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), owner: randomUUID() });
    await handle.writeFile(text);
    return { handle, owner: { stat: await handle.stat({ bigint: true }), text } };
  } catch (error) { await handle.close(); throw error; }
}

async function removeOwned(file: string, owner: Snapshot): Promise<void> {
  try {
    if (sameSnapshot(owner, await snapshot(file))) await fs.unlink(file);
  } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
}

/** All new starters serialize the short file transition, not the worker's lifetime.
 * A crash during the transition leaves the guard in place and fails closed for
 * operator review. Never guess whether an incomplete guard belongs to a process.
 */
async function guarded<T>(file: string, action: () => Promise<T>): Promise<T> {
  const guardPath = `${file}.guard`;
  let guard;
  try { guard = await createOwned(guardPath); }
  catch { throw locked(); }
  try { return await action(); }
  finally { await guard.handle.close(); await removeOwned(guardPath, guard.owner); }
}

export async function acquireHostLock(root: string, isDefinitelyDead = definitelyDead): Promise<{ release(): Promise<void> }> {
  const file = path.join(root, ".nctracks-host.lock");
  const owned = await guarded(file, async () => {
    try { return await createOwned(file); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw locked(); }
    // Legacy lock files have no owner nonce; exact file identity and bytes still
    // have to survive both process checks before the stale lock can be replaced.
    const old = await snapshot(file);
    const pid = ownerPid(old);
    if (!isDefinitelyDead(pid)) throw locked();
    if (!sameSnapshot(old, await snapshot(file)) || !isDefinitelyDead(pid)
      || !sameSnapshot(old, await snapshot(file))) throw locked();
    await fs.unlink(file);
    return createOwned(file);
  });
  let released = false;
  return { async release() {
    if (released) return;
    released = true;
    await owned.handle.close();
    // Do not unlink a replacement owner's lock during a delayed shutdown.
    await guarded(file, () => removeOwned(file, owned.owner));
  } };
}
