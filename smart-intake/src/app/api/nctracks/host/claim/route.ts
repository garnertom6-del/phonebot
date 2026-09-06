import { claimNcTracks } from "@/lib/ncTracksJobs";
import { bearer, respond } from "../../_shared";
export async function POST(req: Request) { return respond(() => claimNcTracks(bearer(req))); }
