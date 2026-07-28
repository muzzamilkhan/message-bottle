import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { lifetimeProSignup } from "@/flags";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  pages: {
    signIn: "/",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    // Lifetime-Pro promotion. While the flag is on, a brand-new user is granted
    // the PRO tier the moment their account is created — the adapter has already
    // inserted the row with a null subscription, so we promote it here. The flag
    // fails closed, so if it can't be proven on, the signup stays free. This only
    // ever grants Pro; it never revokes it, so turning the flag off later leaves
    // already-promoted members untouched.
    async createUser({ user }) {
      if (!user.id) return;
      if (!(await lifetimeProSignup())) return;
      await prisma.user.update({
        where: { id: user.id },
        data: { subscription: "PRO" },
      });
    },
  },
});
