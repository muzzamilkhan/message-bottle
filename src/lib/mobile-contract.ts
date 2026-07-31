// The wire contract for /api/mobile/*. One file, so the client has a single
// source of truth to copy (docs/mobile/decisions.md, 6 - the Expo app lives in
// its own repo).
//
// Two rules govern what may appear here, and both come from CLAUDE.md's
// invariants:
//
//   - There is no wire type for a SENT letter's contents. The author can never
//     read a sealed letter, so `ApiLetterSummary` carries no body and the list
//     route returns sent letters as a count. Adding a title field here would be
//     the first step to breaking that.
//   - `ApiBottles` is a discriminated union whose locked variant has no field
//     that could hold a title, body, or image id. That shape is the time lock,
//     restated at the boundary.
//
// The mappers are pure, so the date and derived-age rules are tested.

import { ageInYears, hasReachedOpenAge } from "./age.ts";
import type { BottlesView } from "./open-bottle.ts";

// ---------- children ----------

export type ApiChild = {
  id: string;
  name: string;
  avatar: string;
  // A `data:` URL, or null to fall back to the emoji avatar.
  photo: string | null;
  // Calendar date, yyyy-mm-dd.
  birthday: string;
  openAtAge: number;
  // How old they are now, so the client needn't re-derive it and risk
  // disagreeing with the server about when a bottle opens.
  currentAge: number;
  // Whether the bottle timer has elapsed.
  opened: boolean;
  // The child's self-authenticating open link. The parent has it so they can
  // share it; it is the credential, so it only ever goes to the owner.
  openToken: string | null;
};

// A child row as the services return it.
export type ChildRow = {
  id: string;
  name: string;
  avatar: string;
  photo: string | null;
  birthday: Date;
  openAtAge: number;
  openToken: string | null;
};

// Birthdays are stored at UTC noon precisely so the calendar day can't drift
// across timezones (CLAUDE.md, "Dates"). Slicing the ISO string keeps that
// promise on the way out; formatting in a local zone would undo it.
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toApiChild(child: ChildRow, now: Date = new Date()): ApiChild {
  return {
    id: child.id,
    name: child.name,
    avatar: child.avatar,
    photo: child.photo,
    birthday: toDateString(child.birthday),
    openAtAge: child.openAtAge,
    currentAge: ageInYears(child.birthday, now),
    opened: hasReachedOpenAge(child.birthday, child.openAtAge, now),
    openToken: child.openToken,
  };
}

// ---------- letters ----------

// A draft, as the parent's list and detail routes return it.
//
// There is deliberately no sent-letter equivalent. Sealing is final for reads
// too: the web dashboard only counts sent letters and /letters/[id] 404s
// anything not DRAFT, so the API does the same.
export type ApiLetterSummary = {
  id: string;
  title: string;
  recipientName: string;
  childId: string | null;
  updatedAt: string;
  createdAt: string;
};

export type ApiLetterDetail = ApiLetterSummary & {
  body: string;
  images: ApiImage[];
};

export type ApiImage = {
  id: string;
  width: number;
  height: number;
};

// What GET /api/mobile/letters returns: the drafts in full, the sealed ones as
// a number and nothing more.
export type ApiLetterList = {
  drafts: ApiLetterSummary[];
  sentCount: number;
};

// ---------- the child's open link ----------

export type ApiBottleChild = {
  name: string;
  avatar: string;
  photo: string | null;
  openAtAge: number;
};

export type ApiOpenLetter = {
  id: string;
  title: string;
  body: string;
  authorName: string;
  writtenAt: string;
  images: ApiImage[];
};

// The three states of an open link. The locked variant carries a count and a
// date; it has no field for contents, so a locked response can't leak them even
// by mistake.
export type ApiBottles =
  | { status: "unavailable" }
  | {
      status: "locked";
      child: ApiBottleChild;
      opensAt: string;
      letterCount: number;
    }
  | {
      status: "open";
      child: ApiBottleChild;
      opensAt: string;
      letters: ApiOpenLetter[];
    };

// A view from open-bottle.ts, rendered for the wire.
//
// Written as a switch on `status` rather than a spread of a common base, so
// adding a field to the open case can never silently add it to the locked one.
// The locked branch touches no letter at all.
export function toApiBottles(view: BottlesView): ApiBottles {
  if (view.status === "unavailable") return { status: "unavailable" };

  const child: ApiBottleChild = {
    name: view.child.name,
    avatar: view.child.avatar,
    photo: view.child.photo,
    openAtAge: view.child.openAtAge,
  };

  if (view.status === "locked") {
    return {
      status: "locked",
      child,
      opensAt: view.openDate.toISOString(),
      letterCount: view.letterCount,
    };
  }

  return {
    status: "open",
    child,
    opensAt: view.openDate.toISOString(),
    letters: view.letters.map((letter) => ({
      id: letter.id,
      title: letter.title,
      body: letter.body,
      authorName: letter.authorName,
      writtenAt: letter.createdAt.toISOString(),
      images: letter.images,
    })),
  };
}

// ---------- errors ----------

// Every refusal. `code` is stable and safe to branch on; `message` is copy and
// may change.
export type ApiErrorBody = {
  error: { code: string; message: string };
};
