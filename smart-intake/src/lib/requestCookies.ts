import { cookies } from "next/headers";

type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

let testCookies: CookieReader | null = null;

/** Test-only cookie source so route handlers can run outside Next's request scope. */
export function bindTestCookies(reader: CookieReader | null) {
  testCookies = reader;
}

export async function readRequestCookie(name: string): Promise<string | undefined> {
  if (testCookies) return testCookies.get(name)?.value;
  try {
    return (await cookies()).get(name)?.value;
  } catch {
    return undefined;
  }
}
