import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { firstOrgForUser } from "@/lib/orgs";

export default async function HomePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const org = await firstOrgForUser(userId);
  // A signed-in user always has an org (sign-up creates one), but if a
  // membership was removed there is nothing to show them.
  redirect(org ? `/${org.slug}` : "/signup");
}
