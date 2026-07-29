// The signed-in parent's own avatar: their Google profile photo, or a fallback
// initial when there's no photo. When the account is Pro it wears a small ✨
// badge in the corner - the same "Pro" signal the account page shows, attached
// to the person rather than a plain word.
//
// Distinct from ChildAvatar, which renders a *child's* emoji/photo and never a
// subscription badge; children have no account and no tier of their own.

type AvatarSize = "sm" | "lg";

// Photo pixel size, fallback-initial text size, and badge scale per slot.
const SIZES: Record<
  AvatarSize,
  { px: number; text: string; badge: string; ring: string }
> = {
  sm: { px: 32, text: "text-sm", badge: "text-[10px] h-4 w-4", ring: "ring-1" },
  lg: { px: 64, text: "text-2xl", badge: "text-sm h-6 w-6", ring: "ring-2" },
};

export function UserAvatar({
  name,
  image,
  isPro = false,
  size = "sm",
}: {
  name?: string | null;
  image?: string | null;
  isPro?: boolean;
  size?: AvatarSize;
}) {
  const { px, text, badge, ring } = SIZES[size];
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: px, height: px }}
    >
      {image ? (
        // Not next/image: an external avatar URL we don't want to proxy,
        // resize, or add a remote-host allowlist for - the codebase renders
        // avatars with a plain <img> throughout.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={name ?? "Your avatar"}
          width={px}
          height={px}
          style={{ width: px, height: px }}
          className={`rounded-full object-cover ${ring} ring-sea-100`}
        />
      ) : (
        <span
          style={{ width: px, height: px }}
          className={`flex items-center justify-center rounded-full bg-sea-100 font-bold text-sea-700 ${text} ${ring} ring-sea-100`}
          aria-hidden="true"
        >
          {initial}
        </span>
      )}
      {isPro ? (
        <span
          title="Pro member"
          aria-label="Pro member"
          className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-blush-200 ring-2 ring-white ${badge}`}
        >
          ✨
        </span>
      ) : null}
    </span>
  );
}
