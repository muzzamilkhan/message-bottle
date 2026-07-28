"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LetterBlock } from "@/lib/letter-blocks";
import { IMAGES_PER_LETTER } from "@/lib/letter-image";
import { LetterFormatToolbar } from "@/components/letter-format-toolbar";
import { LetterPhotoBlock } from "@/components/letter-photo-block";
import { LetterTextBlock } from "@/components/letter-text-block";
import {
  useLetterImageUpload,
  type DraftImage,
} from "@/components/use-letter-image-upload";

// The letter body, as blocks the parent can see and rearrange.
//
// Everything here is a view over a plain string: letter-form.tsx serialises
// these blocks with toBody() before submitting, so the server receives exactly
// what the old textarea sent.

// Stable React keys. Without them a text block remounts when a sibling is
// inserted, and remounting a contenteditable loses the caret.
type Keyed = { key: string; block: LetterBlock };

export function LetterBlocksEditor({
  blocks,
  onChange,
  letterId,
  canUpload,
  existingImages,
}: {
  blocks: LetterBlock[];
  onChange: (blocks: LetterBlock[]) => void;
  letterId?: string;
  // Whether this author's subscription covers uploading. The server checks
  // again — this only decides what the form offers.
  canUpload: boolean;
  // Photos this draft already holds, so their dimensions are known before the
  // image loads. Uploads from this session are merged in.
  existingImages: DraftImage[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, upload } = useLetterImageUpload({ letterId });
  const [uploaded, setUploaded] = useState<DraftImage[]>([]);
  const [showUpsell, setShowUpsell] = useState(false);
  // Whether the current selection is bold/italic, read from the browser rather
  // than toggled on click, so the toolbar's pressed state always matches what's
  // actually formatted.
  const [marks, setMarks] = useState({ bold: false, italic: false });
  // Where a photo should land: the index after the text block last focused.
  const insertAt = useRef<number | null>(null);

  // Keys are assigned once per block and kept in step with the block list by
  // index. A ref, not state — changing a key must never trigger a render.
  const nextKey = useRef(0);
  const keysRef = useRef<string[]>([]);
  if (keysRef.current.length !== blocks.length) {
    // Blocks were added or removed outside a keyed operation (the first render,
    // or a draft loading). Rebuild, preferring an image id where there is one.
    // A length comparison is enough to catch that because each draft is its
    // own route (/letters/new, /letters/[id]): LetterForm mounts fresh per
    // letter, and `blocks` is never swapped to a different letter in place. A
    // future refactor that lets one mounted editor switch between drafts
    // would need a stronger guard than length alone.
    keysRef.current = blocks.map(
      (block, index) =>
        keysRef.current[index] ??
        (block.kind === "photo" ? `photo-${block.id}` : `text-${nextKey.current++}`),
    );
  }

  const keyed: Keyed[] = blocks.map((block, index) => ({
    key:
      block.kind === "photo"
        ? `photo-${block.id}`
        : (keysRef.current[index] ?? `text-${index}`),
    block,
  }));

  const known = new Map(
    [...existingImages, ...uploaded].map((image) => [image.id, image]),
  );

  const photoCount = blocks.filter((block) => block.kind === "photo").length;
  const full = photoCount >= IMAGES_PER_LETTER;

  function update(next: LetterBlock[]) {
    // Never leave the editor with nothing to type into.
    onChange(next.length > 0 ? next : [{ kind: "text", text: "" }]);
  }

  function setBlock(index: number, text: string) {
    const next = [...blocks];
    next[index] = { kind: "text", text };
    onChange(next);
  }

  function removeAt(index: number) {
    keysRef.current.splice(index, 1);
    update(blocks.filter((_, i) => i !== index));
  }

  function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[to]] = [next[to], next[index]];
    const keys = keysRef.current;
    [keys[index], keys[to]] = [keys[to], keys[index]];
    onChange(next);
  }

  // Read bold/italic straight from the current selection. queryCommandState is
  // the reality the toolbar should mirror: it flips back to false the moment a
  // mark is toggled off or the caret leaves styled text, so the buttons can't
  // get stuck "on". A selection outside this editor's text blocks isn't ours to
  // report, so it reads as unformatted.
  const refreshMarks = useCallback(() => {
    const selection = document.getSelection();
    const node = selection?.anchorNode;
    const el = node?.nodeType === 1 ? (node as Element) : node?.parentElement;
    if (!el?.closest("[data-letter-text-block]")) {
      setMarks({ bold: false, italic: false });
      return;
    }
    setMarks({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
    });
  }, []);

  // Follow the caret so the pressed state tracks selection moves and keyboard
  // shortcuts (Cmd+B), not just toolbar clicks.
  useEffect(() => {
    document.addEventListener("selectionchange", refreshMarks);
    return () => document.removeEventListener("selectionchange", refreshMarks);
  }, [refreshMarks]);

  // execCommand is formally deprecated but implemented everywhere, and it
  // handles caret and selection restoration correctly. Hand-rolled Range
  // surgery is more code and more edge cases for no gain at this size.
  const format = useCallback(
    (command: "bold" | "italic") => {
      document.execCommand(command);
      // The DOM changed under the block; its own onInput won't fire for an
      // execCommand, so nudge the focused block to re-emit.
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.dispatchEvent(new Event("input", { bubbles: true }));
      }
      // Toggling a mark doesn't move the caret, so selectionchange may not
      // fire — re-read the state directly so the button updates now.
      refreshMarks();
    },
    [refreshMarks],
  );

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failure.
    event.target.value = "";
    if (!file) return;

    const image = await upload(file);
    if (!image) return;

    setUploaded((current) => [...current, image]);

    const at = insertAt.current ?? blocks.length;
    const next = [...blocks];
    next.splice(at, 0, { kind: "photo", id: image.id });
    keysRef.current.splice(at, 0, `photo-${image.id}`);
    // A photo always has somewhere to type after it.
    if (at === next.length - 1) {
      next.push({ kind: "text", text: "" });
      keysRef.current.push(`text-${nextKey.current++}`);
    }
    onChange(next);
  }

  return (
    <div>
      {/* The outer box owns the border and clips its rounded corners; the inner
          div is the scroll container, so the toolbar's `sticky top-0` pins it to
          the input rather than the page. overflow-x-hidden lets the toolbar's
          negative margins reach the edges without a horizontal scrollbar. */}
      <div className="field-input overflow-hidden !p-0">
        <div className="max-h-[60vh] min-h-48 space-y-1 overflow-y-auto overflow-x-hidden px-4 py-3 text-sea-900">
          <LetterFormatToolbar
            boldActive={marks.bold}
            italicActive={marks.italic}
            onBold={() => format("bold")}
            onItalic={() => format("italic")}
          />
          {keyed.map(({ key, block }, index) => {
            if (block.kind === "photo") {
              const image = known.get(block.id);
              // An id with no known dimensions still renders — the image loads,
              // the box just isn't reserved.
              return (
                <LetterPhotoBlock
                  key={key}
                  image={image ?? { id: block.id, width: 1280, height: 960 }}
                  canMoveUp={index > 0}
                  canMoveDown={index < blocks.length - 1}
                  onMoveUp={() => move(index, -1)}
                  onMoveDown={() => move(index, 1)}
                  onRemove={() => removeAt(index)}
                />
              );
            }
            return (
              <div key={key} data-letter-text-block>
                <LetterTextBlock
                  text={block.text}
                  placeholder={
                    index === 0
                      ? "Dear Ada, I'm writing this while you're still small enough to fall asleep on my shoulder…"
                      : undefined
                  }
                  onChange={(text) => setBlock(index, text)}
                  onFocus={() => {
                    insertAt.current = index + 1;
                  }}
                  onBlur={() => {
                    // An emptied block that isn't the only one goes away, so the
                    // letter doesn't accumulate blank gaps.
                    if (blocks.length > 1 && blocks[index]?.kind === "text") {
                      const current = blocks[index];
                      if (
                        current.kind === "text" &&
                        current.text.trim() === ""
                      ) {
                        removeAt(index);
                      }
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />

      {canUpload ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || full}
            className="text-sm font-semibold text-sea-600 hover:text-sea-800 disabled:opacity-60"
          >
            {busy ? "Adding your photo…" : "📷 Add a photo"}
          </button>
          <p className="mt-1 text-xs text-sea-500">
            {full
              ? `That's all ${IMAGES_PER_LETTER} photos for this letter.`
              : `${photoCount}/${IMAGES_PER_LETTER} photos. It lands where you're writing.`}
          </p>
        </div>
      ) : (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowUpsell(true)}
            className="text-sm font-semibold text-sea-500 hover:text-sea-700"
          >
            📷 Add a photo <span className="text-blush-400">· Pro</span>
          </button>
          {showUpsell && (
            <p className="mt-2 rounded-2xl bg-sea-100 px-4 py-3 text-sm text-sea-600">
              Photos in letters are part of Pro.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {error}
        </p>
      )}
    </div>
  );
}
