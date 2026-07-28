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
prisma/schema.prisma        Database models (User, Account, Session, Letter, Photo)
src/auth.ts                 Auth.js configuration (Google + Prisma adapter)
src/lib/prisma.ts           Prisma client singleton
src/lib/letters.ts          Time-lock + date/countdown helpers
src/app/actions.ts          Server actions: createLetter, deleteLetter
src/app/api/upload/route.ts Photo upload endpoint (Vercel Blob)
src/app/page.tsx            Landing page
src/app/dashboard/          List of the signed-in user's bottles
src/app/letters/new/        Write-a-letter form
src/app/letters/[id]/       View a letter (locked until its delivery date)
src/components/             UI: header, auth buttons, bottle illustration, form
```

## A note on the time-lock

The lock is enforced on the server: `src/app/letters/[id]/page.tsx` only renders
the letter body and photos once `deliverAt` has passed. Before then, no letter
content is sent to the browser — just the sealed-bottle placeholder.
