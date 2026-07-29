import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { AddChildSection } from "@/components/add-child-section";
import { ChildCard, type ChildCardData } from "@/components/child-card";
import { formatDate } from "@/lib/letters";
import { describeBottleTimer } from "@/lib/age";
import { canUploadImages } from "@/lib/subscription";

export default async function ChildrenPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const author = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { subscription: true },
  });

  const children = await prisma.child.findMany({
    where: { parentId: session.user.id },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { letters: true } },
      // Every letter written to this child, drafts and sealed alike — matches
      // the set `deleteChild` destroys — so the photo total below covers
      // exactly what the warning must promise.
      letters: {
        select: { _count: { select: { images: true } } },
      },
    },
  });

  // Shape each owned child for the interactive card, precomputing the
  // bottle-timer labels on the server.
  const childCards: ChildCardData[] = children.map((child) => {
    const { timerLabel, unlocked } = describeBottleTimer(child, formatDate);
    return {
      id: child.id,
      name: child.name,
      avatar: child.avatar,
      photo: child.photo,
      birthday: child.birthday
        ? child.birthday.toISOString().slice(0, 10)
        : null,
      openAtAge: child.openAtAge,
      openToken: child.openToken,
      lettersCount: child._count.letters,
      photosCount: child.letters.reduce(
        (total, letter) => total + letter._count.images,
        0,
      ),
      birthdayLabel: child.birthday ? formatDate(child.birthday) : null,
      timerLabel,
      unlocked,
    };
  });

  return (
    <>
      <Header
        userName={session.user.name}
        userImage={session.user.image}
        isPro={canUploadImages(author?.subscription)}
      />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link
          href="/dashboard"
          className="text-sm font-semibold text-sea-600 hover:text-sea-800"
        >
          ← Back to your bottles
        </Link>
        <h1 className="mb-1 mt-3 text-3xl font-extrabold text-sea-800">
          Your kids
        </h1>
        <p className="mb-6 text-sea-600">
          Add a profile for each child, edit their details anytime, and set a
          bottle timer — the age when they can open their letters from their own
          private link.
        </p>

        <div className="grid gap-8 md:grid-cols-2">
          <AddChildSection />

          <section>
            <h2 className="mb-3 text-lg font-bold text-sea-800">
              {children.length
                ? `${children.length} kid${children.length > 1 ? "s" : ""}`
                : "No kids yet"}
            </h2>
            {childCards.length === 0 ? (
              <div className="card text-sea-600">
                Add your first child using the form — they&apos;ll show up here.
              </div>
            ) : (
              <ul className="space-y-3">
                {childCards.map((child) => (
                  <ChildCard key={child.id} child={child} />
                ))}
              </ul>
            )}
          </section>
        </div>

      </main>
    </>
  );
}
