import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

// Testing escape hatch for the open page's age gate. See the comment in
// src/app/open/[token]/page.tsx - this only unseals bottles alongside
// `?test=yes`, and is off unless the deployment turns it on.
const bypassFlag = flag({
  key: "open-bottle-bypass",
  adapter: vercelAdapter(),
});

// Evaluating the flag can throw, not just return false - an unset EDGE_CONFIG
// or an unresolvable adapter dependency both surface as an exception. This
// guards children's photos, so it fails closed: any failure to *prove* the
// bypass is on is treated as off, and bottles stay sealed.
//
// The warning is deliberate. Swallowing the error silently would make a
// genuinely broken flag configuration in production look identical to the flag
// simply being off, which is exactly the kind of thing that goes unnoticed.
export async function openBottleBypass(): Promise<boolean> {
  try {
    return Boolean(await bypassFlag());
  } catch (error) {
    console.warn(
      "open-bottle-bypass could not be evaluated; treating it as off",
      error,
    );
    return false;
  }
}

// Limited-time promotion: while this is on, the home page shows a banner
// advertising lifetime Pro for new signups, and every newly created user is
// granted the PRO tier by default (see events.createUser in src/auth.ts). Off
// unless the deployment turns it on - an unset EDGE_CONFIG leaves it off.
const lifetimeProSignupFlag = flag({
  key: "lifetime-pro-signup",
  adapter: vercelAdapter(),
});

// Fails closed, like openBottleBypass: any failure to *prove* the promotion is
// on is treated as off, so a broken flag config never silently hands out Pro
// memberships or shows an offer the deployment can't honor.
export async function lifetimeProSignup(): Promise<boolean> {
  try {
    return Boolean(await lifetimeProSignupFlag());
  } catch (error) {
    console.warn(
      "lifetime-pro-signup could not be evaluated; treating it as off",
      error,
    );
    return false;
  }
}
