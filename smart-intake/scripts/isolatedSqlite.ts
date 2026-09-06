import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const localRequire = createRequire(path.join(process.cwd(), "package.json"));
const PREFIX = "smart-intake-synthetic-";

/** Every test owns a new database; caller DATABASE_URL is never used. */
export function isolatedSqlite(databaseName: string) {
  assert.match(databaseName, /^[a-z0-9-]+\.db$/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const databasePath = path.join(directory, databaseName);
  // Prisma's SQLite engine on Windows requires the empty file to exist first.
  fs.writeFileSync(databasePath, "");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  const env = { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: "1" };
  return {
    directory,
    databasePath,
    databaseUrl,
    env,
    pushSchema(schema: string, name: string) {
      assert.match(schema, /datasource\s+db\s*\{[^}]*provider\s*=\s*"sqlite"/s, "This regression suite requires the repository's SQLite schema.");
      assert.match(name, /^[a-z0-9-]+\.prisma$/);
      const schemaPath = path.join(directory, name);
      fs.writeFileSync(schemaPath, schema);
      const result = spawnSync(process.execPath, [localRequire.resolve("prisma/build/index.js"), "db", "push", "--schema", schemaPath, "--skip-generate"], { env, encoding: "utf8" });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `Additive schema push failed without data-loss approval:\n${result.stdout}\n${result.stderr}`);
    },
    runSuite(relativePath: string) {
      const result = spawnSync(process.execPath, [localRequire.resolve("tsx/cli"), path.resolve(relativePath)], { env, stdio: "inherit" });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `Isolated suite failed: ${relativePath}`);
    },
    cleanup() {
      // Only remove the exact mkdtemp directory owned by this invocation.
      const target = path.resolve(directory);
      assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
      assert(path.basename(target).startsWith(PREFIX));
      fs.rmSync(target, { recursive: true, force: true });
    },
  };
}
