import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  projectBottles,
  type BottleChild,
  type StoredLetter,
} from "./open-bottle.ts";

// A decrypt that records every call, so a test can assert the locked branch
// never reached for plaintext at all - not merely that it didn't return any.
function spyDecrypt() {
  const calls: string[] = [];
  return {
    calls,
    decrypt(stored: string) {
      calls.push(stored);
      return stored.replace("enc:", "plain:");
    },
  };
}

const child: BottleChild = {
  name: "Ada",
  avatar: "🧒",
  photo: null,
  birthday: new Date("2015-06-01T12:00:00Z"),
  openAtAge: 18,
};

const letters: StoredLetter[] = [
  {
    id: "letter-1",
    title: "enc:a title",
    body: "enc:a body\n\n[[img:img-1]]",
    authorName: "Grace",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    images: [{ id: "img-1", width: 800, height: 600 }],
  },
  {
    id: "letter-2",
    title: "enc:another",
    body: "enc:another body",
    authorName: null,
    createdAt: new Date("2021-01-01T00:00:00Z"),
    images: [],
  },
];

// Before and after Ada turns 18 on 2033-06-01.
const beforeGate = new Date("2033-05-31T12:00:00Z");
const afterGate = new Date("2033-06-02T12:00:00Z");

describe("a locked bottle", () => {
  test("reports itself locked before the child reaches the age", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: beforeGate, decrypt });

    assert.equal(view.status, "locked");
  });

  test("carries no letter contents anywhere in the result", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: beforeGate, decrypt });

    // The whole result, serialized: no title, no body, no image id may appear
    // in it by any route, including one a future field might open up.
    const serialized = JSON.stringify(view);
    assert.doesNotMatch(serialized, /a title/);
    assert.doesNotMatch(serialized, /a body/);
    assert.doesNotMatch(serialized, /another/);
    assert.doesNotMatch(serialized, /img-1/);
    assert.doesNotMatch(serialized, /letter-1/);
  });

  test("never decrypts, so a locked response never holds plaintext", () => {
    const spy = spyDecrypt();
    projectBottles(child, letters, { now: beforeGate, decrypt: spy.decrypt });

    assert.deepEqual(spy.calls, []);
  });

  test("still says how many letters are waiting", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: beforeGate, decrypt });

    assert.equal(view.status === "locked" && view.letterCount, 2);
  });

  test("gives the date the bottles open", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: beforeGate, decrypt });

    assert.equal(
      view.status === "locked" && view.openDate.toISOString(),
      new Date("2033-06-01T12:00:00Z").toISOString(),
    );
  });

  test("names the child, so the page can greet them", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: beforeGate, decrypt });

    assert.equal(view.status === "locked" && view.child.name, "Ada");
  });

  test("is locked the day before the unlocking birthday", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, {
      now: new Date("2033-05-31T23:59:59Z"),
      decrypt,
    });

    assert.equal(view.status, "locked");
  });
});

describe("an open bottle", () => {
  test("reports itself open once the child reaches the age", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: afterGate, decrypt });

    assert.equal(view.status, "open");
  });

  test("opens exactly on the unlocking birthday", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, {
      now: new Date("2033-06-01T12:00:00Z"),
      decrypt,
    });

    assert.equal(view.status, "open");
  });

  test("decrypts every title and body, and only those", () => {
    const spy = spyDecrypt();
    projectBottles(child, letters, { now: afterGate, decrypt: spy.decrypt });

    assert.deepEqual(spy.calls, [
      "enc:a title",
      "enc:a body\n\n[[img:img-1]]",
      "enc:another",
      "enc:another body",
    ]);
  });

  test("returns the decrypted contents", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: afterGate, decrypt });

    assert.equal(view.status === "open" && view.letters[0].title, "plain:a title");
    assert.equal(
      view.status === "open" && view.letters[0].body,
      "plain:a body\n\n[[img:img-1]]",
    );
  });

  test("keeps each letter's images, in the order stored", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: afterGate, decrypt });

    assert.deepEqual(view.status === "open" && view.letters[0].images, [
      { id: "img-1", width: 800, height: 600 },
    ]);
    assert.deepEqual(view.status === "open" && view.letters[1].images, []);
  });

  test("keeps the letters in the order given", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: afterGate, decrypt });

    assert.deepEqual(
      view.status === "open" && view.letters.map((letter) => letter.id),
      ["letter-1", "letter-2"],
    );
  });

  test("falls back to a generic author when the parent has no name", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, { now: afterGate, decrypt });

    assert.equal(view.status === "open" && view.letters[1].authorName, "A parent");
  });

  test("treats a whitespace-only author name as no name", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(
      child,
      [{ ...letters[0], authorName: "   " }],
      { now: afterGate, decrypt },
    );

    assert.equal(view.status === "open" && view.letters[0].authorName, "A parent");
  });

  test("has no letters when none were written", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, [], { now: afterGate, decrypt });

    assert.deepEqual(view.status === "open" && view.letters, []);
  });
});

describe("the testing bypass", () => {
  test("opens a bottle the age gate would keep locked", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, {
      now: beforeGate,
      bypass: true,
      decrypt,
    });

    assert.equal(view.status, "open");
  });

  test("keeps the bottle locked when the server did not grant it", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, {
      now: beforeGate,
      bypass: false,
      decrypt,
    });

    assert.equal(view.status, "locked");
  });

  test("only an exact true opens it, never a truthy value", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles(child, letters, {
      now: beforeGate,
      // A flag lookup that returned something other than a boolean must not
      // unlock a bottle by accident.
      bypass: "yes" as unknown as boolean,
      decrypt,
    });

    assert.equal(view.status, "locked");
  });

  test("cannot revive a child with no timer set", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles({ ...child, openAtAge: null }, letters, {
      now: afterGate,
      bypass: true,
      decrypt,
    });

    assert.equal(view.status, "unavailable");
  });
});

describe("a child with no bottle timer", () => {
  test("is unavailable when the open age is missing", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles({ ...child, openAtAge: null }, letters, {
      now: afterGate,
      decrypt,
    });

    assert.equal(view.status, "unavailable");
  });

  test("is unavailable when the birthday is missing", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles({ ...child, birthday: null }, letters, {
      now: afterGate,
      decrypt,
    });

    assert.equal(view.status, "unavailable");
  });

  test("treats an open age of zero as no timer, not as already open", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles({ ...child, openAtAge: 0 }, letters, {
      now: afterGate,
      decrypt,
    });

    assert.equal(view.status, "unavailable");
  });

  test("never decrypts anything", () => {
    const spy = spyDecrypt();
    projectBottles({ ...child, openAtAge: null }, letters, {
      now: afterGate,
      decrypt: spy.decrypt,
    });

    assert.deepEqual(spy.calls, []);
  });

  test("carries no contents", () => {
    const { decrypt } = spyDecrypt();
    const view = projectBottles({ ...child, openAtAge: null }, letters, {
      now: afterGate,
      decrypt,
    });

    assert.doesNotMatch(JSON.stringify(view), /a title|a body|img-1/);
  });
});
