"use client";

import { useEffect, useRef } from "react";
import { fromDom, serializeRichText } from "@/lib/letter-rich-text";

// One contenteditable region of the letter.
//
// The load-bearing rule: React writes this element's content ONCE, on mount,
// and never again. A contenteditable whose innerHTML React re-renders puts the
// caret back at the start on every keystroke, so `text` is an initial value,
// not a controlled one — state flows DOM → React only. Everything else here
// follows from that.

// Render the initial text as markup the browser will edit. Bold and italic are
// the only elements ever produced, and every piece of the parent's text goes
// through escapeHtml first — so this is markup we generated, not markup anyone
// supplied. (dangerouslySetInnerHTML is still not used: this is a direct
// innerHTML write on a ref, under the same rule, and it is the only place in
// the codebase that writes markup at all.)
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// A run of text sharing one set of formatting flags. Mirrors the Run type in
// letter-rich-text.ts, which assembles the same shape in the other direction.
type Run = { text: string; bold: boolean; italic: boolean };

// Split the stored **/* form into spans. This is exactly parseSpans in
// letter-body.ts — same marker-scanning loop, same rule that an unmatched or
// empty marker pair is literal text — just building a list of spans instead
// of appending tags inline, so the tags can be nested correctly afterward.
function toSpans(text: string): Run[] {
  const spans: Run[] = [];
  let bold = false;
  let italic = false;
  let buffer = "";

  const flush = () => {
    if (buffer) spans.push({ text: buffer, bold, italic });
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const isBold = two === "**";
    const isItalic = !isBold && text[i] === "*";

    if (isBold || isItalic) {
      const marker = isBold ? "**" : "*";
      const open = isBold ? bold : italic;
      const closes = open || text.indexOf(marker, i + marker.length) !== -1;
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

// Turn the stored **/* form into <b>/<i> for editing. First splits the text
// into spans (toSpans, above — a byte-for-byte mirror of parseSpans), then
// emits markup from the spans rather than from the marker scan directly, so
// tags always nest properly. A naive inline emitter can produce a crossing
// pair like <b>a<i>b</b></i> for input like "**a*b**" — the browser silently
// re-nests that into <b>a<i>b</i></b>, which changes which characters are
// italic on the next read. Closing and reopening at crossing points (the same
// trick serializeRichText's setFormat uses in the other direction) avoids
// that: bold always nests outside italic here, so italic closes and reopens
// around any bold boundary instead of crossing it.
function toEditableHtml(text: string): string {
  const spans = toSpans(text);

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

  return html.replace(/\n/g, "<br>");
}

export function LetterTextBlock({
  text,
  placeholder,
  onChange,
  onFocus,
  onBlur,
}: {
  // The initial content only. Later changes to this prop are ignored by
  // design — see the note at the top of this file.
  text: string;
  placeholder?: string;
  onChange: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Captured once so the effect below can't be tempted into re-running when the
  // parent's copy of the text changes.
  const initial = useRef(text);

  useEffect(() => {
    const element = ref.current;
    if (element) element.innerHTML = toEditableHtml(initial.current);
    // Deliberately empty: this must run on mount and never again.
  }, []);

  function emit() {
    const element = ref.current;
    if (element) onChange(serializeRichText(fromDom(element)));
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Letter text"
      data-placeholder={placeholder}
      onInput={emit}
      onFocus={onFocus}
      onBlur={() => {
        emit();
        onBlur();
      }}
      onPaste={(event) => {
        // The serialiser would neutralise pasted markup anyway; this keeps the
        // visible document clean too, so what the parent sees while writing is
        // what the letter will hold.
        event.preventDefault();
        const plain = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, plain);
      }}
      className="min-h-8 w-full whitespace-pre-wrap outline-none empty:before:text-sea-400 empty:before:content-[attr(data-placeholder)]"
    />
  );
}
