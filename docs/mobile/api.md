# Mobile API — contract

Every route under `/api/mobile/*`. This is the map; the types are the source of
truth and live in [`src/lib/mobile-contract.ts`](../../src/lib/mobile-contract.ts)
- the Expo client copies that file rather than re-deriving these shapes by
hand (see [`decisions.md`](./decisions.md), item 6).

## Conventions

- **Auth.** `Authorization: Bearer <token>` on every parent route, obtained from
  `POST /auth/google`. The child open routes take no header - the token in the
  path *is* the credential.
- **Responses.** Success is the resource itself, at the status noted per route.
  Every failure is `{ error: { code, message } }` (`ApiErrorBody` in the
  contract file). `code` is stable and safe to branch or localize on; `message`
  is copy and may change without notice.
- **Caching.** Every response is `Cache-Control: private, no-store`. Nothing
  here is ever safe to cache - it's a parent's letters and photos of their kids.
- **Not-yours-to-see is a 404, never a 403.** A 403 would confirm an id exists.
  This holds for a child, a letter, or an image that belongs to someone else.
- **Rate limits.** `POST /auth/google` and both `/open/:token*` routes are rate
  limited per-IP (`RATE_LIMITED`, 429, with `Retry-After`). This is defence in
  depth, not the defence - the real guard on the open routes is that a token is
  24 random bytes.

## Auth

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/auth/google` | POST | none | Body: `{ idToken }`. Returns `{ token, expiresAt, user }`. `SIGN_IN_FAILED` (401) covers every rejection reason - a bad token, an unconfigured audience, anything - deliberately undifferentiated. |
| `/auth/signout` | POST | bearer | Deletes the caller's session row. Always succeeds if the token parses, even an already-expired one. |

## Children

All scoped to the caller via `Child.parentId` - there is no sharing.

| Route | Method | Returns | Notes |
|---|---|---|---|
| `/children` | GET | `{ children: ApiChild[] }` | Oldest first. |
| `/children` | POST | `{ child: ApiChild }`, 201 | Body: name, avatar, birthday (`yyyy-mm-dd`), openAtAge, photo, photoAction. |
| `/children/:id` | PATCH | `{ child: ApiChild }` | Same body as create. `CHILD_NOT_FOUND` (404) if not yours. |
| `/children/:id` | DELETE | `{ deleted: id }` | Cascades to every letter written to them, drafts and sealed alike, and every photo inside - blobs first, then rows, one transaction. Irreversible. |

## Letters

All scoped to `Letter.authorId`. **A sealed (`SENT`) letter is unreachable
through any of these except as a number** - see the list route below. That is
the sealing invariant, not an oversight: the author can never read, edit, or
delete a letter once it's sent, not even its title.

| Route | Method | Returns | Notes |
|---|---|---|---|
| `/letters` | GET | `{ drafts: ApiLetterSummary[], sentCount: number }` | Drafts in full; sealed letters as a count and nothing else. |
| `/letters` | POST | `{ id }`, 201 | Always creates a `DRAFT`. Body: title, childId, body. |
| `/letters/:id` | GET | `{ letter: ApiLetterDetail }` | Draft only. `NOT_FOUND` for a sealed, missing, or someone else's letter - all three look identical from outside. |
| `/letters/:id` | PATCH | `{ letter: ApiLetterDetail }` | Draft only (`LETTER_NOT_EDITABLE`, 404, otherwise). Can never seal - `intent` is fixed server-side, regardless of what the body sends. |
| `/letters/:id/seal` | POST | `{ id, sealed: true }` | DRAFT → SENT. One-way. No body: seals what is *stored*, not what the client sends, so nothing can be smuggled in alongside the permanence. Runs the full completeness and photo-entitlement checks. |
| `/letters/:id` | DELETE | `{ deleted: id }` | Draft only. |

## Images

Uploading is Pro-gated (`IMAGE_NOT_PRO`). **Reading never is** - a letter sealed
while its author was Pro keeps its photos forever, and the child on the other
end has no account at all.

| Route | Method | Returns | Notes |
|---|---|---|---|
| `/letters/images` | POST | `{ image: { id, width, height } }`, 201 | `multipart/form-data`: `image` (file), `width`, `height`, optional `letterId`. Every size/type/dimension/count check is server-side; client-side downscaling is a courtesy only. |
| `/letters/images/:id` | GET | image bytes | Scoped to the caller as author. |

## The child's open link

No auth header anywhere in this section - the `openToken` in the path is the
whole credential, same as the web `/open/[token]` page.

| Route | Method | Returns | Notes |
|---|---|---|---|
| `/open/:token` | GET | `ApiBottles` | Three states - see below. `?test=yes` bypasses the age gate, but only when the deployment has the `open-bottle-bypass` flag on; inert otherwise. |
| `/open/:token/images/:id` | GET | image bytes | Authorized by token match **and** the age gate, re-checked on every request regardless of what the bottles route already returned. |

`ApiBottles` (`src/lib/mobile-contract.ts`) is a discriminated union on
`status`:

- `"unavailable"` - unknown token, or the child's timer was never set. Reads
  identically to a bad token on purpose, so this can't become an oracle.
- `"locked"` - `{ child, opensAt, letterCount }`. **No field here can hold a
  title, a body, or an image id** - that shape is the time-lock invariant,
  restated as a type. Don't add one.
- `"open"` - `{ child, opensAt, letters: ApiOpenLetter[] }`. Full contents,
  decrypted, only after the gate has passed.

## Account

| Route | Method | Returns | Notes |
|---|---|---|---|
| `/account` | DELETE | `{ ok: true }` | Every child, every letter, every photo, then the user - blobs first. Deleting the user cascades to every session, so this token (and every other device's) stops working the moment it returns. |

## Error codes

`UNAUTHORIZED` (401), `NOT_FOUND` (404), `BAD_REQUEST` (400), `RATE_LIMITED`
(429), and `SIGN_IN_FAILED` (401, sign-in only) come from the API layer itself.
Everything else is a code from the service or validation layer, forwarded
as-is - the app and the web form refuse for the same reasons, in the same
words, because both call the same function:

- **Children:** `CHILD_NOT_FOUND` (404) · `NAME_REQUIRED` ·
  `BIRTHDAY_REQUIRED` · `BIRTHDAY_INVALID` · `OPEN_AGE_REQUIRED` ·
  `OPEN_AGE_NOT_A_YEAR_COUNT` · `OPEN_AGE_NOT_IN_FUTURE` · plus the child-photo
  codes (`childPhotoMessage` in `src/lib/child-photo.ts`).
- **Letters:** `LETTER_NOT_EDITABLE` (404) · `CHILD_NOT_YOURS` ·
  `SEND_INCOMPLETE` · `DRAFT_NEEDS_TITLE` · `SEND_IMAGES_NOT_ALLOWED` ·
  `TOO_MANY_IMAGES`.
- **Images:** `IMAGE_NOT_AN_IMAGE` · `IMAGE_MALFORMED` · `IMAGE_TOO_LARGE` ·
  `IMAGE_TOO_LARGE_TO_READ` · `IMAGE_TOO_MANY` · `IMAGE_NOT_PRO`.

All but the two marked 404 are 400. The full, current list of codes is the
union types in `child-service.ts`, `letter-service.ts`, and `letter-image.ts` -
treat this table as an index, not the authority, if the two ever disagree.
