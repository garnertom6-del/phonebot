import { requireProviderAdmin } from "@/lib/staffGuard";
import { configureNcTracks, ncTracksConfiguration, NcTracksJobError } from "@/lib/ncTracksJobs";
import { providerQuery, respond } from "../_shared";
export async function GET(req: Request) {
  return respond(async () => {
    const context = await requireProviderAdmin({ providerId: providerQuery(req) });
    if (context.deny) return context.deny;
    if (!context.provider) throw new NcTracksJobError("Select a provider workspace.", 400);
    return ncTracksConfiguration(context.provider.id);
  });
}
export async function POST(req: Request) {
  return respond(async () => {
    const context = await requireProviderAdmin({ providerId: providerQuery(req) });
    if (context.deny) return context.deny;
    if (!context.provider) throw new NcTracksJobError("Select a provider workspace.", 400);
    return configureNcTracks(context.provider.id, context.user!.id, await req.json());
  });
}
