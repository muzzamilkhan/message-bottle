import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { AddChildSection } from "@/components/add-child-section";
import { ChildCard, type ChildCardData } from "@/components/child-card";
import { ChildAvatar } from "@/components/child-avatar";
import { formatDate } from "@/lib/letters";
import { describeBottleTimer } from "@/lib/age";

export default async function ChildrenPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [children, sharedChildren] = await Promise.all([
    prisma.child.findMany({
      where: { parentId: session.user.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { letters: true } } },
    }),
    // Children other parents have shared with this user.
    prisma.child.findMany({
      where: { shares: { some: { parentId: session.user.id } } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        avatar: true,
        photo: true,
        parent: { select: { name: true } },
      },
    }),
  ]);

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
      birthdayLabel: child.birthday ? formatDate(child.birthday) : null,
      timerLabel,
      unlocked,
    };
  });

  return (
    <>
      <Header userName={session.user.name} />
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

        {sharedChildren.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-1 text-lg font-bold text-sea-800">
              Shared with you
            </h2>
            <p className="mb-3 text-sm text-sea-600">
              Kids another parent has invited you to write to.
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {sharedChildren.map((child) => (
                <li key={child.id} className="card flex items-center gap-4">
                  <ChildAvatar child={child} name={child.name} size="lg" />
                  <div className="flex-1">
                    <p className="font-bold text-sea-800">{child.name}</p>
                    <p className="text-xs text-sea-500">
                      Shared by {child.parent.name ?? "another parent"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
