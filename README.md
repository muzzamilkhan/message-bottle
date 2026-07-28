# 🍾 Message in a Bottle

Write letters to your kids that stay **sealed until a special day**. Parents
sign in with Google, write a letter, tuck in some photos, and choose a delivery
date. The bottle can't be opened until that day arrives.

Built with **Next.js (App Router)**, **Postgres + Prisma**, **Auth.js** (Google
login), **Vercel Blob** for photos, and **Tailwind CSS** for the cute seaside
theme. Deploys cleanly to **Vercel**.

## Features

- 🔐 Google sign-in (Auth.js v5 with the Prisma adapter)
- ✍️ Write letters addressed to a child, with a title and message
- 📸 Attach photos (stored in Vercel Blob)
- 🗓️ Time-lock: a letter stays sealed until its delivery date, then unlocks
- 🌊 Dashboard of your bottles with a live countdown to each opening
- 🗑️ Delete letters you own (ownership enforced on every read/write)
- 🔗 Share a child with a co-parent via an invite link — they sign in (creating
  an account if needed), accept, and can then write their own letters to that
  child too

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
- **`BLOB_READ_WRITE_TOKEN`** — from Vercel Blob storage. Photo uploads are
  disabled gracefully if this is missing; everything else still works.

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
2. Add a **Postgres** database and **Blob** store from the Vercel dashboard —
   this populates `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` automatically.
3. Add `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` as
   environment variables.
4. In Google Cloud, add `https://YOUR_DOMAIN/api/auth/callback/google` to the
   authorized redirect URIs.
5. Run `npm run db:push` against the production database (or add it to your
   build step) so the tables exist.

## Project structure

```
prisma/schema.prisma        Database models (User, Child, Letter, Photo, sharing)
src/auth.ts                 Auth.js configuration (Google + Prisma adapter)
src/lib/prisma.ts           Prisma client singleton
src/lib/letters.ts          Time-lock + date/countdown helpers
src/lib/children.ts         Accessible-children helpers (owned + shared)
src/app/actions.ts          Server actions: letters, children, and sharing
src/app/api/upload/route.ts Photo upload endpoint (Vercel Blob)
src/app/page.tsx            Landing page
src/app/dashboard/          List of the signed-in user's bottles
src/app/children/           Manage your kids (and see ones shared with you)
src/app/share/              Invite a co-parent and manage shared access
src/app/invite/[token]/     Accept a share invite (signs in if needed)
src/app/letters/new/        Write-a-letter form
src/app/letters/[id]/       View a letter (locked until its delivery date)
src/components/             UI: header, auth buttons, bottle illustration, forms
```

## Sharing access with a co-parent

A child is owned by the parent who created it. From the **Share** page you pick
which of your kids to share and generate an invite link. Sharing works like so:

1. The link carries a random, unguessable token (`ShareInvite`).
2. The other parent opens it. If they aren't signed in, signing in with Google
   creates their account, then returns them to the invite to accept.
3. Accepting creates a `ChildShare` grant, after which the co-parent can address
   letters to that child — each parent still owns and sees only their own
   letters. The child seeing both parents' letters at once is a future
   child-view feature.

Owners stay in control: they can cancel a pending invite or remove a co-parent's
access at any time from the Share page.

## A note on the time-lock

The lock is enforced on the server: `src/app/letters/[id]/page.tsx` only renders
the letter body and photos once `deliverAt` has passed. Before then, no letter
content is sent to the browser — just the sealed-bottle placeholder.
