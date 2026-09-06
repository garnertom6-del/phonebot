import { resultNcTracks } from "@/lib/ncTracksJobs";
import { bearer, respond } from "../../../../_shared";
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  return respond(async () => ({ job: await resultNcTracks(bearer(req), (await props.params).id, await req.json()) }));
}
