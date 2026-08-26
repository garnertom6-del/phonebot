/**
 * SQLite unique-index prep: existing duplicate (providerId, recordNumber)
 * rows would make `prisma db push` fail. Suffix extras so the unique can land.
 * Empty record numbers become null so they do not collide.
 *
 * Run before `prisma db push` in production start.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type DupeRow = {
  providerId: string | null;
  recordNumber: string | null;
  c: number | bigint;
};

export async function prepareRecordNumbers(client = prisma): Promise<number> {
  await client.$executeRawUnsafe(`
    UPDATE Client
    SET recordNumber = NULL
    WHERE recordNumber IS NOT NULL AND TRIM(recordNumber) = ''
  `);

  const dupes = await client.$queryRawUnsafe<DupeRow[]>(`
    SELECT providerId, recordNumber, COUNT(*) AS c
    FROM Client
    WHERE recordNumber IS NOT NULL
    GROUP BY providerId, recordNumber
    HAVING COUNT(*) > 1
  `);

  let changed = 0;
  for (const dupe of dupes) {
    const rows = await client.client.findMany({
      where: { providerId: dupe.providerId, recordNumber: dupe.recordNumber || undefined },
      select: { id: true, recordNumber: true },
      orderBy: { createdAt: "asc" },
    });
    for (const extra of rows.slice(1)) {
      const suffix = extra.id.replace(/-/g, "").slice(0, 6).toUpperCase();
      await client.client.update({
        where: { id: extra.id },
        data: { recordNumber: `${extra.recordNumber}-DUP-${suffix}` },
      });
      changed += 1;
    }
  }
  return changed;
}

async function main() {
  try {
    const changed = await prepareRecordNumbers();
    if (changed) console.log(`Prepared ${changed} duplicate Record# value(s) for the unique index.`);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = typeof process !== "undefined"
  && !!process.argv[1]
  && process.argv[1].includes("prepare-record-numbers");
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
