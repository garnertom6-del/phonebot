import { changeNcTracksJob } from "@/lib/ncTracksJobs";
import { respond, scopedStaff } from "../../../_shared";
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await props.params;
    const context = await scopedStaff(req, true);
    if (context.deny) return context.deny;
    return { job: await changeNcTracksJob(context.provider!.id, context.user!.id, id, "retry") };
  });
}
