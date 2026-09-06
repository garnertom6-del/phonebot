import { promises as fs } from "node:fs";
import path from "node:path";
import { HostError, NcTracksHostWorker, runRunner, validateConfig } from "./worker";

async function main() {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf("--config");
  const mode = ["--status", "--check", "--once", "--run"].filter((v) => args.includes(v));
  if (configIndex < 0 || mode.length !== 1 || args.length !== 3 || !path.isAbsolute(args[configIndex + 1] || "")) {
    console.log("Usage: tsx scripts/nctracks-host/cli.ts --config <absolute config.json> --status|--check|--once|--run");
    process.exitCode = 2; return;
  }
  const config = validateConfig(JSON.parse((await fs.readFile(args[configIndex + 1], "utf8")).replace(/^\uFEFF/, "")));
  await Promise.all([fs.access(config.runner.executable), fs.access(config.runner.cwd), fs.access(config.artifactRoot)]);
  const token = process.env.NCTRACKS_HOST_TOKEN;
  if (mode[0] === "--check") {
    const probe = await runRunner(config, { protocolVersion: 1, operation: "status" }, undefined, 30000) as { protocolVersion?: number; status?: string };
    console.log(JSON.stringify({ status: probe?.protocolVersion === 1 && probe.status === "READY" ? "ADAPTER_AVAILABLE" : "NOT_CONFIGURED", connection: token ? "NOT_CONNECTED" : "HOST_TOKEN_MISSING", code: "NO_PORTAL_OR_SERVER_CONNECTION_TESTED" })); return;
  }
  if (!token) { console.log(JSON.stringify({ status: "NOT_CONFIGURED", code: "HOST_TOKEN_MISSING" })); return; }
  if (mode[0] === "--status") {
    console.log(JSON.stringify({ status: "NOT_CONNECTED", code: "LOCAL_CONFIG_PRESENT_RUN_CHECK" })); return;
  }
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
  const root = await fs.realpath(config.artifactRoot);
  const lockPath = path.join(root, ".nctracks-host.lock");
  let lock;
  try { lock = await fs.open(lockPath, "wx", 0o600); }
  catch { throw new HostError("HOST_ALREADY_RUNNING_OR_LOCKED"); }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const worker = new NcTracksHostWorker(config, token, (status) => console.log(JSON.stringify({ status })));
    if (mode[0] === "--once") console.log(JSON.stringify({ status: await worker.runOnce(controller.signal) }));
    else await worker.run(controller.signal);
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
main().catch((error) => {
  // Never echo config, child stderr, HTTP body, paths, token or patient input.
  console.error(JSON.stringify({ status: "NOT_CONFIGURED", code: error instanceof HostError ? error.code : "LOCAL_CONFIGURATION_OR_RUNTIME_ERROR" }));
  process.exitCode = 1;
});
