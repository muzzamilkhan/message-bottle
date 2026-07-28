"use client";

import { useEffect, useRef } from "react";
import { fromDom, serializeRichText } from "@/lib/letter-rich-text";
import { toEditableHtml } from "@/lib/letter-editable-html";

// One contenteditable region of the letter.
//
// The load-bearing rule: React writes this element's content ONCE, on mount,
// and never again. A contenteditable whose innerHTML React re-renders puts the
// caret back at the start on every keystroke, so `text` is an initial value,
// not a controlled one — state flows DOM → React only. Everything else here
// follows from that.

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
