import http from "node:http";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SYNTHETIC_ANTHROPIC_KEY = "synthetic-loopback-only";
export async function startSyntheticCcaServer(fixturePath: string, port = 0) {
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const pdf = await fs.readFile(path.join(path.dirname(fixturePath), "synthetic-e2e-cca.pdf"));
  const expectedHash = createHash("sha256").update(pdf).digest("hex");
  const expectedName = fixture?.ccaReview?.sourceClientName;
  if (expectedName !== "Synthetic E2E Intake" || fixture?.ccaReview?.sourceClientDob !== "1991-02-03") throw new Error("Only the explicit synthetic fixture is supported");
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    const reject = (status: number, message: string) => { res.statusCode = status; res.end(JSON.stringify({ error: { type: "invalid_request_error", message } })); };
    if (req.url === "/health" && req.method === "GET") { res.end(JSON.stringify({ mode: "SYNTHETIC_LOOPBACK_ONLY" })); return; }
    if (req.method !== "POST" || req.url !== "/v1/messages") return reject(404, "Synthetic endpoint not found");
    if (req.headers["x-api-key"] !== SYNTHETIC_ANTHROPIC_KEY) return reject(401, "Use the dummy local fixture key only");
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) return reject(413, "Synthetic request too large"); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const properties = body?.output_config?.format?.schema?.properties || {};
      let result;
      if (properties.answers) {
        const doc = body?.messages?.[0]?.content?.[0];
        if (doc?.type !== "document" || doc?.source?.media_type !== "application/pdf" || typeof doc.source.data !== "string" || createHash("sha256").update(Buffer.from(doc.source.data, "base64")).digest("hex") !== expectedHash) return reject(422, "Only the exact prepared synthetic PDF is accepted");
        result = fixture;
      } else if (properties.findings) {
        const content = body?.messages?.[0]?.content;
        if (typeof content !== "string") return reject(422, "Expected synthetic preflight text");
        const start = content.indexOf("{\"clientRecord\"");
        const record = start >= 0 ? JSON.parse(content.slice(start)) : null;
        if (record?.clientRecord?.fullName !== expectedName || record?.clientRecord?.dob !== "1991-02-03") return reject(422, "Only the selected synthetic client can use fixture preflight");
        result = { findings: [] };
      } else return reject(422, "Unsupported synthetic schema");
      res.end(JSON.stringify({ id: "synthetic-fixture-message", type: "message", role: "assistant", model: "synthetic-fixture-only", stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(result) }] }));
    } catch { reject(400, "Invalid synthetic request"); }
  });
  server.requestTimeout = 30000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--fixture" || args[2] !== "--port" || !path.isAbsolute(args[1]) || !/^\d{1,5}$/.test(args[3]) || Number(args[3]) > 65535) throw new Error("Use --fixture <absolute JSON path> --port <0 or local port>");
  const fixture = await startSyntheticCcaServer(args[1], Number(args[3]));
  console.log(JSON.stringify({ status: "SYNTHETIC_LOOPBACK_ONLY", url: fixture.url, pid: process.pid }));
  const stop = () => { fixture.server.close(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main().catch(() => { console.error("Synthetic fixture server could not start"); process.exitCode = 1; });
