# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

This is a hobby project. Work directly on `main` — no feature branches, no PRs.
Make atomic commits (one logical change each) and push `main` when the work is done.

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
free to change. The tested libs are `age`, `letters`, `child-input`, `letter-input`, and
`letter-stack-style`; `children.ts` and `prisma.ts` are DB access and stay untested.

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

1. **Parent (authenticated).** Ownership is `Child.parentId`. Co-parents get write access
   through a `ChildShare` grant, created when they accept a `ShareInvite` link. Anything
   reading children for a signed-in user must consider both — use
   `getAccessibleChildren` / `canAccessChild` in `src/lib/children.ts`, or replicate the
   `OR: [{ parentId }, { shares: { some: { parentId } } }]` clause. Only an **owner** may
   edit/delete a child, share it, or revoke access; co-parents may only address letters
   to it.
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

The one exception: when the deployment sets `TESTING=true`, `?test=yes` on the open page
bypasses the age gate. It is inert in any other environment.

### Dates

Birthdays are parsed as `new Date("yyyy-mm-ddT12:00:00Z")` — UTC noon, so the calendar day
can't drift a day across timezones when formatted back. Age math lives in `src/lib/age.ts`;
`openAtAge` is validated server-side against the child's current age, so a timer can never
be set in the past.

### Deleting a child

`deleteChild` transactionally deletes every letter written to that child — drafts and
sealed letters, from all co-parents — and breaks the open link. `Letter.recipientName` is a
name snapshot kept so letters read correctly even if the child profile changes.
