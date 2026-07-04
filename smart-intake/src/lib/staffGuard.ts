import { NextResponse } from "next/server";
import { currentUser } from "./auth";

export async function requireStaff() {
  const user = await currentUser();
  if (!user) {
    return { user: null, deny: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  return { user, deny: null };
}
