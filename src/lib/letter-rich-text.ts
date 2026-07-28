// The contenteditable's DOM, turned back into the stored body string.
//
// This is the security boundary of the block editor, and the reason it needs no
// sanitizer. The walk below is an ALLOWLIST THAT EMITS TEXT, not a blocklist
// that strips tags: an element it doesn't recognise contributes only its text
// content, and every character it emits ends up in a plain string that reaches
// the child through parseSpans as a text node. There is no path from a DOM node
// to stored markup, and dangerouslySetInnerHTML stays absent from this codebase.
//
// Adding a case to this walker is the one way to widen what the editor accepts.
// Think hard before doing it.

// A minimal structural view of a DOM node. Real DOM nodes are mapped onto this
// by fromDom() below, which keeps the serialiser testable in Node — which has
// no DOMParser — by letting tests build plain objects instead.
export type RichNode =
  | { type: "text"; text: string }
  | { type: "element"; tag: string; children: RichNode[] };

// Tags that set a formatting flag on the text beneath them.
const BOLD_TAGS = new Set(["b", "strong"]);
const ITALIC_TAGS = new Set(["i", "em"]);
// Tags that end a line. A contenteditable produces these on Enter, and which
// one it picks varies by browser — so handle both rather than depending on it.
const BLOCK_TAGS = new Set(["div", "p"]);

// A run of text sharing one set of formatting flags. Collected before emitting
// so adjacent runs with the same flags merge into a single pair of markers,
// rather than "**so** ** small**" from two neighbouring <b> elements.
type Run = { text: string; bold: boolean; italic: boolean };

function collect(
  nodes: RichNode[],
  bold: boolean,
  italic: boolean,
  runs: Run[],
): void {
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.text) runs.push({ text: node.text, bold, italic });
      continue;
    }

    const tag = node.tag.toLowerCase();

    if (tag === "br") {
      // A line break carries no formatting: markers must close before it, or
      // an unmatched ** would swallow the rest of the paragraph.
      runs.push({ text: "\n", bold: false, italic: false });
      continue;
    }

    if (BOLD_TAGS.has(tag)) {
      collect(node.children, true, italic, runs);
      continue;
    }

    if (ITALIC_TAGS.has(tag)) {
      collect(node.children, bold, true, runs);
      continue;
    }

    if (BLOCK_TAGS.has(tag)) {
      collect(node.children, bold, italic, runs);
      runs.push({ text: "\n", bold: false, italic: false });
      continue;
    }

    // Everything else — <span>, <script>, <img>, anything pasted. The element
    // itself is ignored and only its text survives. This is the default that
    // makes the walker safe by construction.
    collect(node.children, bold, italic, runs);
  }
}

export function serializeRichText(nodes: RichNode[]): string {
  const runs: Run[] = [];
  collect(nodes, false, false, runs);

  let out = "";
  let bold = false;
  let italic = false;

  // Emit a marker whenever a format's OWN flag flips, independently of the
  // other format. This mirrors parseSpans in letter-body.ts exactly: ** and
  // * are two independent toggles there, not a stack of nested tags, so **
  // and * never need to interact here either. The previous version modeled
  // this as nested HTML-like tags (bold always closing outside italic) and
  // had to close-and-reopen the other format whenever one of them ended —
  // which is not only unnecessary but actively wrong: it can print two
  // markers of the same kind back to back (e.g. "****"), and parseSpans
  // reads a repeated marker with nothing between as an EMPTY, non-toggling
  // pair, desynchronising every span after it. Toggling flags independently
  // never produces that: each marker here always corresponds to a real flip.
  function setFormat(nextBold: boolean, nextItalic: boolean) {
    if (bold !== nextBold) {
      out += "**";
      bold = nextBold;
    }
    if (italic !== nextItalic) {
      out += "*";
      italic = nextItalic;
    }
  }

  for (const run of runs) {
    setFormat(run.bold, run.italic);
    out += run.text;
  }
  setFormat(false, false);

  return out;
}

// Map a real DOM node's children onto RichNode. Kept separate from the walk
// above so the rules stay testable without a browser.
export function fromDom(root: Node): RichNode[] {
  return Array.from(root.childNodes).map((node): RichNode => {
    if (node.nodeType === 3 /* Node.TEXT_NODE */) {
      return { type: "text", text: node.textContent ?? "" };
    }
    if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
      return {
        type: "element",
        tag: (node as Element).tagName.toLowerCase(),
        children: fromDom(node),
      };
    }
    // Comments and anything else contribute nothing.
    return { type: "text", text: "" };
  });
}
