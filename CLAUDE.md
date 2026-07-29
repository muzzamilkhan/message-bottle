# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

This is a hobby project. Work directly on `main` — no feature branches, no PRs.
Make atomic commits (one logical change each) and push `main` when the work is done.

A pre-commit hook runs lint, tests, and typecheck. It lives in `.githooks/` (tracked, so
it survives a reclone) and needs enabling once per clone:

```bash
git config core.hooksPath .githooks
```

It checks the working tree rather than the staged snapshot — fine here, where commits are
whole-file.

**Never skip the hook.** Do not use `git commit --no-verify`, and do not unset
`core.hooksPath`, disable a check, or narrow its scope to get a commit through. If the hook
fails, fix what it caught. If the failure is in code you didn't touch, say so and stop
rather than committing around it — a red check is a finding, not an obstacle.

`.github/workflows/ci.yml` runs the same three checks on every push and PR to `main`. The
hook is opt-in per clone, so CI is the backstop that keeps `main` green — keep the two in
step when adding a check to either. CI pins **Node 24** because the
tests depend on its native TypeScript stripping, and runs the checks rather than
`npm run build`, which would need a live database.

## Commands

```bash
npm run dev          # dev server (already running on :3000 — see dev.log, don't start another)
npm run build        # prisma generate + prisma db push + next build
npm test             # node --test over src/**/*.test.ts
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . (flat config)
npm run db:push      # apply prisma/schema.prisma to the database
npm run db:studio    # Prisma Studio
```

Run a single file with `node --test src/lib/age.test.ts`, or one case with
`node --test --test-name-pattern "leap-day"`.

Tests use Node's built-in runner and its native TypeScript stripping — no jest/vitest, no
transform step. Two consequences: modules under `src/lib/` import each other with
**relative paths and explicit `.ts` extensions** (the `@/` alias needs a bundler Node
doesn't have), and `allowImportingTsExtensions` is set in tsconfig. App code outside
`src/lib/` still uses `@/`.

`npm run build` is not a safe verification command — see the warning above. Use
`npm test && npm run typecheck && npm run lint`, and `npx next build` with a throwaway
`DATABASE_URL` if you need to confirm a real build.

Lint is ESLint 9 flat config (`eslint.config.mjs`) run through the ESLint CLI. `next lint`
is deprecated in Next 15 and gone in 16, and `eslint-config-next@15.x` ships only legacy
`.eslintrc` files whose `@rushstack/eslint-patch` shim crashes on ESLint 9.39 — so the Next
plugins are composed directly in the config rather than via that preset. Keep ESLint on 9.x:
`eslint-config-next`'s peer range stops there, and `npm audit fix --force` would upgrade to
10 and break the setup. The remaining `brace-expansion` advisories are devDependency-only
(a linter reading local source); overriding to the patched 5.x breaks `minimatch` and
crashes ESLint, so leave them.

Because a parent's kids are called "children" throughout the domain, components take them
as **`childOptions`**, never a `children` prop — that name is React's, and passing data
through it trips `react/no-children-prop`.

## Testing philosophy

Keep tests lean. Test **pure functions** — date/age math, countdown formatting, input
parsing and validation — and don't test server components, Prisma queries, or React
rendering. Where a server action or page grows non-trivial logic, move that logic into a
pure helper in `src/lib/` that takes plain values and returns plain values, then test the
helper. The action keeps auth, the database call, and `revalidatePath`; the rules live in
a lib.

A good smell test: if verifying a rule requires a session, a database, or a rendered DOM,
the rule is in the wrong place.

Pure libs take an **injectable clock** (`now`/`at` defaulting to `new Date()`) so date
rules are deterministic under test. Validation libs return **error codes**, not copy, and
the calling action maps a code to its message — so tests assert on rules and wording stays
free to change. The tested libs are `age`, `letters`, `child-input`, `letter-input`, `letter-stack-style`,
`letter-blocks`, `letter-rich-text`, and `letter-crypto`; `children.ts`, `prisma.ts`, and
`letter-crypto-key.ts` are DB/env access and stay untested.

Note that `npm run build` runs `prisma db push --accept-data-loss` against `DATABASE_URL`
before building — it is not a read-only check.

## Stack

Next.js 15 App Router (React 19, all pages are async server components), Postgres via
Prisma 6, Auth.js v5 beta (`next-auth@5`) with the Prisma adapter and Google as the sole
provider, Tailwind. Path alias `@/*` → `src/*`.

Sessions use the **database** strategy, so `auth()` hits Postgres; `src/auth.ts` copies
`user.id` onto `session.user.id` (typed in `src/types/next-auth.d.ts`). Nearly every
server action starts with `const session = await auth()` and bails without `session.user.id`.

## Architecture

All mutations live in a single `"use server"` file, `src/app/actions.ts`, and are consumed
by client components through `useActionState`. Actions return a state object
(`{ error?, ok?, values? }`) rather than throwing; child forms echo the raw submitted
strings back in `values` so an error re-render can repopulate fields React would otherwise
reset. Successful actions call `revalidatePath` on each affected route before redirecting.

### Two access models

1. **Parent (authenticated).** Ownership is `Child.parentId`, and it is the whole model:
   a child belongs to exactly one parent, who alone may address letters to them, edit
   them, or delete them. Read children through `getAccessibleChildren` in
   `src/lib/children.ts` rather than querying `parentId` inline.

   There is deliberately **no sharing between parents**. It existed once (`ChildShare`,
   `ShareInvite`) and was removed: a co-parent's letter photos lived under a child they
   didn't own, so they could neither delete that child nor pull their own images back out
   — only the owner could. Sole ownership is what makes "delete the child, and every
   photo goes with it" a promise the app can actually keep. Don't reintroduce it.
2. **Child (unauthenticated).** `/open/[token]` is self-authenticating: the unguessable
   `Child.openToken` *is* the credential. Tokens are `randomBytes(24).toString("base64url")`.

### The two invariants

These are the point of the app; changes must not weaken them.

- **Sealing is final.** A `Letter` is `DRAFT` or `SENT`. Once `SENT`, the author can never
  view, edit, or delete it — enforced by including `status: "DRAFT"` in the `where` of
  every letter `updateMany`/`deleteMany`, never by a UI check.
- **The time lock is server-side.** When a bottle opens is a property of the *child*
  (`birthday` + `openAtAge`), not of the letter. `/open/[token]/page.tsx` sends no letter
  body to the browser until `hasReachedOpenAge` passes; the locked branch renders a
  countdown only. Keep it that way — never ship letter content and hide it client-side.

The one exception: when the `open-bottle-bypass` feature flag is enabled, `?test=yes` on the
open page bypasses the age gate. Flags are declared in `src/flags.ts` using the Vercel
adapter (`flags/next` + `@flags-sdk/vercel`), backed by Edge Config and overridable from the
Vercel Toolbar. With the flag off — its default, and the case wherever `EDGE_CONFIG` is
unset — the query param is inert. The flag is only evaluated when `?test=yes` is actually
present, so normal opens cost no flag lookup.

### Letter contents encrypted at rest

A letter's `title` and `body` are stored **encrypted** in Postgres. They're the private
message a parent writes, and application-level encryption keeps a database dump — a stolen
backup, a leaked replica — from exposing them. The key lives only in
`LETTER_ENCRYPTION_KEY` (32 bytes, hex or base64), never in the database, so the two have to
leak together to matter. `recipientName` stays plaintext: it mirrors `Child.name`, which is
already plaintext, so encrypting the snapshot would buy nothing.

The scheme is AES-256-GCM with a fresh per-field IV; the stored string is
`enc:v1:<base64url(iv‖tag‖ciphertext)>`. The pure rules live in `src/lib/letter-crypto.ts`
(tested with an injected key); `src/lib/letter-crypto-key.ts` is the thin, untested half that
reads the key from the environment — the same split as `letter-image.ts` / `letter-image-store.ts`.

Three things follow, and changes must not weaken them:

- **Encrypt on write, decrypt on read.** `saveLetter` encrypts `title`/`body` before they
  touch the DB; the three read points — `dashboard`, `letters/[id]`, and `open/[token]` —
  decrypt. The `open` page decrypts **only after the age gate passes**, so a locked page
  never holds plaintext. Image-marker parsing and reconciliation read the *plaintext* body
  the parser returned, never the stored copy, so encryption doesn't touch them. No query
  filters on `title`/`body` content, so nothing else breaks.
- **Legacy plaintext reads through.** `decryptField` returns any value without the `enc:v1:`
  prefix untouched, so rows written before encryption still render. New writes are always
  encrypted, so that set only shrinks. `npm run db:encrypt-letters` backfills existing rows
  (idempotent — it skips already-encrypted ones).
- **Fail-closed, fail-loud.** With no key set, reading an encrypted letter or writing any
  letter throws rather than silently storing plaintext (reading a legacy plaintext row needs
  no key, so that stays open). A prefixed value that won't decrypt — wrong key, tampering,
  truncation — throws rather than rendering garbage. So **don't rotate the key in place** once
  encrypted letters exist: the old rows were sealed with the old key and a new `v1` key can't
  open them. A real rotation is a future `v2` that decrypts under either key.

### Inline letter images

Letter bodies may contain `[[img:<id>]]` markers referencing `LetterImage` rows. The bytes
live in a **private** Vercel Blob store — unreadable by URL — and are served only by
`/api/letter-image/[id]`, which authorizes every request as the author — who, with sharing
gone, is always the child's owner — or as the child themselves via `openToken` **after the
age gate passes**.
The time lock covers photos exactly as it covers text.

Uploading is gated on `User.subscription` through `canUploadImages`; **reading never is**,
because the child has no account and a sealed letter must keep its photos forever.

Blob deletion is never automatic. `onDelete: Cascade` removes `LetterImage` rows with their
letter but leaves the bytes, so every path that deletes letters — `deleteLetter`,
`deleteChild`, save-time reconciliation, and the orphan sweep — must delete blobs
explicitly, **blobs first, then rows**.

Authors never see the marker. `src/components/letter-blocks-editor.tsx` presents the body
as blocks — text blocks are `contenteditable` regions showing real bold and italic, photo
blocks show the photograph — and `src/lib/letter-blocks.ts` converts to and from the stored
string on every edit. The string is the format; blocks are only a view, which is what keeps
`letterImageIds` and every blob-deletion path reading exactly what they always have.

`src/lib/letter-rich-text.ts` turns the contenteditable's DOM back into that string, and it
is the security boundary: an **allowlist that emits text**, so an element it doesn't
recognise contributes only its text content and pasted markup arrives as prose. There is no
sanitizer here and no `dangerouslySetInnerHTML` — adding a tag to that walker is the only
way to widen what the editor accepts.

### Dates

Birthdays are parsed as `new Date("yyyy-mm-ddT12:00:00Z")` — UTC noon, so the calendar day
can't drift a day across timezones when formatted back. Age math lives in `src/lib/age.ts`;
`openAtAge` is validated server-side against the child's current age, so a timer can never
be set in the past.

### Deleting a child

`deleteChild` transactionally deletes every letter written to that child — drafts and
sealed letters alike — and breaks the open link. `Letter.recipientName` is a
name snapshot kept so letters read correctly even if the child profile changes.
