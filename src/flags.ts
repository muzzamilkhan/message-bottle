import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

// Testing escape hatch for the open page's age gate. See the comment in
// src/app/open/[token]/page.tsx — this only unseals bottles alongside
// `?test=yes`, and is off unless the deployment turns it on.
export const openBottleBypass = flag({
  key: "open-bottle-bypass",
  adapter: vercelAdapter(),
});
