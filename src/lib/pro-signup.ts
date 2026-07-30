// The lifetime-Pro promotion, in one place.
//
// It used to live only in `events.createUser` in src/auth.ts, which the Auth.js
// adapter fires for a web signup. Mobile sign-in creates users through its own
// route and never reaches that hook, so the promotion moved here and both paths
// call it - otherwise the phone would quietly hand out a different membership
// than the browser for the same brand-new account.

import { prisma } from "@/lib/prisma";
import { lifetimeProSignup } from "@/flags";

// Grant PRO to a brand-new user while the promotion is running.
//
// The flag fails closed, so if it can't be proven on, the signup stays free.
// This only ever grants Pro; it never revokes it, so turning the flag off later
// leaves already-promoted members untouched.
export async function promoteNewUser(userId: string): Promise<void> {
  if (!userId) return;
  if (!(await lifetimeProSignup())) return;

  await prisma.user.update({
    where: { id: userId },
    data: { subscription: "PRO" },
  });
}
