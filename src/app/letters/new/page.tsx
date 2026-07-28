import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Header } from "@/components/header";
import { LetterForm } from "@/components/letter-form";
import { getAccessibleChildren } from "@/lib/children";

export default async function NewLetter({
  searchParams,
}: {
  searchParams: Promise<{ childId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const children = await getAccessibleChildren(session.user.id);

  // If we arrived from a child's avatar, lock the letter to that child (and
  // hide the picker). Ignore an unknown/inaccessible id and fall back to the
  // picker.
  const { childId } = await searchParams;
  const lockedChild = childId
    ? children.find((c) => c.id === childId)
    : undefined;

  return (
    <>
      <Header userName={session.user.name} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link
          href="/dashboard"
          className="text-sm font-semibold text-sea-600 hover:text-sea-800"
        >
          ← Back to your bottles
        </Link>
        <h1 className="mb-1 mt-3 text-3xl font-extrabold text-sea-800">
          {lockedChild ? `Write a letter to ${lockedChild.name}` : "Write a letter"}
        </h1>
        <p className="mb-6 text-sea-600">
          Say what's in your heart. It will wait, sealed, until the day you
          choose.
        </p>

        {children.length === 0 ? (
          <div className="card flex flex-col items-center py-12 text-center">
            <div className="animate-float text-5xl">🧒</div>
            <h2 className="mt-4 text-xl font-bold text-sea-800">
              Add a child first
            </h2>
            <p className="mt-2 max-w-sm text-sea-600">
              Letters are addressed to one of your kids. Create a profile, then
              come back to write.
            </p>
            <Link href="/children" className="btn-primary mt-6">
              ➕ Add a child
            </Link>
          </div>
        ) : (
          <LetterForm children={children} lockedChild={lockedChild} />
        )}
      </main>
    </>
  );
}
