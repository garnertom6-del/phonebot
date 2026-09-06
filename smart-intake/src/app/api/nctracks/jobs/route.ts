import { ncTracksContext, NcTracksJobError, requestNcTracksJob } from "@/lib/ncTracksJobs";
import { respond, scopedStaff } from "../_shared";
export async function GET(req: Request) {
  return respond(async () => {
    const context = await scopedStaff(req);
    if (context.deny) return context.deny;
    return { jobs: (await ncTracksContext(context.provider!.id, false)).jobs };
  });
}
export async function POST(req: Request) {
  return respond(async () => {
    const body = await req.json();
    if (typeof body?.intakeId !== "string") throw new NcTracksJobError("Select an intake.", 400);
    const context = await scopedStaff(req, true);
    if (context.deny) return context.deny;
    return { job: await requestNcTracksJob(context.provider!.id, context.user!.id, body) };
  });
}
