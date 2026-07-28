import { prisma } from "@/lib/prisma";
import { Bottle } from "@/components/bottle";
import { LetterStack, type StackLetter } from "@/components/letter-stack";
import { countdown, formatDate, isUnlocked } from "@/lib/letters";
import { birthdayAtAge, hasReachedOpenAge } from "@/lib/age";

// The child's self-authenticating open link. The unguessable token in the URL
// is the credential — no sign-in needed. Bottles stay sealed until the child
// reaches the age their parent set (and each letter's own delivery date).
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">{children}</main>
  );
}

function NotAvailable() {
  return (
    <Shell>
      <div className="card flex flex-col items-center py-16 text-center">
        <div className="text-5xl">🕳️</div>
        <h1 className="mt-4 text-2xl font-bold text-sea-800">
          This link isn&apos;t available
        </h1>
        <p className="mt-2 max-w-sm text-sea-600">
          It may have been removed, or the bottle timer isn&apos;t set up yet.
          Ask the grown-up who sent it for a fresh link.
        </p>
      </div>
    </Shell>
  );
}

export default async function OpenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const { test } = await searchParams;

  // Testing escape hatch: `?test=yes` opens the bottle straight away, ignoring
  // the age-based bottle timer (and each letter's delivery date). It only works
  // when the deployment explicitly opts in with TESTING=true — in normal
  // environments the flag is inert and bottles stay sealed until their time.
  const testOverride = process.env.TESTING === "true" && test === "yes";

  const child = await prisma.child.findUnique({
    where: { openToken: token },
    include: {
      letters: {
        // Only sealed (SENT) letters ever reach the child — drafts stay with
        // the parent. Oldest first: the child reads forward through time, one
        // bottle at a time, swiping each away to reach the next.
        where: { status: "SENT" },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true } } },
      },
    },
  });

  // No child, or the timer was cleared — the link no longer opens anything.
  if (!child || !child.birthday || !child.openAtAge) {
    return <NotAvailable />;
  }

  const openDate = birthdayAtAge(child.birthday, child.openAtAge);
  const reached =
    testOverride || hasReachedOpenAge(child.birthday, child.openAtAge);

  // Still counting down — nothing but the sealed collection is shown.
  if (!reached) {
    return (
      <Shell>
        <div className="card flex flex-col items-center py-14 text-center">
          <div className="animate-bob">
            <Bottle className="w-36" />
          </div>
          <span className="mt-4 rounded-full bg-sea-100 px-4 py-1 text-sm font-semibold text-sea-700">
            🔒 {countdown(openDate)}
          </span>
          <h1 className="mt-4 text-2xl font-bold text-sea-800">
            Hi {child.name}! Your bottles are still sealed
          </h1>
          <p className="mt-2 max-w-sm text-sea-600">
            {child.letters.length > 0
              ? `${child.letters.length} letter${
                  child.letters.length > 1 ? "s" : ""
                } have been written for you. `
              : ""}
            They&apos;ll all wash ashore on{" "}
            <strong>{formatDate(openDate)}</strong>, the day you turn{" "}
            <strong>{child.openAtAge}</strong>.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-8 text-center">
        <div className="text-5xl">{child.avatar}</div>
        <h1 className="mt-2 text-3xl font-extrabold text-sea-800">
          Bottles for {child.name}
        </h1>
        <p className="mt-1 text-sea-600">
          You&apos;ve reached {child.openAtAge} — the bottles are yours to open. 🎉
        </p>
      </header>

      {child.letters.length === 0 ? (
        <div className="card py-14 text-center text-sea-600">
          No letters have washed ashore yet. Check back soon!
        </div>
      ) : (
        <LetterStack
          letters={child.letters.map(
            (letter): StackLetter => ({
              id: letter.id,
              title: letter.title,
              body: letter.body,
              authorName: letter.author?.name?.trim() || "A parent",
              writtenDate: formatDate(letter.createdAt),
              // SENT letters always carry a delivery date; fall back defensively.
              deliverDate: letter.deliverAt
                ? formatDate(letter.deliverAt)
                : formatDate(letter.createdAt),
              countdown: letter.deliverAt
                ? countdown(letter.deliverAt)
                : "Ready to open!",
              unlocked:
                testOverride ||
                !letter.deliverAt ||
                isUnlocked(letter.deliverAt),
            }),
          )}
        />
      )}
    </Shell>
  );
}
