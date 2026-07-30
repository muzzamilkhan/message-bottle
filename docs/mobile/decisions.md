# Mobile companion app — decisions

Resolves the open questions in [`spec.md`](./spec.md) and step 0 of [`plan.md`](./plan.md).
Each entry is the decision, then why, then what it forecloses.

---

## 1. The bearer token is a `Session` row

**Decision.** `POST /api/mobile/auth/google` mints a row in the existing `Session` table and
returns its `sessionToken` as the bearer token. No JWT, no refresh token.

**Why.** It reuses the table Auth.js already writes, the same expiry column, and the same
revocation story: deleting the row signs the device out, and the `onDelete: Cascade` from
`User` means account deletion already revokes every mobile session for free. A JWT+refresh
pair would add two new secrets, a rotation endpoint, and a revocation list, to solve a
statelessness problem this app does not have — `auth()` already hits Postgres on every web
request.

**What it costs, knowingly.** The token is the same value class as a web session cookie, so
a leaked mobile token is a leaked web session too, and a web sign-out that deletes the row
signs the phone out as well. That is the same blast radius as a stolen cookie, which the app
already lives with. Two consequences we accept rather than paper over:

- Mobile sessions get an **explicit expiry** set at mint time, not an inherited default.
- Rotating to JWTs later is a v2 concern; the `/api/mobile/*` path prefix is what makes that
  possible without breaking shipped builds.

## 2. Mobile images get their own route

**Decision.** `GET /api/mobile/letters/images/:id` and `GET /api/mobile/open/:token/images/:id`
are new routes that share `letter-image-store.ts` with the web route. The existing
`/api/letter-image/[id]` is left exactly as it is — no bearer auth bolted onto it.

**Why.** That route's authorization is a single function with two branches (cookie session
author, or `?t=` open token past the age gate). Adding a third principal to it makes the one
place that guards children's photographs harder to read, for no gain: the mobile routes want
different response semantics anyway (JSON errors for the parent route, and the open route
authorizes by path token rather than query string). Separate routes, one shared store helper,
one shared age-gate function.

## 3. Google audiences come from the environment, as a list

**Decision.** The ID-token verifier accepts any audience listed in
`GOOGLE_MOBILE_CLIENT_IDS` (comma-separated), falling back to `AUTH_GOOGLE_ID` /
`GOOGLE_CLIENT_ID`. Verification is against Google's published JWKS with issuer pinned to
`accounts.google.com` / `https://accounts.google.com`.

**Why.** iOS and Android each get their own OAuth client id, and Phase 2 must not need a code
change — only a new value in the list. Making it a list from the start means the Android
launch is a config edit.

**Unresolved and not blocking.** The actual client id values do not exist yet (no OAuth
clients have been created for the native apps). The verifier reads them from the environment,
so the server code is complete without them; sign-in simply fails closed with an unconfigured
audience until they are set. Creating the OAuth clients is a step-8 task.

## 4. A SENT letter is never readable by its author — including its title

**Decision.** `GET /api/mobile/letters` returns **drafts in full plus a count of sent
letters**. `GET /api/mobile/letters/:id` serves DRAFT only and 404s anything else.

**Why.** This corrects `spec.md`'s API surface, which proposed listing "decrypted title +
status + recipient" for every letter. That is not what the web does. `src/app/dashboard/page.tsx`
queries `status: "DRAFT"` for the list and only `count`s the SENT ones — no sent title is ever
decrypted — and `src/app/letters/[id]/page.tsx` 404s any letter that is not `DRAFT`. Sealing is
final means final for reads too, so the API mirrors the pages exactly. Spec open question 3 is
answered: **no**.

## 5. Rate limiting

**Decision.** Fixed-window, in-memory, per-IP limiting on the two unauthenticated surfaces —
`POST /api/mobile/auth/google` and the `open/:token` routes. No Redis, no new service.

**Why.** The threat is token-guessing against `openToken` and sign-in spam, and a per-instance
window blunts both at the cost of being imperfect across serverless instances. `openToken` is
24 random bytes, so the limiter is defence in depth rather than the actual defence. Adding a
shared store is a change we can make when there is traffic to justify it.

## 6. The Expo client lives in its own repository

**Decision.** Separate repo. The shared request/response types live here in
`src/lib/mobile-contract.ts`, and the client copies (later: publishes) them.

**Why.** This repo's test story is `node --test` with native TypeScript stripping and no
bundler, and its pre-commit hook runs lint + tests + typecheck over the whole tree. Expo
brings its own toolchain, its own lint config, and a much heavier install; folding it in here
would tangle both. The cost is that the contract types are copied rather than imported, which
is why they live in one file with no runtime dependencies.

---

## Scope note on step 1's tests

`plan.md` step 1 says the extracted services should get `node --test` coverage. Read against
`CLAUDE.md`'s testing philosophy that is not quite right: these services take a `userId` and
talk to Prisma, so verifying them needs a database — the exact smell the philosophy names.
So the split we actually use is:

- **Services** (`child-service.ts`, `letter-service.ts`, `account-service.ts`) are DB
  orchestration and stay **untested**, alongside `children.ts`, `prisma.ts`,
  `letter-crypto-key.ts`, and `letter-image-store.ts`.
- Any genuine **rule** inside them is pushed into a pure lib and tested there. The rules were
  already in `child-input`, `letter-input`, `letter-image`, and `letter-body`; the one new
  extraction is `open-bottle.ts`, the locked/open projection, which is where the time-lock
  invariant actually lives and is the highest-value test in this work.
