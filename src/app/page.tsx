import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-buttons";
import { Bottle } from "@/components/bottle";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center px-6">
      <div className="grid flex-1 items-center gap-10 py-16 md:grid-cols-2">
        <div className="text-center md:text-left">
          <p className="mb-3 inline-block rounded-full bg-white/70 px-4 py-1 text-sm font-semibold text-sea-600">
            🌊 letters across time
          </p>
          <h1 className="text-4xl font-extrabold leading-tight text-sea-800 sm:text-5xl">
            Message in a Bottle
          </h1>
          <p className="mt-4 max-w-md text-lg text-sea-700">
            Write letters to your kids that stay sealed until a special day.
            Tuck in photos, set the date, and let the tide deliver your words
            when the moment is right.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row md:items-start">
            <SignInButton label="Start writing — sign in with Google" />
            <Link href="#how" className="btn-secondary text-sm">
              How it works
            </Link>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="animate-bob drop-shadow-xl">
            <Bottle className="w-56 sm:w-64" />
          </div>
        </div>
      </div>

      <section id="how" className="w-full pb-24">
        <h2 className="mb-6 text-center text-2xl font-bold text-sea-800">
          How it works
        </h2>
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            {
              emoji: "✍️",
              title: "Write a letter",
              text: "Pour your heart out to your child — a birthday note, first-day-of-school wishes, or just because.",
            },
            {
              emoji: "📸",
              title: "Add photos",
              text: "Slip in a few pictures so the memory feels alive when it's opened.",
            },
            {
              emoji: "🗓️",
              title: "Set the date",
              text: "Choose when the bottle can be opened. It stays sealed until that day arrives.",
            },
          ].map((s) => (
            <div key={s.title} className="card text-center">
              <div className="text-4xl">{s.emoji}</div>
              <h3 className="mt-3 text-lg font-bold text-sea-800">{s.title}</h3>
              <p className="mt-2 text-sm text-sea-600">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="waves pointer-events-none fixed inset-x-0 bottom-0 h-20 opacity-40" />
    </main>
  );
}
