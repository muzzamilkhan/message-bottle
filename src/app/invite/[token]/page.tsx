import Link from "next/link";
import { auth, signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Bottle } from "@/components/bottle";
import { AcceptInvite } from "@/components/accept-invite";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16">
      <div className="card flex w-full flex-col items-center text-center">
        {children}
      </div>
    </main>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();

  const invite = await prisma.shareInvite.findUnique({
    where: { token },
    include: {
      inviter: { select: { name: true } },
      children: {
        include: { child: { select: { name: true, avatar: true } } },
      },
    },
  });

  if (!invite || invite.status === "REVOKED") {
    return (
      <Shell>
        <div className="text-5xl">🕳️</div>
        <h1 className="mt-4 text-2xl font-bold text-sea-800">
          This invite isn&apos;t available
        </h1>
        <p className="mt-2 text-sea-600">
          The link may have been cancelled, or it was never quite right. Ask the
          parent who sent it for a fresh one.
        </p>
        <Link href="/" className="btn-secondary mt-6 text-sm">
          Go home
        </Link>
      </Shell>
    );
  }

  const inviterName = invite.inviter.name ?? "A parent";
  const kids = invite.children.map((c) => c.child);
  const kidList = kids.map((k) => `${k.avatar} ${k.name}`).join(", ");

  const intro = (
    <>
      <div className="animate-bob">
        <Bottle className="w-28" />
      </div>
      <h1 className="mt-4 text-2xl font-bold text-sea-800">
        {inviterName} wants to share
      </h1>
      <p className="mt-2 text-sea-600">
        You&apos;ve been invited to write letters to{" "}
        <strong className="text-sea-800">{kidList}</strong>. Your letters will
        wait, sealed, alongside theirs until each bottle&apos;s special day.
      </p>
    </>
  );

  // Not signed in — invite them to sign in (which creates an account if they
  // don't have one) and come right back to this page to accept.
  if (!session?.user?.id) {
    return (
      <Shell>
        {intro}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: `/invite/${token}` });
          }}
          className="mt-6 w-full"
        >
          <button type="submit" className="btn-primary w-full">
            Sign in with Google to accept
          </button>
        </form>
        <p className="mt-3 text-xs text-sea-500">
          No account yet? Signing in creates one for you.
        </p>
      </Shell>
    );
  }

  // The inviter opened their own link.
  if (invite.inviterId === session.user.id) {
    return (
      <Shell>
        {intro}
        <p className="mt-6 rounded-2xl bg-sea-100 px-4 py-3 text-sm font-semibold text-sea-700">
          This is your own invite link — send it to the other parent so they can
          accept.
        </p>
        <Link href="/share" className="btn-secondary mt-4 text-sm">
          Back to sharing
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      {intro}
      <div className="mt-6 w-full">
        <AcceptInvite token={token} />
      </div>
    </Shell>
  );
}
