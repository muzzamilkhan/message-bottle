// Pure parsing/validation for the child form. Kept free of FormData, Prisma,
// and sessions so the rules - especially "the bottle timer can never be set in
// the past" - can be tested with plain values.

// Relative imports (not the `@/` alias) so `node --test` can resolve these
// without a bundler or path-mapping loader.
import { CHILD_AVATARS, DEFAULT_AVATAR } from "./avatars.ts";
import { ageInYears } from "./age.ts";
import {
  childPhotoMessage,
  parsePhotoDataUrl,
  type ChildPhotoError,
} from "./child-photo.ts";

// What the form wants done with the photo column. Editing must distinguish
// "untouched" from "removed", which an empty photo field alone can't express.
export type PhotoAction = "keep" | "set" | "clear";

// The raw strings the parent typed, echoed back on error so a re-rendered form
// (which React resets after every action) can repopulate itself instead of
// wiping still-correct fields.
export type ChildFormValues = {
  name: string;
  avatar: string;
  birthday: string;
  openAtAge: string;
};

export type ParsedChild = {
  name: string;
  avatar: string;
  birthday: Date;
  openAtAge: number;
  // A data URL to store, `null` to clear the column, or `undefined` to leave
  // it alone. These map straight onto Prisma's update semantics.
  photo: string | null | undefined;
};

// Why the input was rejected. Codes rather than copy, so tests assert on rules
// and not on wording.
export type ChildInputError =
  | "NAME_REQUIRED"
  | "BIRTHDAY_REQUIRED"
  | "BIRTHDAY_INVALID"
  | "OPEN_AGE_REQUIRED"
  | "OPEN_AGE_NOT_A_YEAR_COUNT"
  | "OPEN_AGE_NOT_IN_FUTURE"
  | ChildPhotoError;

export type ChildInputResult =
  | { ok: true; value: ParsedChild }
  | {
      ok: false;
      error: ChildInputError;
      values: ChildFormValues;
      // Only set for OPEN_AGE_NOT_IN_FUTURE, which needs it for the message.
      currentAge?: number;
    };

// A bottle timer must be a whole number of years within a human lifespan.
const MIN_OPEN_AGE = 1;
const MAX_OPEN_AGE = 150;

export function childInputMessage(
  error: ChildInputError,
  ctx: { name: string; currentAge?: number },
): string {
  switch (error) {
    case "NAME_REQUIRED":
      return "Please give your child a name.";
    case "BIRTHDAY_REQUIRED":
      return "Please add your child's birthday.";
    case "BIRTHDAY_INVALID":
      return "That birthday doesn't look right.";
    case "OPEN_AGE_REQUIRED":
      return "Please set the age they can open their bottles.";
    case "OPEN_AGE_NOT_A_YEAR_COUNT":
      return "The age they can open should be a whole number of years.";
    case "OPEN_AGE_NOT_IN_FUTURE":
      return `Pick an age older than ${ctx.name} is now (currently ${ctx.currentAge}).`;
    default:
      return childPhotoMessage(error);
  }
}

// Parse and validate the child fields. `now` is injectable so the age check is
// deterministic under test.
export function parseChildInput(
  raw: {
    name: string;
    avatar: string;
    birthday: string;
    openAtAge: string;
    photo: string;
    photoAction: string;
  },
  now: Date = new Date(),
): ChildInputResult {
  const name = raw.name.trim();
  const birthdayRaw = raw.birthday.trim();
  const openAtAgeRaw = raw.openAtAge.trim();

  // An unknown or missing avatar silently falls back rather than erroring -
  // it's a picker, so a bad value means a stale client, not a user mistake.
  const avatar = (CHILD_AVATARS as readonly string[]).includes(raw.avatar.trim())
    ? raw.avatar.trim()
    : DEFAULT_AVATAR;

  // An unrecognised action falls back to leaving the column alone, for the
  // same reason an unknown avatar falls back: it means a stale client, not a
  // user mistake.
  const photoRaw = raw.photo.trim();
  const action: PhotoAction =
    raw.photoAction === "set" || raw.photoAction === "clear"
      ? raw.photoAction
      : "keep";

  // What the user just entered, so an error re-render can restore it. The
  // photo itself never rides along here - it stays in the browser's React
  // state across an error re-render, which is why there's no photo field.
  const values: ChildFormValues = {
    name,
    avatar,
    birthday: birthdayRaw,
    openAtAge: openAtAgeRaw,
  };
  const fail = (
    error: ChildInputError,
    currentAge?: number,
  ): ChildInputResult => ({ ok: false, error, values, currentAge });

  if (!name) return fail("NAME_REQUIRED");
  if (!birthdayRaw) return fail("BIRTHDAY_REQUIRED");

  // Parse a full calendar date (yyyy-mm-dd) at UTC noon so the day can't drift
  // across timezones when it's formatted back later.
  const birthday = new Date(`${birthdayRaw}T12:00:00Z`);
  if (Number.isNaN(birthday.getTime())) return fail("BIRTHDAY_INVALID");

  if (!openAtAgeRaw) return fail("OPEN_AGE_REQUIRED");
  const age = Number(openAtAgeRaw);
  if (!Number.isInteger(age) || age < MIN_OPEN_AGE || age > MAX_OPEN_AGE) {
    return fail("OPEN_AGE_NOT_A_YEAR_COUNT");
  }

  // The timer must still be ahead of them, or the bottles would open instantly.
  const currentAge = ageInYears(birthday, now);
  if (age <= currentAge) return fail("OPEN_AGE_NOT_IN_FUTURE", currentAge);

  // Resolve the photo last, so a bad photo never masks a missing name.
  let photo: string | null | undefined;
  if (action === "clear") {
    photo = null;
  } else if (action === "set") {
    // "Set" with nothing attached means the parent removed it before saving.
    if (!photoRaw) {
      photo = null;
    } else {
      const parsed = parsePhotoDataUrl(photoRaw);
      if (!parsed.ok) return fail(parsed.error);
      photo = photoRaw;
    }
  }

  return {
    ok: true,
    value: { name, avatar, birthday, openAtAge: age, photo },
  };
}
