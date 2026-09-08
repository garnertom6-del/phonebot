import assert from "node:assert/strict";
import fs from "node:fs";
import { isolatedSqlite } from "./isolatedSqlite";

const suites = {
  "adobe-preparation": { script: "scripts/test-adobe-preparation.ts", database: "adobe-preparation-tests.db" },
  "document-reviews": { script: "scripts/test-document-reviews.ts", database: "document-review-tests.db" },
  "nctracks-jobs": { script: "scripts/test-nctracks-jobs.ts", database: "nctracks-jobs-tests.db" },
  "nctracks-search": { script: "scripts/test-nctracks-search.ts", database: "nctracks-search-tests.db" },
  "support-referrals": { script: "scripts/test-support-referrals.ts", database: "support-referral-tests.db" },
  "completed-copy-link": { script: "scripts/test-completed-copy-link.ts", database: "completed-copy-link-tests.db" },
  "coverage-identity": { script: "scripts/test-coverage-identity.ts", database: "coverage-identity-tests.db" },
} as const;
const name = process.argv[2] as keyof typeof suites;
assert(Object.hasOwn(suites, name), "Usage: tsx scripts/run-isolated-db-test.ts support-referrals|completed-copy-link");
const suite = suites[name];
const context = isolatedSqlite(suite.database);
try {
  context.pushSchema(fs.readFileSync("prisma/schema.prisma", "utf8"), "current-schema.prisma");
  // DATABASE_URL is supplied before a child process imports Prisma or routes.
  context.runSuite(suite.script);
} finally {
  context.cleanup();
}
