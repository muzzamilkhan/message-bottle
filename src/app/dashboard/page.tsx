import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { countdown, formatDate, isUnlocked } from "@/lib/letters";
import { effectiveOpenDate } from "@/lib/age";

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const letters = await prisma.letter.findMany({
    where: { authorId: session.user.id },
    orderBy: { deliverAt: "asc" },
    include: {
      _count: { select: { photos: true } },
      child: { select: { avatar: true, birthday: true, openAtAge: true } },
    },
  });

  return (
    <>
      <Header userName={session.user.name} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-sea-800">
              Your bottles
            </h1>
            <p className="text-sea-600">
              {letters.length
                ? `${letters.length} letter${letters.length > 1 ? "s" : ""} adrift.`
                : "No letters yet — write your first one!"}
            </p>
          </div>
          <Link href="/letters/new" className="btn-primary">
            ✍️ Write a letter
          </Link>
        </div>

        {letters.length === 0 ? (
          <div className="card flex flex-col items-center py-16 text-center">
            <div className="animate-float text-6xl">🌊</div>
            <p className="mt-4 max-w-sm text-sea-600">
              Every bottle starts with a few words. Write something your child
              will treasure years from now.
            </p>
            <Link href="/letters/new" className="btn-primary mt-6">
              Write your first letter
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {letters.map((letter) => {
              // The bottle only opens once its delivery date passes AND the
              // child has reached the age their parent set — show the later of
              // the two, not just the delivery date.
              const openDate = effectiveOpenDate(
                letter.deliverAt,
                letter.child?.birthday ?? null,
                letter.child?.openAtAge ?? null,
              );
              const unlocked = isUnlocked(openDate);
              return (
                <li key={letter.id}>
                  <Link
                    href={`/letters/${letter.id}`}
                    className="card block h-full transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-3xl">{unlocked ? "💌" : "🔒"}</span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          unlocked
                            ? "bg-blush-200 text-blush-500"
                            : "bg-sea-100 text-sea-600"
                        }`}
                      >
                        {unlocked ? "Ready to open" : countdown(openDate)}
                      </span>
                    </div>
                    <h2 className="mt-3 text-lg font-bold text-sea-800">
                      {letter.title}
                    </h2>
                    <p className="text-sm text-sea-600">
                      {letter.child?.avatar ?? "💌"} For {letter.recipientName}
                    </p>
                    <p className="mt-3 text-xs text-sea-500">
                      Opens {formatDate(openDate)}
                      {letter._count.photos > 0 &&
                        ` · ${letter._count.photos} photo${
                          letter._count.photos > 1 ? "s" : ""
                        }`}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
