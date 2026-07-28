// The one place that decides between a parent-uploaded photo and the emoji
// avatar. Every visual avatar slot goes through here; the handful of sites
// that render the emoji as text (a <select> option, prose listing kids'
// names) keep interpolating `child.avatar` directly, because an <img> is
// invalid in those positions.

type AvatarSize = "sm" | "md" | "lg" | "xl";

// Emoji class and photo pixel size per slot, matching the markup these
// replaced.
const SIZES: Record<AvatarSize, { text: string; px: number }> = {
  sm: { text: "text-2xl", px: 32 },
  md: { text: "text-3xl", px: 40 },
  lg: { text: "text-4xl", px: 48 },
  xl: { text: "text-5xl", px: 64 },
};

export function ChildAvatar({
  child,
  name,
  size = "lg",
}: {
  child: { avatar: string; photo?: string | null };
  // Used as the photo's alt text.
  name: string;
  size?: AvatarSize;
}) {
  const { text, px } = SIZES[size];

  if (child.photo) {
    return (
      // Not next/image: the source is an inline data URL already sized to its
      // render box, so there is nothing to fetch, resize, or cache.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={child.photo}
        alt={name}
        width={px}
        height={px}
        style={{ width: px, height: px }}
        className="shrink-0 rounded-full object-cover ring-1 ring-sea-100"
      />
    );
  }

  return (
    <span className={text} aria-hidden="true">
      {child.avatar}
    </span>
  );
}
