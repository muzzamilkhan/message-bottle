import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { Bottle } from "@/components/bottle";
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
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const child = await prisma.child.findUnique({
    where: { openToken: token },
    include: {
      letters: {
        orderBy: { deliverAt: "asc" },
        include: { photos: true },
      },
    },
  });

  // No child, or the timer was cleared — the link no longer opens anything.
  if (!child || !child.birthday || !child.openAtAge) {
    return <NotAvailable />;
  }

  const openDate = birthdayAtAge(child.birthday, child.openAtAge);
  const reached = hasReachedOpenAge(child.birthday, child.openAtAge);

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
        <div className="space-y-6">
          {child.letters.map((letter) => {
            const unlocked = isUnlocked(letter.deliverAt);
            if (!unlocked) {
              return (
                <div
                  key={letter.id}
                  className="card flex flex-col items-center py-10 text-center"
                >
                  <div className="animate-bob">
                    <Bottle className="w-24" />
                  </div>
                  <span className="mt-3 rounded-full bg-sea-100 px-4 py-1 text-xs font-semibold text-sea-700">
                    🔒 {countdown(letter.deliverAt)}
                  </span>
                  <p className="mt-3 text-sea-600">
                    One more bottle opens on{" "}
                    <strong>{formatDate(letter.deliverAt)}</strong>.
                  </p>
                </div>
              );
            }
            return (
              <article key={letter.id} className="card">
                <h2 className="text-2xl font-extrabold text-sea-800">
                  {letter.title}
                </h2>
                <p className="mt-1 text-xs text-sea-500">
                  Written {formatDate(letter.createdAt)}
                </p>
                <div className="mt-5 whitespace-pre-wrap text-lg leading-relaxed text-sea-800">
                  {letter.body}
                </div>
                {letter.photos.length > 0 && (
                  <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {letter.photos.map((photo) => (
                      <div key={photo.id} className="relative aspect-square">
                        <Image
                          src={photo.url}
                          alt="A photo tucked into the letter"
                          fill
                          sizes="(max-width: 640px) 50vw, 200px"
                          className="rounded-2xl object-cover ring-1 ring-sea-100"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
