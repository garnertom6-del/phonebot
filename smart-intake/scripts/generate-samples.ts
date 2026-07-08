/**
 * Generates completed sample packets for the two seeded demo clients:
 *   output/sample-completed-angela-demo.pdf
 *   output/sample-completed-jayden-sample.pdf
 * Run: npm run generate:samples   (after npm run db:push && npm run seed)
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fillPacket } from "../src/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures } from "../src/lib/intakeData";

const prisma = new PrismaClient();

async function generate(clientName: string, outName: string) {
  const client = await prisma.client.findFirst({
    where: { fullName: clientName }, include: { intakes: true },
  });
  if (!client?.intakes[0]) throw new Error(`Seeded client not found: ${clientName}. Run npm run seed first.`);
  const intake = client.intakes[0];
  const answers = await loadAnswers(intake.id);
  const result = await fillPacket({
    answers,
    signatures: await loadSignatures(intake.id),
    consents: consentsFromAnswers(answers),
  });
  const out = path.join(process.cwd(), "output", outName);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(result.pdfBytes));
  console.log(`✓ ${outName}: ${result.filled} fields filled, ${result.skipped.length} left blank`);
}

async function main() {
  await generate("Angela Demo", "sample-completed-angela-demo.pdf");
  await generate("Jayden Sample", "sample-completed-jayden-sample.pdf");
}
main().then(() => prisma.$disconnect());
