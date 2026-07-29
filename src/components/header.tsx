import Link from "next/link";
import { SignOutButton } from "@/components/auth-buttons";
import { UserAvatar } from "@/components/user-avatar";

// The avatar (with its Pro badge) rides along on every authenticated page, so
// each page passes the parent's name, photo, and Pro status down — the callers
// already load the session and subscription, so the header stays a plain
// presentational component.
export function Header({
  userName,
  userImage,
  isPro = false,
}: {
  userName?: string | null;
  userImage?: string | null;
  isPro?: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-white/40 bg-white/50 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-2xl">🍾</span>
          <span className="font-display text-lg font-bold text-sea-800">
            Message in a Bottle
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/children"
            className="text-sm font-semibold text-sea-600 hover:text-sea-800"
          >
            👧 Kids
          </Link>
          <Link
            href="/account"
            className="text-sm font-semibold text-sea-600 hover:text-sea-800"
          >
            ⚙️ Account
          </Link>
          {userName ? (
            <span className="hidden text-sm text-sea-600 sm:inline">
              Hi, {userName.split(" ")[0]} 👋
            </span>
          ) : null}
          <Link href="/account" aria-label="Your account">
            <UserAvatar name={userName} image={userImage} isPro={isPro} />
          </Link>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
