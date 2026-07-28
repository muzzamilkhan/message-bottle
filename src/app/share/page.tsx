import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { ShareForm } from "@/components/share-form";
import { ChildAvatar } from "@/components/child-avatar";
import { revokeInvite, revokeShare } from "@/app/actions";
import { formatDate } from "@/lib/letters";

export default async function SharePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const userId = session.user.id;

  const [children, pendingInvites, shares] = await Promise.all([
    prisma.child.findMany({
      where: { parentId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, avatar: true, photo: true },
    }),
    prisma.shareInvite.findMany({
      where: { inviterId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        children: { include: { child: { select: { name: true, avatar: true } } } },
      },
    }),
    // Co-parents who currently have access to any of this user's children.
    prisma.childShare.findMany({
      where: { child: { parentId: userId } },
      orderBy: { createdAt: "asc" },
      include: {
        child: { select: { name: true, avatar: true, photo: true } },
        parent: { select: { name: true, email: true } },
      },
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
          Share access
        </h1>
        <p className="mb-6 max-w-xl text-sea-600">
          Invite another parent to write letters to your kids. Pick the children
          to share and send them a link. When your child opens their bottle one
          day, they&apos;ll see letters from both of you.
        </p>

        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-lg font-bold text-sea-800">
              Invite a co-parent
            </h2>
            <ShareForm childOptions={children} />
          </section>

          <section className="space-y-8">
            <div>
              <h2 className="mb-3 text-lg font-bold text-sea-800">
                Pending invites
              </h2>
              {pendingInvites.length === 0 ? (
                <div className="card text-sea-600">
                  No invites waiting to be accepted.
                </div>
              ) : (
                <ul className="space-y-3">
                  {pendingInvites.map((invite) => (
                    <li key={invite.id} className="card">
                      <p className="text-sm font-semibold text-sea-800">
                        {invite.children
                          .map((c) => `${c.child.avatar} ${c.child.name}`)
                          .join(", ")}
                      </p>
                      <p className="mt-1 text-xs text-sea-500">
                        Created {formatDate(invite.createdAt)} · waiting to be
                        accepted
                      </p>
                      <form action={revokeInvite} className="mt-2">
                        <input type="hidden" name="id" value={invite.id} />
                        <button
                          type="submit"
                          className="text-sm font-semibold text-sea-400 hover:text-blush-500"
                        >
                          Cancel invite
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h2 className="mb-3 text-lg font-bold text-sea-800">
                Co-parents
              </h2>
              {shares.length === 0 ? (
                <div className="card text-sea-600">
                  No one has access to your kids yet.
                </div>
              ) : (
                <ul className="space-y-3">
                  {shares.map((share) => (
                    <li
                      key={share.id}
                      className="card flex items-center gap-4"
                    >
                      <ChildAvatar
                        child={share.child}
                        name={share.child.name}
                        size="md"
                      />
                      <div className="flex-1">
                        <p className="font-bold text-sea-800">
                          {share.parent.name ?? share.parent.email ?? "A parent"}
                        </p>
                        <p className="text-xs text-sea-500">
                          can write to {share.child.name}
                        </p>
                      </div>
                      <form action={revokeShare}>
                        <input type="hidden" name="id" value={share.id} />
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
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
