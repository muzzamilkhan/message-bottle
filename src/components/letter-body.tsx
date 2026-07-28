import { parseLetterBody, type Span } from "@/lib/letter-body";

// An image the letter is allowed to show, with its stored size.
export type LetterImageRef = {
  id: string;
  width: number;
  height: number;
};

// Render a letter body: paragraphs, light emphasis, and inline photos.
//
// Every node becomes a React element. Nothing here uses
// dangerouslySetInnerHTML, and nothing here should ever start: user text lands
// in text nodes, which is what keeps this feature free of a sanitization
// surface. Formatting comes from the parser, never from markup in the body.
export function LetterBody({
  body,
  images = [],
  openToken,
}: {
  body: string;
  images?: LetterImageRef[];
  // Present only on the child's open page, where there is no session and the
  // token is the credential.
  openToken?: string;
}) {
  const nodes = parseLetterBody(body);
  const byId = new Map(images.map((image) => [image.id, image]));

  return (
    <>
      {nodes.map((node, index) => {
        if (node.kind === "image") {
          const image = byId.get(node.id);
          // A marker with no matching image — a hand-edited body, or an image
          // deleted from under it — is skipped rather than breaking the page.
          if (!image) return null;
          return (
            <LetterImage key={`${node.id}-${index}`} image={image} openToken={openToken} />
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {node.spans.map((span, spanIndex) => (
              <SpanText key={spanIndex} span={span} />
            ))}
          </p>
        );
      })}
    </>
  );
}

function SpanText({ span }: { span: Span }) {
  let content = <>{span.text}</>;
  if (span.italic) content = <em>{content}</em>;
  if (span.bold) content = <strong>{content}</strong>;
  return content;
}

function LetterImage({
  image,
  openToken,
}: {
  image: LetterImageRef;
  openToken?: string;
}) {
  // Every image byte comes through the authorized route; there is no other URL
  // that serves one. The token rides in the query string because an <img>
  // can't send a header.
  const src = openToken
    ? `/api/letter-image/${image.id}?t=${encodeURIComponent(openToken)}`
    : `/api/letter-image/${image.id}`;

  return (
    // Plain <img>, not next/image: the route is authorized per-request and
    // returns no-store, so there is nothing for the optimizer to fetch or cache.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      // A photograph is content, not decoration, so never alt="". There is no
      // caption field in the data model, so this is generic but honest.
      // ("photo" itself is out: jsx-a11y/img-redundant-alt — a screen reader
      // already announces that this is an image.)
      alt="Included with this letter"
      width={image.width}
      height={image.height}
      // Full width of the letter column, with the stored size setting the
      // aspect box so the page doesn't jump as photos load.
      className="my-4 h-auto w-full rounded-2xl"
      loading="lazy"
    />
  );
}
