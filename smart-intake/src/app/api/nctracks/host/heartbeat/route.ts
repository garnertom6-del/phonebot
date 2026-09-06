import { heartbeatNcTracks } from "@/lib/ncTracksJobs";
import { bearer, respond } from "../../_shared";
export async function POST(req: Request) { return respond(() => req.json().then((body) => heartbeatNcTracks(bearer(req), body))); }
