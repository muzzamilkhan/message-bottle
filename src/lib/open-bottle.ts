// The time lock, as a pure function.
//
// This is where the second invariant lives: **when a bottle opens is a
// property of the child** (birthday + openAtAge), not of the letter, and the
// server sends no letter contents until the gate passes. /open/[token] and the
// mobile open route both render whatever this returns, so neither can leak
// what the other withholds.
//
// Kept free of Prisma, sessions, and React so the rule can be tested with plain
// values - which is the point, because "a locked bottle carries no contents" is
// the highest-stakes assertion in the app. Decryption is *injected* rather than
// imported so a test can prove the locked branch never even calls it: a locked
// response must never hold plaintext, not merely avoid returning it.

import { birthdayAtAge, hasReachedOpenAge } from "./age.ts";

// A child as the open link finds them. `birthday` and `openAtAge` are nullable
// here even though the column isn't, because a row written before the timer
// existed can still carry nothing useful - and an unset timer must read as "no
// link" rather than "opens at age 0".
export type BottleChild = {
  name: string;
  avatar: string;
  photo: string | null;
  birthday: Date | null;
  openAtAge: number | null;
};

// A letter exactly as it comes off the row: `title` and `body` are the *stored*
// values, still encrypted. Nothing here decrypts until the gate has passed.
export type StoredLetter = {
  id: string;
  title: string;
  body: string;
  authorName: string | null;
  createdAt: Date;
  images: { id: string; width: number; height: number }[];
};

// A letter once the gate has passed: contents decrypted, author resolved.
export type OpenLetter = {
  id: string;
  title: string;
  body: string;
  authorName: string;
  createdAt: Date;
  images: { id: string; width: number; height: number }[];
};

export type BottleChildView = {
  name: string;
  avatar: string;
  photo: string | null;
  openAtAge: number;
};

// What the caller may render. Three states, and the difference between the last
// two is the whole invariant: `locked` has a count and a date, `open` has
// contents. There is deliberately no shape that carries both a lock and a body.
export type BottlesView =
  | { status: "unavailable" }
  | {
      status: "locked";
      child: BottleChildView;
      openDate: Date;
      // How many letters are waiting. A count is not contents - the web page
      // has always shown it, and it tells the child nothing about what's inside.
      letterCount: number;
    }
  | {
      status: "open";
      child: BottleChildView;
      openDate: Date;
      letters: OpenLetter[];
    };

export type ProjectBottlesOptions = {
  // Injectable so the gate is deterministic under test.
  now?: Date;
  // The `open-bottle-bypass` flag's answer - never the raw query param, so a
  // client can't claim a bypass the server refused.
  bypass?: boolean;
  // Injected so a test can prove the locked branch never calls it.
  decrypt: (stored: string) => string;
};

// Decide what a token's holder may see, and return only that.
export function projectBottles(
  child: BottleChild,
  letters: StoredLetter[],
  options: ProjectBottlesOptions,
): BottlesView {
  // No timer set - the link no longer opens anything. Checked before the age
  // maths so a missing openAtAge can't read as "opens at age 0", which would
  // unlock every bottle immediately.
  if (!child.birthday || !child.openAtAge) return { status: "unavailable" };

  const openDate = birthdayAtAge(child.birthday, child.openAtAge);
  const view: BottleChildView = {
    name: child.name,
    avatar: child.avatar,
    photo: child.photo,
    openAtAge: child.openAtAge,
  };

  const reached =
    options.bypass === true ||
    hasReachedOpenAge(child.birthday, child.openAtAge, options.now);

  // Still counting down. Nothing but the size of the collection leaves here -
  // no title, no body, no image ids, and `decrypt` is never called.
  if (!reached) {
    return {
      status: "locked",
      child: view,
      openDate,
      letterCount: letters.length,
    };
  }

  return {
    status: "open",
    child: view,
    openDate,
    letters: letters.map((letter) => ({
      id: letter.id,
      title: options.decrypt(letter.title),
      body: options.decrypt(letter.body),
      authorName: letter.authorName?.trim() || "A parent",
      createdAt: letter.createdAt,
      images: letter.images,
    })),
  };
}
