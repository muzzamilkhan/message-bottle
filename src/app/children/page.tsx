import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { ChildForm } from "@/components/child-form";
import { deleteChild } from "@/app/actions";
import { formatDate } from "@/lib/letters";

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
      select: { id: true, name: true, avatar: true, parent: { select: { name: true } } },
    }),
  ]);

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
          Add a profile for each child, then address your letters to them.
        </p>

        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-lg font-bold text-sea-800">Add a child</h2>
            <ChildForm />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-sea-800">
              {children.length
                ? `${children.length} kid${children.length > 1 ? "s" : ""}`
                : "No kids yet"}
            </h2>
            {children.length === 0 ? (
              <div className="card text-sea-600">
                Add your first child using the form — they&apos;ll show up here.
              </div>
            ) : (
              <ul className="space-y-3">
                {children.map((child) => (
                  <li key={child.id} className="card flex items-center gap-4">
                    <span className="text-4xl">{child.avatar}</span>
                    <div className="flex-1">
                      <p className="font-bold text-sea-800">{child.name}</p>
                      <p className="text-xs text-sea-500">
                        {child._count.letters} letter
                        {child._count.letters === 1 ? "" : "s"}
                        {child.birthday &&
                          ` · 🎂 ${formatDate(child.birthday)}`}
                      </p>
                    </div>
                    <form action={deleteChild}>
                      <input type="hidden" name="id" value={child.id} />
                      <button
                        type="submit"
                        className="text-sm font-semibold text-sea-400 hover:text-blush-500"
                      >
                        Remove
                      </button>
                    </form>
                  </li>
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
                  <span className="text-4xl">{child.avatar}</span>
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
