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

// Turn the stored **/* form into <b>/<i> for editing. Mirrors parseSpans in
// letter-body.ts, including its rule that an unmatched marker is literal text.
function toEditableHtml(text: string): string {
  let html = "";
  let bold = false;
  let italic = false;
  let buffer = "";

  const flush = () => {
    html += escapeHtml(buffer);
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
        if (isBold) {
          html += bold ? "</b>" : "<b>";
          bold = !bold;
        } else {
          html += italic ? "</i>" : "<i>";
          italic = !italic;
        }
        i += marker.length;
        continue;
      }
    }

    buffer += text[i];
    i += 1;
  }

  flush();
  if (italic) html += "</i>";
  if (bold) html += "</b>";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
