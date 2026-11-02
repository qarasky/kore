import "server-only";

import { cookies } from "next/headers";
import { prefsFrom, type Prefs } from "./prefs";

/** The signed-in person's display preferences, from their cookies. */
export async function getPrefs(): Promise<Prefs> {
  const jar = await cookies();
  return prefsFrom((n) => jar.get(n)?.value);
}
