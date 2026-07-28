import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { childInputMessage, parseChildInput } from "./child-input.ts";
import { DEFAULT_AVATAR } from "./avatars.ts";

// A fixed "today" so the age rules are deterministic.
const NOW = new Date("2026-07-28T12:00:00Z");

const valid = {
  name: "Ada",
  avatar: "🦊",
  birthday: "2018-03-04",
  openAtAge: "18",
  photo: "",
  photoAction: "keep",
};

function parse(overrides: Partial<typeof valid> = {}) {
  return parseChildInput({ ...valid, ...overrides }, NOW);
}

describe("parseChildInput", () => {
  it("accepts a complete child and returns clean values", () => {
    const result = parse();
    assert.equal(result.ok, true);
    assert.partialDeepStrictEqual(result, {
      ok: true,
      value: { name: "Ada", avatar: "🦊", openAtAge: 18 },
    });
  });

  it("parses the birthday at UTC noon so the day can't drift timezones", () => {
    const result = parse({ birthday: "2018-03-04" });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    // Noon UTC leaves 12h of headroom either way, so the calendar day survives
    // being formatted in any timezone.
    assert.equal(result.value.birthday.toISOString(), "2018-03-04T12:00:00.000Z");
  });

  it("trims surrounding whitespace from the name", () => {
    const result = parse({ name: "  Ada  " });
    assert.ok(result.ok);
    assert.equal(result.value.name, "Ada");
  });

  describe("avatar", () => {
    it("keeps an avatar from the allowed set", () => {
      const result = parse({ avatar: "🐙" });
      assert.ok(result.ok);
      assert.equal(result.value.avatar, "🐙");
    });

    it("falls back to the default for an unknown avatar", () => {
      const result = parse({ avatar: "💀" });
      assert.ok(result.ok);
      assert.equal(result.value.avatar, DEFAULT_AVATAR);
    });

    it("falls back to the default when the avatar is missing", () => {
      const result = parse({ avatar: "" });
      assert.ok(result.ok);
      assert.equal(result.value.avatar, DEFAULT_AVATAR);
    });
  });

  describe("required fields", () => {
    it("rejects a missing name", () => {
      assert.partialDeepStrictEqual(parse({ name: "   " }), {
        ok: false,
        error: "NAME_REQUIRED",
      });
    });

    it("rejects a missing birthday", () => {
      assert.partialDeepStrictEqual(parse({ birthday: "" }), {
        ok: false,
        error: "BIRTHDAY_REQUIRED",
      });
    });

    it("rejects an unparseable birthday", () => {
      assert.partialDeepStrictEqual(parse({ birthday: "not-a-date" }), {
        ok: false,
        error: "BIRTHDAY_INVALID",
      });
    });

    it("rejects a missing open age", () => {
      assert.partialDeepStrictEqual(parse({ openAtAge: "" }), {
        ok: false,
        error: "OPEN_AGE_REQUIRED",
      });
    });
  });

  describe("open age bounds", () => {
    for (const openAtAge of ["0", "151", "12.5", "abc", "-3"]) {
      it(`rejects ${JSON.stringify(openAtAge)} as a year count`, () => {
        assert.partialDeepStrictEqual(parse({ openAtAge }), {
          ok: false,
          error: "OPEN_AGE_NOT_A_YEAR_COUNT",
        });
      });
    }

    it("accepts the lower bound when the child is younger than it", () => {
      // Born this year, so age 1 is still ahead of them.
      const result = parse({ birthday: "2026-01-01", openAtAge: "1" });
      assert.ok(result.ok);
      assert.equal(result.value.openAtAge, 1);
    });

    it("accepts the upper bound", () => {
      const result = parse({ openAtAge: "150" });
      assert.ok(result.ok);
      assert.equal(result.value.openAtAge, 150);
    });
  });

  // The security-relevant rule: a timer set at or below the child's current age
  // would unlock the bottles immediately.
  describe("the timer must be in the future", () => {
    it("rejects an age the child has already passed", () => {
      // Born 2018, so they're 8 on the fixed NOW.
      assert.partialDeepStrictEqual(parse({ openAtAge: "5" }), {
        ok: false,
        error: "OPEN_AGE_NOT_IN_FUTURE",
        currentAge: 8,
      });
    });

    it("rejects the child's exact current age", () => {
      assert.partialDeepStrictEqual(parse({ openAtAge: "8" }), {
        ok: false,
        error: "OPEN_AGE_NOT_IN_FUTURE",
        currentAge: 8,
      });
    });

    it("accepts one year beyond the current age", () => {
      const result = parse({ openAtAge: "9" });
      assert.ok(result.ok);
      assert.equal(result.value.openAtAge, 9);
    });

    it("treats the birthday itself as already reached", () => {
      // Turns 8 exactly on NOW, so 8 is no longer in the future.
      assert.partialDeepStrictEqual(
        parse({ birthday: "2018-07-28", openAtAge: "8" }),
        { ok: false, error: "OPEN_AGE_NOT_IN_FUTURE" },
      );
    });

    it("counts the day before a birthday as the younger age", () => {
      // Turns 8 tomorrow, so they're still 7 and a timer of 8 is valid.
      const result = parse({ birthday: "2018-07-29", openAtAge: "8" });
      assert.ok(result.ok);
      assert.equal(result.value.openAtAge, 8);
    });
  });

  describe("photo", () => {
    // A valid, tiny photo data URL.
    const photo = `data:image/webp;base64,${Buffer.from("pretend-webp!").toString("base64")}`;
    const base = {
      name: "Ada",
      avatar: "🧒",
      birthday: "2020-01-01",
      openAtAge: "18",
    };

    it("stores a photo when the action is set", () => {
      const result = parseChildInput(
        { ...base, photo, photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, photo);
    });

    it("clears the photo when the action is clear", () => {
      const result = parseChildInput(
        { ...base, photo: "", photoAction: "clear" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, null);
    });

    it("leaves the column untouched when the action is keep", () => {
      const result = parseChildInput(
        { ...base, photo: "", photoAction: "keep" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.value.photo, undefined);
    });

    it("ignores a submitted photo when the action is keep", () => {
      const result = parseChildInput(
        { ...base, photo, photoAction: "keep" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, undefined);
    });

    it("falls back to keep for an unrecognised action", () => {
      // A bad value means a stale client, not a user mistake — same reasoning
      // as an unknown avatar falling back to the default.
      const result = parseChildInput(
        { ...base, photo: "", photoAction: "nonsense" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.value.photo, undefined);
    });

    it("rejects an invalid data url when setting", () => {
      const result = parseChildInput(
        { ...base, photo: "https://example.com/cat.png", photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.error, "PHOTO_MALFORMED");
    });

    it("rejects a disallowed image type when setting", () => {
      const svg = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
      const result = parseChildInput(
        { ...base, photo: svg, photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(!result.ok && result.error, "PHOTO_NOT_AN_IMAGE");
    });

    it("treats set with an empty photo as a clear", () => {
      const result = parseChildInput(
        { ...base, photo: "", photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, null);
    });

    it("echoes whether a photo was submitted, not the photo", () => {
      const result = parseChildInput(
        { ...base, name: "", photo, photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(!result.ok && result.values.hasPhoto, true);
      // The data URL must not ride along in the echoed values.
      assert.equal(
        Object.values(!result.ok ? result.values : {}).includes(photo),
        false,
      );
    });

    it("stores the trimmed photo, not the raw submitted value", () => {
      // Whitespace-padded but otherwise identical to `photo`. If the
      // implementation ever stored `raw.photo` instead of the trimmed,
      // validated copy, this would catch it: the padded string was never
      // passed through parsePhotoDataUrl, so persisting it would be exactly
      // the untrimmed/unvalidated regression the Task 2 security review
      // flagged.
      const result = parseChildInput(
        { ...base, photo: `  ${photo}  `, photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, photo);
    });

    it("checks the name before validating the photo", () => {
      // A missing name and an invalid photo both fail — the name check must
      // win, so a bad photo can never mask a missing name.
      const result = parseChildInput(
        {
          ...base,
          name: "",
          photo: "https://example.com/cat.png",
          photoAction: "set",
        },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(!result.ok && result.error, "NAME_REQUIRED");
    });
  });

  describe("echoed values", () => {
    it("returns the trimmed input so the form can repopulate", () => {
      const result = parse({ name: "  Ada  ", openAtAge: "3" });
      assert.ok(!result.ok);
      assert.deepEqual(result.values, {
        name: "Ada",
        avatar: "🦊",
        birthday: "2018-03-04",
        openAtAge: "3",
        hasPhoto: false,
      });
    });

    it("echoes the resolved avatar, not the rejected one", () => {
      const result = parse({ avatar: "💀", name: "" });
      assert.ok(!result.ok);
      assert.equal(result.values.avatar, DEFAULT_AVATAR);
    });
  });
});

describe("childInputMessage", () => {
  it("names the child and their age when the timer isn't in the future", () => {
    assert.equal(
      childInputMessage("OPEN_AGE_NOT_IN_FUTURE", { name: "Ada", currentAge: 8 }),
      "Pick an age older than Ada is now (currently 8).",
    );
  });

  it("returns a message for every error code", () => {
    const codes = [
      "NAME_REQUIRED",
      "BIRTHDAY_REQUIRED",
      "BIRTHDAY_INVALID",
      "OPEN_AGE_REQUIRED",
      "OPEN_AGE_NOT_A_YEAR_COUNT",
      "OPEN_AGE_NOT_IN_FUTURE",
      "PHOTO_NOT_AN_IMAGE",
      "PHOTO_MALFORMED",
      "PHOTO_TOO_LARGE",
      "PHOTO_TOO_LARGE_TO_READ",
    ] as const;
    for (const code of codes) {
      const message = childInputMessage(code, { name: "Ada", currentAge: 8 });
      assert.ok(message.length > 0, `${code} has no message`);
    }
  });
});
