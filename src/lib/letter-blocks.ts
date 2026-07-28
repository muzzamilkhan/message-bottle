// The editor's view of a letter body.
//
// A body is stored as a plain string and always will be: letterImageIds() reads
// it to decide which blobs are still referenced, and that is the mechanism
// behind "delete the child, and every photo goes with it". These blocks exist
// only inside the editor, and every edit is serialised straight back to the
// same string — so nothing downstream can tell the editor changed.

import { IMAGE_MARKER_PATTERN, imageMarker } from "./letter-body.ts";

export type LetterBlock =
  | { kind: "text"; text: string }
  | { kind: "photo"; id: string };

// Split a stored body into blocks.
//
// Deliberately not built on parseLetterBody: that returns styled spans, and
// re-serialising spans back to **/* would not round-trip — parseSpans treats an
// unmatched * as a literal character, so re-emitting it would change its
// meaning on the next parse. Splitting the raw string on the same marker
// pattern keeps the round-trip exact and leaves one grammar, not two.
export function toBlocks(body: string): LetterBlock[] {
  const blocks: LetterBlock[] = [];
  // Lines accumulated for the text block currently being read.
  let pending: string[] = [];

  function flushText() {
    const text = pending.join("\n").trim();
    pending = [];
    if (text) blocks.push({ kind: "text", text });
  }

  for (const line of body.split("\n")) {
    const marker = IMAGE_MARKER_PATTERN.exec(line.trim());
    if (marker) {
      flushText();
      blocks.push({ kind: "photo", id: marker[1] });
      continue;
    }
    pending.push(line);
  }
  flushText();

  return blocks;
}

// Serialise blocks back to a stored body. A text block may hold several
// paragraphs, so blocks join with a blank line just as paragraphs do.
export function toBody(blocks: LetterBlock[]): string {
  return blocks
    .map((block) =>
      block.kind === "photo" ? imageMarker(block.id) : block.text.trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}
