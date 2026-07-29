import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SignOutButton } from "@/components/auth-buttons";
import { UserAvatar } from "@/components/user-avatar";
import { describeSubscription } from "@/lib/subscription";

// Async server component: it reads the session for the avatar photo and looks
// up the subscription so the Pro badge rides along on the avatar everywhere the
// header appears. `userName` stays an accepted prop for the greeting, falling
// back to the session name.
export async function Header({ userName }: { userName?: string | null }) {
  const session = await auth();
  const user = session?.user;
  const name = userName ?? user?.name;

  let isPro = false;
  if (user?.id) {
    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { subscription: true },
    });
    isPro = describeSubscription(record?.subscription).isPro;
  }

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
          {name ? (
            <span className="hidden text-sm text-sea-600 sm:inline">
              Hi, {name.split(" ")[0]} 👋
            </span>
          ) : null}
          {user ? (
            <Link href="/account" aria-label="Your account">
              <UserAvatar name={name} image={user.image} isPro={isPro} />
            </Link>
          ) : null}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
