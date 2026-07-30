# Mobile companion app — Implementation plan

Companion to [`spec.md`](./spec.md). Ordered, reviewable steps. The guiding principle:
**extract the logic the server actions already contain into service helpers, then expose
those helpers over JSON.** No business rule is rewritten; the web and the API call the same
functions, so they can't drift.

Each numbered step is meant to be a small, self-contained change set. Steps 0–7 are the
server API (do these in this repo). Steps 8–12 are the Expo client (likely a separate repo
or a `mobile/` workspace — decide in step 8).

---

## Step 0 — Decisions to lock first

Resolve the spec's open questions before writing routes:

- **Token model:** default to minting `Session` rows and returning `sessionToken` as the
  bearer token (reuses the existing table + revocation). Only switch to JWT+refresh if a
  concrete need appears.
- **Image route:** default to a dedicated `/api/mobile/letters/images/:id` that shares the
  `letter-image-store.ts` helper, rather than overloading the web `/api/letter-image/[id]`.
- **Env:** confirm `GOOGLE_CLIENT_ID`(s) available for verifying native ID tokens (iOS and
  later Android each have their own OAuth client id; the verifier must accept all valid
  audiences).

Output: a short ADR appended to this file or `docs/mobile/decisions.md`.

## Step 1 — Extract action logic into reusable services

The actions in `src/app/actions.ts` mix three things: auth (`await auth()`), the actual
rule/DB work, and web glue (`revalidatePath`, `redirect`, `FormData` parsing). Split the
middle out so both the action and a future route can call it.

- For each of `saveLetter`, `createChild`, `updateChild`, `deleteChild`, `deleteLetter`,
  `uploadLetterImage`, `deleteAccount`, add a plain service function in `src/lib/` (e.g.
  `src/lib/letters.ts`, extend `src/lib/children.ts`) that takes **plain values + a userId**
  and returns **plain values or a typed error code** — no `FormData`, no `revalidatePath`,
  no `redirect`.
- Rewrite the existing actions to: parse `FormData` → call the service → map result to the
  action's `{ error?, ok?, values? }` + `revalidatePath`/`redirect`. **Web behavior must be
  identical after this step** — this is a pure refactor.
- Keep validation in the existing libs (`child-input`, `letter-input`, `letter-image`); the
  services consume their parsed output. Keep encryption via `letter-crypto-key` inside the
  services (encrypt on write, decrypt on read) so both front doors inherit it.
- **Tests:** the services are now pure-ish (userId + values in, values/codes out) — add
  `node --test` coverage per the repo's testing philosophy. This is the safety net for the
  refactor.

*This step is the bulk of the value and the main risk. Ship and verify it (web app still
works end-to-end) before adding any route.*

## Step 2 — Bearer-auth helper for API routes

- Add `src/lib/mobile-auth.ts` (thin, env/DB-touching, untested per the repo's split): given
  a request, read `Authorization: Bearer <token>`, look up the matching `Session` row (not
  expired), return the `User.id` or null. This is the API analogue of `auth()`.
- Add a `requireUser(req)` wrapper that 401s uniformly when absent.

## Step 3 — Google ID-token sign-in endpoint

- `POST /api/mobile/auth/google`: verify the posted Google ID token (audience = the app's
  Google client id(s); use Google's tokeninfo/JWKS), find-or-create the `User` and its
  Google `Account` so mobile and web resolve to **one** user identity, mint a `Session` row,
  return `{ token, user }`.
- `POST /api/mobile/auth/signout`: delete the caller's `Session` row.
- Reuse the `createUser` lifetime-Pro promotion behavior (the Auth.js `events.createUser`
  hook) so a first-ever sign-in on mobile gets the same treatment as on web — factor that
  promotion into a helper both paths call if needed.

## Step 4 — Parent children routes

`GET/POST /api/mobile/children`, `PATCH/DELETE /api/mobile/children/:id`. Each: `requireUser`
→ call the child service from step 1 → return JSON (or `{ error: { code, message } }`).
`DELETE` reuses the exact `deleteChild` service (blobs-first, transactional). Reads use
`getAccessibleChildren`.

## Step 5 — Parent letters routes

`GET /api/mobile/letters`, `GET /api/mobile/letters/:id`, `POST /api/mobile/letters`,
`PATCH /api/mobile/letters/:id`, `POST /api/mobile/letters/:id/seal`,
`DELETE /api/mobile/letters/:id`.

- All go through the `saveLetter`/`deleteLetter` services. The `seal` route is the SENT
  flip and runs the same image reconciliation.
- **Invariant checks to assert with tests:** every mutating route refuses a non-`DRAFT`
  letter; `GET`/list never returns contents for a letter the caller didn't author; decrypt
  happens in the service, so the route can't accidentally return ciphertext or plaintext it
  shouldn't.

## Step 6 — Image routes

- `POST /api/mobile/letters/images`: `requireUser` → same Pro gate (`canUploadImages`) and
  same `validateUpload` + `putLetterImage` as `uploadLetterImage`. Accept a binary body or
  multipart; return `{ image: { id, width, height } }`.
- `GET /api/mobile/letters/images/:id`: authorize as author, stream bytes via the store
  helper.

## Step 7 — Child open routes (the age gate)

- `GET /api/mobile/open/:token`: load the child by `openToken`; compute `hasReachedOpenAge`
  server-side. **Locked** → return `{ locked: true, countdown: {...}, child: { name,
  avatar } }` and **nothing else**. **Open** → decrypt and return letters + per-letter
  ordered image ids.
- `GET /api/mobile/open/:token/images/:id`: authorize by token **and** the age gate before
  streaming, exactly as the web open image path does.
- **Tests:** a locked response contains no `title`/`body`/image bytes; an open response does;
  decryption only runs on the open branch. This is the highest-value test in the API.

## Step 7a — Account route

- `DELETE /api/mobile/account`: reuse the `deleteAccount` service (blobs first, then the
  user cascade), then revoke the caller's `Session`.

## Step 7b — Cross-cutting API concerns

- Uniform JSON error envelope `{ error: { code, message } }`, code from the validation libs.
- Basic rate limiting on `POST /api/mobile/auth/google` and the `open/:token` routes.
- A tiny contract doc (or generated OpenAPI/TypeScript types) checked into `docs/mobile/`
  so the client and server share one source of truth for request/response shapes. Prefer a
  shared `src/lib/mobile-contract.ts` of types the routes import and the client can copy.

## Step 8 — Client scaffold (Phase 1: iOS)

- Create the Expo app (TypeScript). Decide location: separate repo vs. a `mobile/` folder /
  workspace in this repo. Recommendation: **separate repo** to keep this repo's Node-test /
  Next tooling clean, but copy or publish the `mobile-contract` types.
- App config, navigation, secure token storage in the iOS Keychain, a typed API client that
  attaches the bearer token and surfaces the `{ error: { code } }` envelope.

## Step 9 — Auth flow (client)

Native Google Sign-In → post ID token to `/api/mobile/auth/google` → store the returned app
token in Keychain → authenticated state. Sign-out clears it and calls the signout route.

## Step 10 — Parent screens (client)

Children list + add/edit/delete; letters list; letter composer (text + photo blocks; the
composer emits the `[[img:<id>]]` body format the API expects and does the client-side image
downscale before `POST .../images`); save-draft and seal actions with the "sealing is final"
confirmation.

## Step 11 — Child open screen (client)

Enter or deep-link (`messagebottle://open/<token>`) a token → call `/open/:token` → render
countdown when locked, letters + photos when open. Never attempts to fetch contents while
locked (the server wouldn't return them anyway — the client just mirrors the state).

## Step 12 — Phase 1 hardening + ship

Manual end-to-end against production-like data; verify both invariants from the client's
perspective (can't edit a sealed letter; a not-yet-mature bottle shows only a countdown and
no bytes cross the wire). TestFlight → App Store.

## Step 13 — Phase 2: Android

Add the Android build target to the same Expo app; swap Keychain → Android Keystore /
EncryptedSharedPreferences; add the Android Google OAuth client id to the server verifier's
accepted audiences; QA platform differences; ship to Play. Expect **no server changes**
beyond anything Phase 1 surfaced.

---

## Sequencing / dependencies

- Steps **0–1** gate everything (the refactor is the foundation). Do not start routes until
  step 1 is merged and the web app is verified unchanged.
- Steps **2–3** gate all parent routes (4–7a).
- Steps **4–7a** can proceed in parallel once auth exists.
- Client steps **8–12** need the API deployed to a reachable environment; they can begin
  against a staging deploy as soon as auth + one resource route exist.
- Phase 2 (13) starts only after Phase 1 ships.

## Definition of done (Phase 1)

A parent signs in on iPhone, manages children, writes and seals a letter with a photo; a
child opens a matured bottle on iPhone — all against production data, with the sealing and
time-lock invariants enforced **server-side** and demonstrated by tests on the new services
and open route.
