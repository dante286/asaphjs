import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Server Component / Server Action guard — redirects to /auth if signed out. */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/auth");
  return session;
}
