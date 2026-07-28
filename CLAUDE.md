# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

This is a hobby project. Work directly on `main` — no feature branches, no PRs.
Make atomic commits (one logical change each) and push `main` when the work is done.

## Commands

```bash
npm run dev          # dev server (already running on :3000 — see dev.log, don't start another)
npm run build        # prisma generate + prisma db push + next build
npm run lint         # next lint
npm run db:push      # apply prisma/schema.prisma to the database
npm run db:studio    # Prisma Studio
```

There is no test suite or test runner in this repo. Verify changes by exercising the
running dev server.

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
