import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { LetterForm } from "@/components/letter-form";
import { deleteLetter } from "@/app/actions";
import { getAccessibleChildren } from "@/lib/children";

// Only drafts have a page of their own — they're still editable. Sent letters
// are sealed forever and can never be viewed, edited, or deleted by the author.
export default async function EditDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const letter = await prisma.letter.findUnique({ where: { id } });

  if (
    !letter ||
    letter.authorId !== session.user.id ||
    letter.status !== "DRAFT"
  ) {
    notFound();
  }

  const children = await getAccessibleChildren(session.user.id);

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
          Edit your draft
        </h1>
        <p className="mb-6 text-sea-600">
          Keep tinkering, or seal it when you&apos;re ready. Once sealed, it&apos;s
          out of your hands for good.
        </p>

        <LetterForm
          children={children}
          letter={{
            id: letter.id,
            title: letter.title,
            childId: letter.childId,
            body: letter.body,
            deliverAt: letter.deliverAt
              ? letter.deliverAt.toISOString().slice(0, 10)
              : null,
          }}
        />

        <form action={deleteLetter} className="mt-6 text-center">
          <input type="hidden" name="id" value={letter.id} />
          <button
            type="submit"
            className="text-sm font-semibold text-sea-400 hover:text-blush-500"
          >
            Delete this draft
          </button>
        </form>
      </main>
    </>
  );
}
