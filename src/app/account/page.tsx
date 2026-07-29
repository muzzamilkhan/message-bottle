import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { DeleteAccountSection } from "@/components/delete-account-section";
import { UserAvatar } from "@/components/user-avatar";
import { formatDate } from "@/lib/letters";
import { describeSubscription } from "@/lib/subscription";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [user, childrenCount, lettersCount, photosCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        image: true,
        createdAt: true,
        subscription: true,
      },
    }),
    prisma.child.count({ where: { parentId: session.user.id } }),
    // Drafts and sealed letters alike - the whole set delete would destroy.
    prisma.letter.count({ where: { authorId: session.user.id } }),
    prisma.letterImage.count({ where: { authorId: session.user.id } }),
  ]);

  if (!user) redirect("/");

  const subscription = describeSubscription(user.subscription);

  return (
    <>
      <Header
        userName={user.name}
        userImage={user.image}
        isPro={subscription.isPro}
      />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link
          href="/dashboard"
          className="text-sm font-semibold text-sea-600 hover:text-sea-800"
        >
          ← Back to your bottles
        </Link>
        <h1 className="mb-1 mt-3 text-3xl font-extrabold text-sea-800">
          Your account
        </h1>
        <p className="mb-6 text-sea-600">
          Your details, your plan, and how to close your account.
        </p>

        <div className="space-y-6">
          {/* Account details */}
          <section className="card space-y-4">
            <div className="flex items-center gap-4">
              <UserAvatar
                name={user.name}
                image={user.image}
                isPro={subscription.isPro}
                size="lg"
              />
              <h2 className="text-lg font-bold text-sea-800">Details</h2>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-sea-600">Name</dt>
                <dd className="text-right text-sea-800">
                  {user.name ?? "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-sea-600">Email</dt>
                <dd className="break-all text-right text-sea-800">
                  {user.email ?? "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-semibold text-sea-600">Member since</dt>
                <dd className="text-right text-sea-800">
                  {formatDate(user.createdAt)}
                </dd>
              </div>
            </dl>
          </section>

          {/* Subscription status */}
          <section className="card space-y-2">
            <h2 className="text-lg font-bold text-sea-800">Subscription</h2>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  subscription.isPro
                    ? "bg-blush-200 text-blush-500"
                    : "bg-sea-100 text-sea-700"
                }`}
              >
                {subscription.isPro ? "✨ " : ""}
                {subscription.label}
              </span>
            </div>
            <p className="text-sm text-sea-600">{subscription.blurb}</p>
          </section>

          {/* Danger zone */}
          <DeleteAccountSection
            childrenCount={childrenCount}
            lettersCount={lettersCount}
            photosCount={photosCount}
          />
        </div>
      </main>
    </>
  );
}
