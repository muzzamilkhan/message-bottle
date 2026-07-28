import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Header } from "@/components/header";
import { LetterForm } from "@/components/letter-form";

export default async function NewLetter() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

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
          Write a letter
        </h1>
        <p className="mb-6 text-sea-600">
          Say what's in your heart. It will wait, sealed, until the day you
          choose.
        </p>
        <LetterForm />
      </main>
    </>
  );
}
