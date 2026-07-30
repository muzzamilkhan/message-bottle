# Mobile companion app — Spec

**Status:** proposed
**Approach:** Option 2 — add a JSON API to the existing Next.js app; build a native
client against it. **No new backend, database, or blob store.**
**Phasing:** Phase 1 ships iOS. Phase 2 adds Android from the same client codebase.

---

## Goal

Let a parent do the core things they do on the web — manage children, write and seal
letters, add photos — from a native phone app. Let a child open a bottle that has reached
its age on their phone. Reuse the current Postgres data, encryption scheme, and Blob store
unchanged.

## Why this shape

The web app has **no API a native client can call**. Every mutation is a Next.js *server
action* in `src/app/actions.ts`, invoked through React's `useActionState` — an RPC
transport bound to the React/Next client runtime, not a public HTTP contract. Reads are
async server components. The only HTTP endpoints today are `/api/auth/[...nextauth]` and
`/api/letter-image/[id]`.

Auth is the second blocker: Auth.js v5 with the **database session strategy** (`src/auth.ts`).
"Signed in" means a session cookie that maps to a `Session` row. Native apps don't carry web
session cookies, and there is no bearer/token path for a non-browser client.

So the work is: **(a) a JSON API over the logic that already exists, and (b) a token auth
path for native clients.** The database, Prisma schema, `letter-crypto`, subscription gating,
and the private Blob store are all reused as-is.

## Non-goals

- No new server, database, or blob store. Same Vercel/Next deployment.
- No reimplementation of business rules in Swift/Kotlin. Rules stay server-side in
  `src/lib/*`; the client is a thin UI over the API. This is what keeps the two invariants
  (below) enforceable.
- No parent-to-parent sharing (deliberately absent from the domain; see CLAUDE.md).
- No offline-first sync or local drafts store in Phase 1. Online-only is fine to start.
- No push notifications in Phase 1 (a natural Phase 2/3 add — "your bottle is ready").
- No billing/subscription purchase flow in-app; `User.subscription` stays hand-set until
  billing exists on web.

## Invariants the API must preserve

These are the point of the product (CLAUDE.md, "The two invariants"). The API is a new
front door to the same house — it must not weaken them.

1. **Sealing is final.** A `Letter` is `DRAFT` or `SENT`. Once `SENT`, the author can never
   read, edit, or delete it. Enforced in the query (`status: "DRAFT"` in every
   `updateMany`/`deleteMany` where-clause), never by a client check. The API surfaces no
   route that could mutate a `SENT` letter.
2. **The time lock is server-side.** When a bottle opens is a property of the *child*
   (`birthday` + `openAtAge`), not the letter. The open endpoint returns **no letter title,
   body, or image bytes** until `hasReachedOpenAge` passes; a locked bottle returns only the
   countdown fields. Letter contents (`title`/`body`) are decrypted **only after** the gate
   passes — a locked response never holds plaintext.

Two more constraints that carry over unchanged:

- **Encryption at rest.** `title`/`body` are AES-256-GCM encrypted in Postgres
  (`src/lib/letter-crypto.ts`). The API encrypts on write and decrypts on read, exactly as
  the server actions and pages do today. Nothing new is stored plaintext.
- **Private image bytes + explicit blob deletion.** Image bytes live in a private Blob store,
  served only through an authorized endpoint, and every delete path removes blobs explicitly
  (blobs first, then rows). The API's image routes reuse `letter-image-store.ts` and the same
  ordering. Reading a sealed letter's photos is never subscription-gated; uploading is.

## Two access models (unchanged, mirrored by the API)

1. **Parent (authenticated).** Ownership is `Child.parentId` — the whole model. A child
   belongs to exactly one parent, who alone may address, edit, or delete their letters. All
   parent API routes resolve the caller to a `User.id` and scope every query to it (read
   children through `getAccessibleChildren`, not inline `parentId`).
2. **Child (unauthenticated).** The unguessable `Child.openToken` *is* the credential. The
   open endpoint takes the token, applies the server-side age gate, and returns letters only
   if the gate passes. No account, no login.

## Auth design (the one genuinely new server-side piece)

Native apps can't ride the browser cookie session. Add a token path that coexists with the
existing web cookie sessions — web keeps working untouched.

- **Sign-in:** native Google Sign-In on-device produces a Google ID token. The client sends
  it to a new `POST /api/mobile/auth/google`. The server verifies the ID token against
  Google, finds-or-creates the `User` (reusing the same identity as the web `Account`/`User`
  so a person is one account across web and mobile), and issues an **app session token**.
- **Token choice (decide in planning):** either (a) mint a `Session` row and hand its
  `sessionToken` to the client as a bearer token — maximal reuse of Auth.js's existing
  session model and its DB-backed revocation — or (b) issue a short-lived signed JWT plus a
  refresh token. Recommendation: **(a)** for Phase 1 — it reuses the `Session` table and the
  same `auth()`-style lookup, with the least new surface. Revisit if statelessness matters.
- **Transport:** `Authorization: Bearer <token>`. A small server helper resolves a bearer
  token to a `User` (the API-route analogue of `auth()`), and every parent route calls it
  and 401s without it.
- **Child token:** no auth header; the `openToken` in the path is the credential, same as
  the web `/open/[token]` page.
- **Storage on device:** the app session token lives in the iOS Keychain (and Android
  Keystore/EncryptedSharedPreferences in Phase 2).

## API surface (v1)

All under `/api/mobile/*`, versioned by path prefix so the contract can evolve without
breaking shipped app builds. JSON in/out. Each route wraps logic already living in
`src/app/actions.ts` + `src/lib/*` — the refactor extracts that logic into pure/service
helpers both the actions and the routes call, so web and mobile can never drift apart.

**Auth**
- `POST /api/mobile/auth/google` — exchange a Google ID token for an app session token.
- `POST /api/mobile/auth/signout` — revoke the current app session token.

**Parent — children** (all require bearer token; all scoped to the caller)
- `GET  /api/mobile/children` — list the caller's children (id, name, avatar, photo?,
  birthday, openAtAge, current age, openToken, whether the bottle has opened).
- `POST /api/mobile/children` — create. Same validation as `createChild` (`child-input`).
- `PATCH /api/mobile/children/:id` — edit. Same validation as `updateChild`.
- `DELETE /api/mobile/children/:id` — delete child + all their letters + photos (mirrors
  `deleteChild`, including blobs-first deletion).

**Parent — letters**
- `GET  /api/mobile/letters` — list the caller's letters (dashboard view), decrypted
  title + status + recipient + timestamps.
- `GET  /api/mobile/letters/:id` — one DRAFT/SENT letter the caller authored, decrypted.
  (Reading a SENT letter you authored is allowed on web today via `letters/[id]`? — confirm
  against current behavior in planning; the API must match the invariant exactly.)
- `POST /api/mobile/letters` — create a draft. Mirrors the create branch of `saveLetter`.
- `PATCH /api/mobile/letters/:id` — update a **draft** (title/body/child). Refuses anything
  not `status: "DRAFT"`.
- `POST /api/mobile/letters/:id/seal` — seal (DRAFT → SENT). One-way, final. Runs the same
  image reconciliation `saveLetter` does at seal time.
- `DELETE /api/mobile/letters/:id` — delete a **draft** only (mirrors `deleteLetter`).

**Parent — images**
- `POST /api/mobile/letters/images` — upload one compressed image, Pro-gated exactly as
  `uploadLetterImage` (the gate is the boundary, not UI). Returns the image id the client
  writes into the body as `[[img:<id>]]`. The client is responsible for the same
  client-side downscale/compress the web editor does before upload.
- `GET  /api/mobile/letters/images/:id` — authorized image bytes for the author. (May simply
  reuse the existing `/api/letter-image/[id]` if bearer-auth is added there; decide in
  planning.)

**Child — open**
- `GET  /api/mobile/open/:token` — the child's bottles for that token. Applies the
  server-side age gate. Locked → countdown fields only, no contents. Open → decrypted
  letters and, per letter, its ordered image ids.
- `GET  /api/mobile/open/:token/images/:id` — image bytes, authorized by the token **and**
  the age gate, exactly as the web open-page image path is.

**Account**
- `DELETE /api/mobile/account` — full account closure (mirrors `deleteAccount`: children,
  letters, photos, then the user; blobs first).

### Cross-cutting

- **Error shape:** actions return `{ error? }` today. The API returns `{ error: { code,
  message } }` with the *code* coming from the existing validation libs (which already return
  codes, not copy) and the message mapped server-side — so the app can localize/branch on
  code and copy stays free to change.
- **Validation reuse:** `child-input`, `letter-input`, `letter-image` libs are the authority.
  Routes adapt JSON → the same parser inputs the actions build from `FormData`.
- **Revalidation/redirects:** `revalidatePath`/`redirect` are web concerns; the API omits
  them and returns the resulting resource instead.

## Native client (both phases, one codebase)

- **Framework:** React Native + Expo. Rationale: closest to the team's existing React +
  TypeScript; lets the client share the pure TypeScript types/validation shapes from
  `src/lib/*`; one codebase serves iOS (Phase 1) and Android (Phase 2). Alternatives
  (Flutter — new language, no code share; native Swift+Kotlin — best feel, ~2× work) are
  rejected for a two-phase, small-team effort.
- **Screens (v1):** sign-in; children list + add/edit/delete; letters list; letter composer
  (text + photos, save draft / seal); a "child open" mode (enter or deep-link a token →
  countdown or open letters). The composer must render/emit the `[[img:<id>]]` body format
  via the API, never invent its own.
- **Deep link:** `messagebottle://open/<token>` (and the existing web `/open/<token>` URL)
  should route into the child open screen.

## Phasing

**Phase 1 — iOS.** Server API + token auth + Expo client, shipped to TestFlight/App Store.
Definition of done: a parent can sign in, manage children, write+seal a letter with a photo,
and a child can open a matured bottle — all on iPhone, against production data, with both
invariants verifiably enforced server-side.

**Phase 2 — Android.** Same Expo codebase: add Android build, swap Keychain → Keystore for
token storage, QA platform differences, ship to Play. No server changes expected beyond
whatever Phase 1 surfaced.

## Open questions (resolve during planning)

1. Token model: reuse `Session` rows as bearer tokens (recommended) vs. JWT+refresh.
2. Whether to extend the existing `/api/letter-image/[id]` with bearer auth or add a parallel
   mobile image route.
3. Exact read rules for a SENT letter via `GET /letters/:id` — must match current web
   behavior and the sealing invariant precisely.
4. Rate limiting / abuse surface on the new public `POST /api/mobile/auth/google` and the
   token-based open endpoints.
5. App Store review considerations for the "child opens a private letter" flow and any
   Google Sign-In policy specifics.
