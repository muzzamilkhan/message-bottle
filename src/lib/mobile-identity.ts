// Resolve a verified Google identity to a User row.
//
// The whole job is making sure a person is *one* account across web and mobile.
// Auth.js's Prisma adapter keys a Google login on `Account(provider,
// providerAccountId)` with provider "google" and providerAccountId set to
// Google's `sub`, so this writes exactly those - a mobile-first signup must be
// indistinguishable from a web one, or the same person signing in on the other
// device would find an empty account.
//
// Untested by design (it needs a database).

import { prisma } from "@/lib/prisma";
import type { GoogleIdentity } from "./google-id-token.ts";
import { promoteNewUser } from "./pro-signup.ts";

const PROVIDER = "google";
// Auth.js records Google as an OIDC provider; matching it keeps a row written
// here identical to one the adapter would have written.
const PROVIDER_TYPE = "oidc";

export type ResolvedUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

const USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

// Find the user this Google identity belongs to, creating them on a first-ever
// sign-in.
export async function resolveGoogleUser(
  identity: GoogleIdentity,
): Promise<ResolvedUser> {
  // 1. Signed in here before, on either platform. The account link is the
  //    authority - `sub` is stable even if the person changes their email.
  const linked = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: PROVIDER,
        providerAccountId: identity.sub,
      },
    },
    select: { user: { select: USER_FIELDS } },
  });
  if (linked) return linked.user;

  // 2. An existing user with this email but no Google account link. In practice
  //    that is a web user whose Account row predates nothing - the adapter
  //    always writes one - so this is mostly a safety net. Linking rather than
  //    creating avoids a duplicate account for the same person.
  //
  //    Safe only because Google verified the address for us: an unverified
  //    email would make this an account-takeover primitive.
  if (identity.email) {
    const existing = await prisma.user.findUnique({
      where: { email: identity.email },
      select: USER_FIELDS,
    });
    if (existing) {
      await prisma.account.create({
        data: {
          userId: existing.id,
          type: PROVIDER_TYPE,
          provider: PROVIDER,
          providerAccountId: identity.sub,
        },
      });
      return existing;
    }
  }

  // 3. Brand new. Create the user and their account link together, so a failure
  //    can't leave a user nothing can sign into.
  const created = await prisma.user.create({
    data: {
      name: identity.name,
      email: identity.email,
      image: identity.picture,
      accounts: {
        create: {
          type: PROVIDER_TYPE,
          provider: PROVIDER,
          providerAccountId: identity.sub,
        },
      },
    },
    select: USER_FIELDS,
  });

  // The same promotion a web signup gets - the Auth.js createUser hook never
  // fires for this path, so it is called explicitly.
  await promoteNewUser(created.id);

  return created;
}
