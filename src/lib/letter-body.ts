// The letter body grammar. A body is a plain string - the column is unchanged
// and no letter needed migrating - carrying a deliberately tiny subset of
// Markdown plus image markers.
//
// This parser produces nodes, and src/components/letter-body.tsx turns those
// nodes into React elements. Nothing here or there ever produces HTML: user
// text always lands in a text node, so there is no sanitization surface to get
// wrong. Keep it that way.

export type Span = { text: string; bold: boolean; italic: boolean };

export type LetterNode =
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "image"; id: string };

// An image reference. Only ever a whole line - prose that happens to mention a
// marker stays prose. Ids are cuids, so letters and digits.
export const IMAGE_MARKER_PATTERN = /^\[\[img:([A-Za-z0-9]+)\]\]$/;

export function imageMarker(id: string): string {
  return `[[img:${id}]]`;
}

// Split a paragraph into styled spans.
//
// Hand-rolled rather than regex-driven because the rule that matters is the
// failure mode: an unmatched ** or * must come back as literal characters. A
// parent writing "2 * 3" or trailing off mid-word should never lose the rest of
// their letter to a greedy match.
export function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  let bold = false;
  let italic = false;
  let buffer = "";

  function flush() {
    if (buffer) spans.push({ text: buffer, bold, italic });
    buffer = "";
  }

  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const isBold = two === "**";
    const isItalic = !isBold && text[i] === "*";

    if (isBold || isItalic) {
      const marker = isBold ? "**" : "*";
      const open = isBold ? bold : italic;
      // A marker only counts if its partner exists later in the paragraph;
      // otherwise it's just an asterisk the parent typed.
      const closes = open || text.indexOf(marker, i + marker.length) !== -1;
      // An empty pair ("**" with nothing inside) is literal too.
      const empty = !open && text.slice(i + marker.length).startsWith(marker);

      if (closes && !empty) {
        flush();
        if (isBold) bold = !bold;
        else italic = !italic;
        i += marker.length;
        continue;
      }
    }

    buffer += text[i];
    i += 1;
  }

  flush();
  return spans;
}

// Turn a body into renderable nodes. Blank lines separate paragraphs; a line
// that is exactly a marker becomes an image.
export function parseLetterBody(body: string): LetterNode[] {
  const nodes: LetterNode[] = [];
  // Lines accumulated for the paragraph currently being read.
  let pending: string[] = [];

  function flushParagraph() {
    const text = pending.join("\n").trim();
    pending = [];
    if (text) nodes.push({ kind: "paragraph", spans: parseSpans(text) });
  }

  for (const line of body.split("\n")) {
    const marker = IMAGE_MARKER_PATTERN.exec(line.trim());
    if (marker) {
      // An image ends the paragraph it interrupts, so text never merges across
      // a photo.
      flushParagraph();
      nodes.push({ kind: "image", id: marker[1] });
      continue;
    }
    if (line.trim() === "") flushParagraph();
    else pending.push(line);
  }
  flushParagraph();

  return nodes;
}

// Every image id the body references, in order, without repeats.
//
// Cleanup uses this to decide what is still referenced, and the renderer uses
// the same parser to decide what to show - so the two can never disagree about
// which images a letter contains.
export function letterImageIds(body: string): string[] {
  const ids = parseLetterBody(body)
    .filter((node) => node.kind === "image")
    .map((node) => node.id);
  return [...new Set(ids)];
}
