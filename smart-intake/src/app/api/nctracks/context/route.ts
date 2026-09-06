import { ncTracksContext } from "@/lib/ncTracksJobs";
import { isMasterUser } from "@/lib/staffGuard";
import { respond, scopedStaff } from "../_shared";
export async function GET(req: Request) {
  return respond(async () => {
    const context = await scopedStaff(req);
    if (context.deny) return context.deny;
    return ncTracksContext(context.provider!.id, isMasterUser(context.user!) || context.membership?.role === "PROVIDER_ADMIN");
  });
}
