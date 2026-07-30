import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { promoteNewUser } from "@/lib/pro-signup";

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
    // the PRO tier the moment their account is created - the adapter has already
    // inserted the row with a null subscription, so we promote it here.
    //
    // The promotion itself lives in @/lib/pro-signup because the mobile sign-in
    // route creates users without going through this hook, and the two must
    // treat a new account identically.
    async createUser({ user }) {
      if (!user.id) return;
      await promoteNewUser(user.id);
    },
  },
});
