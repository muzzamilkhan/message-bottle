// One-time backfill: encrypt the title and body of every letter that predates
// encryption-at-rest. Safe to run more than once — a row already carrying the
// scheme prefix is left alone, so a re-run only touches what a previous run
// missed (or letters written before encryption shipped).
//
// The app reads legacy plaintext transparently, so the app keeps working
// whether or not this has run; the backfill just closes the window where old
// contents still sit in the clear.
//
// Usage (needs the same env the app uses):
//   LETTER_ENCRYPTION_KEY=... DATABASE_URL=... npm run db:encrypt-letters

import { PrismaClient } from "@prisma/client";
import { encryptField, isEncrypted, keyFromString } from "../src/lib/letter-crypto.ts";

async function main() {
  const raw = process.env.LETTER_ENCRYPTION_KEY;
  if (!raw) {
    console.error("LETTER_ENCRYPTION_KEY is required.");
    process.exit(1);
  }
  const key = keyFromString(raw);
  const prisma = new PrismaClient();

  try {
    const letters = await prisma.letter.findMany({
      select: { id: true, title: true, body: true },
    });

    let encrypted = 0;
    for (const letter of letters) {
      const title = isEncrypted(letter.title)
        ? letter.title
        : encryptField(letter.title, key);
      const body = isEncrypted(letter.body)
        ? letter.body
        : encryptField(letter.body, key);

      if (title === letter.title && body === letter.body) continue;

      await prisma.letter.update({
        where: { id: letter.id },
        data: { title, body },
      });
      encrypted += 1;
    }

    console.log(
      `Encrypted ${encrypted} of ${letters.length} letter(s); the rest were already encrypted.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
