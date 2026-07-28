import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { ChildAvatar } from "@/components/child-avatar";
import { formatDate } from "@/lib/letters";
import { getAccessibleChildren } from "@/lib/children";

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [sentCount, drafts, children] = await Promise.all([
    prisma.letter.count({
      where: { authorId: session.user.id, status: "SENT" },
    }),
    prisma.letter.findMany({
      where: { authorId: session.user.id, status: "DRAFT" },
      orderBy: { updatedAt: "desc" },
      include: { child: { select: { avatar: true } } },
    }),
    getAccessibleChildren(session.user.id),
  ]);

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
              {sentCount > 0
                ? `${sentCount} message${sentCount > 1 ? "s" : ""} sealed and set adrift.`
                : "No messages sent yet — write your first one!"}
            </p>
          </div>
          <Link href="/letters/new" className="btn-primary">
            ✍️ Write a letter
          </Link>
        </div>

        {/* Kid avatars — the quickest way to start a letter. Tapping one opens a
            new letter already addressed to that child. Wraps to more rows when a
            parent has lots of kids. */}
        <div className="card mb-8">
          <h2 className="text-lg font-bold text-sea-800">Write a letter to…</h2>
          <p className="mb-4 mt-1 text-sm text-sea-600">
            {children.length > 0
              ? "Tap a child to start a new bottle just for them."
              : "Add a child first, then tap their face here to write to them."}
          </p>
          {children.length > 0 ? (
            <ul className="flex flex-wrap gap-3">
              {children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={`/letters/new?childId=${child.id}`}
                    className="flex w-24 flex-col items-center gap-2 rounded-2xl bg-sea-50 px-3 py-4 text-center ring-1 ring-sea-100 transition hover:-translate-y-1 hover:bg-white hover:shadow-md"
                  >
                    <ChildAvatar child={child} name={child.name} size="lg" />
                    <span className="max-w-full truncate text-sm font-semibold text-sea-800">
                      {child.name}
                    </span>
                    {!child.owned && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-sea-400">
                        shared
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Link href="/children" className="btn-primary">
              ➕ Add a child
            </Link>
          )}
        </div>

        {/* Sent messages are sealed forever, so we only ever surface a count —
            there's nothing left to open on this side of the tide. */}
        <div className="card mb-8 flex items-center gap-4">
          <span className="text-4xl">🍾</span>
          <div>
            <p className="text-2xl font-extrabold text-sea-800">{sentCount}</p>
            <p className="text-sm text-sea-600">
              message{sentCount === 1 ? "" : "s"} sent. Once sealed, a bottle
              can&apos;t be viewed, edited, or deleted — it&apos;s on its way to
              your child.
            </p>
          </div>
        </div>

        <h2 className="mb-3 text-xl font-bold text-sea-800">Drafts</h2>
        {drafts.length === 0 ? (
          <div className="card flex flex-col items-center py-12 text-center">
            <div className="animate-float text-5xl">📝</div>
            <p className="mt-4 max-w-sm text-sea-600">
              No drafts right now. Start a letter and save it as a draft to
              come back to it later.
            </p>
            <Link href="/letters/new" className="btn-primary mt-6">
              Write a letter
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link
                  href={`/letters/${draft.id}`}
                  className="card block h-full transition hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-3xl">📝</span>
                    <span className="rounded-full bg-sea-100 px-3 py-1 text-xs font-semibold text-sea-600">
                      Draft
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-sea-800">
                    {draft.title || "Untitled draft"}
                  </h3>
                  <p className="text-sm text-sea-600">
                    {draft.child?.avatar ?? "💌"}{" "}
                    {draft.recipientName
                      ? `For ${draft.recipientName}`
                      : "No recipient yet"}
                  </p>
                  <p className="mt-3 text-xs text-sea-500">
                    Last edited {formatDate(draft.updatedAt)} · Tap to edit or
                    seal
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
