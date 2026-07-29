// Turn a text block's stored **/* form into contenteditable markup.
//
// A text block may hold several paragraphs (blank-line separated), and the
// real renderer - parseSpans in letter-body.ts, via parseLetterBody - is only
// ever called with ONE paragraph at a time: parseLetterBody splits the body
// on blank lines before handing each piece to parseSpans. Pairing markers
// across a blank line here would let the editor pair asterisks the renderer
// never would, silently deleting them on the very next save. So this file
// mirrors that split exactly, then runs the real parseSpans on each paragraph
// separately.

import { parseSpans } from "./letter-body.ts";

// Every piece of the parent's text goes through escapeHtml first - so the
// markup this module builds is markup we generated, not markup anyone
// supplied. (dangerouslySetInnerHTML is still not used: the caller does a
// direct innerHTML write on a ref, under the same rule, and it is the only
// place in the codebase that writes markup at all.)
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Emit one paragraph's markup from its spans (as produced by parseSpans).
// Closes and reopens at crossing points (the same trick serializeRichText's
// setFormat uses in the other direction) so tags always nest correctly. A
// naive inline emitter can produce a crossing pair like <b>a<i>b</b></i> for
// input like "**a*b**" - the browser silently re-nests that into
// <b>a<i>b</i></b>, which changes which characters are italic on the next
// read. Bold always nests outside italic here, so italic closes and reopens
// around any bold boundary instead of crossing it.
function spansToHtml(spans: ReturnType<typeof parseSpans>): string {
  let html = "";
  let bold = false;
  let italic = false;

  function setFormat(nextBold: boolean, nextItalic: boolean) {
    if (italic && !nextItalic) {
      html += "</i>";
      italic = false;
    }
    if (bold !== nextBold) {
      if (bold && italic) {
        html += "</i>";
        italic = false;
      }
      html += bold ? "</b>" : "<b>";
      bold = nextBold;
    }
    if (!italic && nextItalic) {
      html += "<i>";
      italic = true;
    }
  }

  for (const span of spans) {
    setFormat(span.bold, span.italic);
    html += escapeHtml(span.text);
  }
  setFormat(false, false);

  return html;
}

// Turn the stored **/* form of a text block into <b>/<i> for editing. Splits
// the block on blank lines exactly as parseLetterBody does, so markers never
// pair across a paragraph break; a single newline inside a paragraph becomes
// <br>, and paragraphs rejoin with the blank line that separated them.
export function toEditableHtml(text: string): string {
  const paragraphs: string[] = [];
  let pending: string[] = [];

  function flush() {
    const paragraph = pending.join("\n").trim();
    pending = [];
    if (paragraph) paragraphs.push(paragraph);
  }

  for (const line of text.split("\n")) {
    if (line.trim() === "") flush();
    else pending.push(line);
  }
  flush();

  return paragraphs
    .map((paragraph) =>
      spansToHtml(parseSpans(paragraph)).replace(/\n/g, "<br>"),
    )
    .join("<br><br>");
}
