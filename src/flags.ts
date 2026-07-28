import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

// Testing escape hatch for the open page's age gate. See the comment in
// src/app/open/[token]/page.tsx — this only unseals bottles alongside
// `?test=yes`, and is off unless the deployment turns it on.
const bypassFlag = flag({
  key: "open-bottle-bypass",
  adapter: vercelAdapter(),
});

// Evaluating the flag can throw, not just return false — an unset EDGE_CONFIG
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
