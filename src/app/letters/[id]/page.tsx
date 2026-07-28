import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { deleteLetter } from "@/app/actions";
import { Bottle } from "@/components/bottle";
import { countdown, formatDate, isUnlocked } from "@/lib/letters";

export default async function LetterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const letter = await prisma.letter.findUnique({
    where: { id },
    include: { photos: true },
  });

  if (!letter || letter.authorId !== session.user.id) notFound();

  const unlocked = isUnlocked(letter.deliverAt);

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

        {unlocked ? (
          <article className="card mt-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-blush-400">
              For {letter.recipientName}
            </p>
            <h1 className="mt-1 text-3xl font-extrabold text-sea-800">
              {letter.title}
            </h1>
            <p className="mt-1 text-xs text-sea-500">
              Written {formatDate(letter.createdAt)} · Opened{" "}
              {formatDate(letter.deliverAt)}
            </p>

            <div className="mt-6 whitespace-pre-wrap text-lg leading-relaxed text-sea-800">
              {letter.body}
            </div>

            {letter.photos.length > 0 && (
              <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
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
        ) : (
          <div className="card mt-4 flex flex-col items-center py-12 text-center">
            <div className="animate-bob">
              <Bottle className="w-36" />
            </div>
            <span className="mt-4 rounded-full bg-sea-100 px-4 py-1 text-sm font-semibold text-sea-700">
              🔒 {countdown(letter.deliverAt)}
            </span>
            <h1 className="mt-4 text-2xl font-bold text-sea-800">
              This bottle is still sealed
            </h1>
            <p className="mt-2 max-w-sm text-sea-600">
              Your letter to <strong>{letter.recipientName}</strong> can be
              opened on <strong>{formatDate(letter.deliverAt)}</strong>. Until
              then, it drifts safely on the tide.
            </p>
            {letter.photos.length > 0 && (
              <p className="mt-3 text-sm text-sea-500">
                {letter.photos.length} photo
                {letter.photos.length > 1 ? "s" : ""} sealed inside.
              </p>
            )}
          </div>
        )}

        <form action={deleteLetter} className="mt-6 text-center">
          <input type="hidden" name="id" value={letter.id} />
          <button
            type="submit"
            className="text-sm font-semibold text-sea-400 hover:text-blush-500"
          >
            Delete this bottle
          </button>
        </form>
      </main>
    </>
  );
}
