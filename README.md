# 🍾 Message in a Bottle

Write letters to your kids that stay **sealed until a special day**. Parents
sign in with Google and write a letter to a child. The bottle can't be opened
until the child reaches the age set on their profile.

Built with **Next.js (App Router)**, **Postgres + Prisma**, **Auth.js** (Google
login), and **Tailwind CSS** for the cute seaside theme. Deploys cleanly to
**Vercel**.

## Features

- 🔐 Google sign-in (Auth.js v5 with the Prisma adapter)
- ✍️ Write letters addressed to a child, with a title and message
- 💾 Save a letter as a **draft** and come back to edit it later
- 🍾 Sealing is final: once sent, a letter can never be viewed, edited, or
  deleted by the author
- 🗓️ Time-lock: a letter opens when the recipient child reaches their bottle-timer
  age — the open date is set on the child, not per letter
- 🌊 Dashboard showing your count of sent messages and a list of editable drafts
- 👶 Add and **edit** each child's details (name, avatar, full birthday)
- 🍾 Every child has a required **bottle timer** — the age (older than they are
  now) at which they can open their bottles from a private, self-authenticating
  link (`/open/<token>`), no account needed

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in the values:

```bash
cp .env.example .env
```

- **`DATABASE_URL`** — a Postgres connection string (Vercel Postgres, Neon,
  Supabase, or local Postgres).
- **`AUTH_SECRET`** — run `openssl rand -base64 32`.
- **`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`** — from the
  [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
  Add the redirect URI `http://localhost:3000/api/auth/callback/google` for
  local dev (and your production URL when you deploy).
### 3. Set up the database

```bash
npm run db:push      # creates the tables from prisma/schema.prisma
```

### 4. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying to Vercel

1. Push this repo to GitHub and import it into Vercel.
2. Add a **Postgres** database from the Vercel dashboard — this populates
   `DATABASE_URL` automatically.
3. Add `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` as
   environment variables.
4. In Google Cloud, add `https://YOUR_DOMAIN/api/auth/callback/google` to the
   authorized redirect URIs.
5. Run `npm run db:push` against the production database (or add it to your
   build step) so the tables exist.

## Project structure

```
prisma/schema.prisma        Database models (User, Child, Letter, LetterImage)
src/auth.ts                 Auth.js configuration (Google + Prisma adapter)
src/lib/prisma.ts           Prisma client singleton
src/lib/letters.ts          Date + countdown helpers
src/lib/children.ts         Child access helpers (a child has one owner)
src/app/actions.ts          Server actions: letters and children
src/app/page.tsx            Landing page
src/app/dashboard/          Sent-message count + editable drafts
src/app/children/           Manage/edit your kids + set their bottle timer
src/app/open/[token]/       A child's self-authenticating open page (age-gated)
src/lib/age.ts              Age helpers for the bottle timer
src/app/letters/new/        Write-a-letter form
src/app/letters/[id]/       Edit a draft letter (sent letters are sealed)
src/components/             UI: header, auth buttons, bottle illustration, forms
```

## A note on the time-lock

When a letter opens is governed entirely by the recipient child's **bottle
timer** (see below), not by any per-letter date. A parent writes a letter, seals
it, and it stays with the child's collection until the child reaches the age set
on their profile. The lock is enforced on the server: `src/app/open/[token]/page.tsx`
sends no letter content to the browser until the age gate has passed.

Sealing is final. Once a letter is sent (`status: "SENT"`) the author can never
view, edit, or delete it; only editable drafts (`status: "DRAFT"`) have a page of
their own.

## The bottle timer (a child's self-opening link)

Every child has a required **bottle timer**: an age, older than they are today,
at which they may open their bottles themselves — without an account. Creating a
child mints a random, unguessable `openToken` and produces a private link
(`/open/<token>`) you hand to the child.

The link is self-authenticating (the token is the credential) but still fully
time-locked on the server: `src/app/open/[token]/page.tsx` computes the child's
age from their birthday and shows only the sealed collection until they reach the
chosen age. Once they do, every letter written for them opens at once. The
required age is validated on the server against the child's current age, so a
timer can never be set in the past.
