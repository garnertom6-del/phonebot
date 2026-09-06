import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { acquireHostLock } from "./worker-lock";

export async function testWorkerLock(parent: string): Promise<void> {
  const root = path.join(parent, "worker-locks");
  await fs.mkdir(root);
  const file = path.join(root, ".nctracks-host.lock");
  const guard = `${file}.guard`;
  const deadPid = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", () => child.pid ? resolve(child.pid) : reject(new Error("Missing fixture PID")));
  });
  const legacy = JSON.stringify({ pid: deadPid, startedAt: "2026-09-06T06:21:59.296Z" });
  const live = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  const absent = (target: string) => assert.rejects(() => fs.access(target), (error: any) => error.code === "ENOENT");
  const rejects = (action: () => Promise<unknown>) => assert.rejects(action, /HOST_ALREADY_RUNNING_OR_LOCKED/);

  const first = await acquireHostLock(root);
  await rejects(() => acquireHostLock(root));
  await first.release(); await first.release();
  await absent(file); await absent(guard);

  // A real terminated process reproduces the legacy production lock format.
  await fs.writeFile(file, legacy);
  const recovered = await acquireHostLock(root);
  const replacement = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(replacement.pid, process.pid); assert(replacement.owner);
  await recovered.release(); await absent(file);

  for (const data of [live, "", "not json", JSON.stringify({ pid: 0, startedAt: "2026-09-06" }),
    JSON.stringify({ pid: deadPid, startedAt: "invalid" })]) {
    await fs.writeFile(file, data);
    await rejects(() => acquireHostLock(root));
    assert.equal(await fs.readFile(file, "utf8"), data, "live or ambiguous lock must be retained");
    await absent(guard); await fs.unlink(file);
  }

  // A process probe that cannot establish absence cannot authorize recovery.
  await fs.writeFile(file, legacy);
  await rejects(() => acquireHostLock(root, () => false));
  assert.equal(await fs.readFile(file, "utf8"), legacy);
  let probes = 0;
  await rejects(() => acquireHostLock(root, () => ++probes === 1));
  assert.equal(await fs.readFile(file, "utf8"), legacy);

  // Ownership changes during the probe: never remove the new owner's file.
  await rejects(() => acquireHostLock(root, () => { writeFileSync(file, live); return true; }));
  assert.equal(await fs.readFile(file, "utf8"), live);
  await fs.writeFile(file, legacy);
  await rejects(() => acquireHostLock(root, () => {
    renameSync(file, `${file}.old`); writeFileSync(file, legacy); return true;
  }));
  assert.equal(await fs.readFile(file, "utf8"), legacy, "same bytes in a different file are not the old owner");
  await fs.unlink(`${file}.old`);

  // Two simultaneous crash recoveries may start only one worker.
  const starts = await Promise.allSettled([acquireHostLock(root), acquireHostLock(root)]);
  assert.equal(starts.filter((value) => value.status === "fulfilled").length, 1);
  for (const value of starts) if (value.status === "fulfilled") await value.value.release();
  await absent(file); await absent(guard);

  // An old shutdown cannot remove a replacement lock, even in the same process.
  const old = await acquireHostLock(root);
  await fs.unlink(file);
  const current = await acquireHostLock(root);
  const currentBytes = await fs.readFile(file, "utf8");
  await old.release();
  assert.equal(await fs.readFile(file, "utf8"), currentBytes);
  await current.release();

  // A interrupted transition is intentionally ambiguous and needs operator review.
  await fs.writeFile(file, legacy); await fs.writeFile(guard, "incomplete transition");
  await rejects(() => acquireHostLock(root));
  assert.equal(await fs.readFile(file, "utf8"), legacy);
  assert.equal(await fs.readFile(guard, "utf8"), "incomplete transition");
  await fs.unlink(guard); await fs.unlink(file);
  console.log("NCTracks worker lock passed: real crash recovery, live/ambiguous owners, concurrent starts, changed ownership and safe shutdown.");
}
