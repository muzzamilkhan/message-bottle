import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  toApiBottles,
  toApiChild,
  toDateString,
  type ChildRow,
} from "./mobile-contract.ts";
import type { BottlesView } from "./open-bottle.ts";

const child: ChildRow = {
  id: "child-1",
  name: "Ada",
  avatar: "🧒",
  photo: null,
  // Stored at UTC noon, the convention every birthday is written with.
  birthday: new Date("2015-06-01T12:00:00Z"),
  openAtAge: 18,
  openToken: "a-token",
};

describe("toDateString", () => {
  test("returns the calendar day", () => {
    assert.equal(toDateString(new Date("2015-06-01T12:00:00Z")), "2015-06-01");
  });

  test("keeps the day stable at the extremes a UTC-noon date allows", () => {
    // The whole point of storing noon: ±12h of timezone shift can't move the
    // day. These are the two edges of that window.
    assert.equal(toDateString(new Date("2015-06-01T00:00:00Z")), "2015-06-01");
    assert.equal(toDateString(new Date("2015-06-01T23:59:59Z")), "2015-06-01");
  });

  test("handles a leap day", () => {
    assert.equal(toDateString(new Date("2016-02-29T12:00:00Z")), "2016-02-29");
  });
});

describe("toApiChild", () => {
  test("passes the plain fields through", () => {
    const api = toApiChild(child, new Date("2025-01-01T00:00:00Z"));

    assert.equal(api.id, "child-1");
    assert.equal(api.name, "Ada");
    assert.equal(api.avatar, "🧒");
    assert.equal(api.openAtAge, 18);
  });

  test("renders the birthday as a calendar date, not a timestamp", () => {
    const api = toApiChild(child, new Date("2025-01-01T00:00:00Z"));

    assert.equal(api.birthday, "2015-06-01");
  });

  test("derives the child's current age", () => {
    const api = toApiChild(child, new Date("2025-06-02T00:00:00Z"));

    assert.equal(api.currentAge, 10);
  });

  test("counts the age as the younger one the day before a birthday", () => {
    const api = toApiChild(child, new Date("2025-05-31T00:00:00Z"));

    assert.equal(api.currentAge, 9);
  });

  describe("opened", () => {
    test("is false while the child is younger than the timer", () => {
      const api = toApiChild(child, new Date("2033-05-31T00:00:00Z"));

      assert.equal(api.opened, false);
    });

    test("is true from the unlocking birthday onward", () => {
      const api = toApiChild(child, new Date("2033-06-01T12:00:00Z"));

      assert.equal(api.opened, true);
    });

    test("agrees with the age gate rather than re-deriving it", () => {
      // The client trusts this flag, so it must never disagree with the server
      // that actually guards the letters.
      const justBefore = toApiChild(child, new Date("2033-06-01T11:59:59Z"));
      const justAfter = toApiChild(child, new Date("2033-06-01T12:00:00Z"));

      assert.equal(justBefore.opened, false);
      assert.equal(justAfter.opened, true);
    });
  });

  test("carries the open token, which only ever reaches the owner", () => {
    const api = toApiChild(child, new Date("2025-01-01T00:00:00Z"));

    assert.equal(api.openToken, "a-token");
  });

  test("passes a null token through for a child that has none", () => {
    const api = toApiChild({ ...child, openToken: null }, new Date());

    assert.equal(api.openToken, null);
  });

  test("passes a profile photo through", () => {
    const api = toApiChild(
      { ...child, photo: "data:image/webp;base64,AAA" },
      new Date(),
    );

    assert.equal(api.photo, "data:image/webp;base64,AAA");
  });
});

describe("toApiBottles", () => {
  test("passes an unavailable view through untouched", () => {
    const api = toApiBottles({ status: "unavailable" });

    assert.deepEqual(api, { status: "unavailable" });
  });

  describe("a locked view", () => {
    const view: BottlesView = {
      status: "locked",
      child: { name: "Ada", avatar: "🧒", photo: null, openAtAge: 18 },
      openDate: new Date("2033-06-01T12:00:00Z"),
      letterCount: 3,
    };

    test("carries the count and the open date", () => {
      const api = toApiBottles(view);

      assert.deepEqual(api, {
        status: "locked",
        child: { name: "Ada", avatar: "🧒", photo: null, openAtAge: 18 },
        opensAt: "2033-06-01T12:00:00.000Z",
        letterCount: 3,
      });
    });

    test("has no field anywhere that could carry letter contents", () => {
      // The wire shape itself is the invariant: a locked ApiBottles has no
      // `letters` key to accidentally populate.
      const api = toApiBottles(view);

      assert.equal("letters" in api, false);
    });
  });

  describe("an open view", () => {
    const view: BottlesView = {
      status: "open",
      child: { name: "Ada", avatar: "🧒", photo: null, openAtAge: 18 },
      openDate: new Date("2033-06-01T12:00:00Z"),
      letters: [
        {
          id: "letter-1",
          title: "Happy birthday",
          body: "We love you",
          authorName: "Mum",
          createdAt: new Date("2020-01-01T00:00:00Z"),
          images: [{ id: "img-1", width: 800, height: 600 }],
        },
      ],
    };

    test("carries the decrypted letters", () => {
      const api = toApiBottles(view);

      assert.equal(api.status, "open");
      assert.deepEqual(
        api.status === "open" && api.letters,
        [
          {
            id: "letter-1",
            title: "Happy birthday",
            body: "We love you",
            authorName: "Mum",
            writtenAt: "2020-01-01T00:00:00.000Z",
            images: [{ id: "img-1", width: 800, height: 600 }],
          },
        ],
      );
    });

    test("has no letterCount field, the locked-only field", () => {
      const api = toApiBottles(view);

      assert.equal("letterCount" in api, false);
    });
  });
});
