import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  if (process.platform !== "win32") { console.log("Windows DPAPI installer test skipped on non-Windows host."); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nctracks-installer-test-"));
  try {
    const profile = path.join(root, "profile"), local = path.join(root, "local"), downloads = path.join(profile, "Downloads");
    await fs.mkdir(downloads, { recursive: true });
    const codex = path.join(root, "codex.exe"); await fs.writeFile(codex, "synthetic path fixture; never executed");
    const hostId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", token = "S".repeat(64);
    const file = path.join(downloads, `NCTracks-workstation-pairing-${hostId}.json`);
    const pairing = { protocolVersion: 1, appUrl: "https://mdc-smart-intake.onrender.com", authorizedNpi: "1134943608", providerId: "synthetic-provider", hostId, hostToken: token, expiresAt: new Date(Date.now() + 86400000).toISOString() };
    const shell = "pwsh.exe";
    const env = { ...process.env, USERPROFILE: profile, LOCALAPPDATA: local };
    const install = () => spawnSync(shell, ["-NoProfile", "-File", path.resolve("scripts/nctracks-host/install-windows.ps1"), "-PairingFile", file, "-CodexExecutable", codex], { env, encoding: "utf8", windowsHide: true });
    await fs.writeFile(file, JSON.stringify({ ...pairing, authorizedNpi: "1234567893" }));
    const rejected = install(); assert.notEqual(rejected.status, 0); assert(await fs.stat(file));
    await fs.writeFile(file, JSON.stringify(pairing));
    const result = install(); assert.equal(result.status, 0, result.stderr); assert(!result.stdout.includes(token));
    await assert.rejects(() => fs.stat(file));
    const installed = path.join(local, "Welliance", "NCTracksHost");
    const cipher = await fs.readFile(path.join(installed, "credential.dpapi"), "utf8"); assert(!cipher.includes(token)); assert(cipher.trim().length > 64);
    const config = JSON.parse((await fs.readFile(path.join(installed, "config.json"), "utf8")).replace(/^\uFEFF/, ""));
    assert.equal(config.appUrl, pairing.appUrl); assert.equal(config.artifactRoot, path.join(downloads, "NC Tracks Cards")); assert(!JSON.stringify(config).includes(token));
    assert(await fs.stat(path.join(installed, "Start-NCTracks.ps1")));
    console.log("Windows installer passed: wrong NPI rejected, current-user DPAPI protected and roundtrip verified, exact pairing download removed, configuration excludes token. No portal or runner executed.");
  } finally {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert(path.basename(resolved).startsWith("nctracks-installer-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
