import Link from "next/link";
import { SignOutButton } from "@/components/auth-buttons";

export function Header({ userName }: { userName?: string | null }) {
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
          {userName ? (
            <span className="hidden text-sm text-sea-600 sm:inline">
              Hi, {userName.split(" ")[0]} 👋
            </span>
          ) : null}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
