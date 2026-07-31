import { deleteAccountFor } from "@/lib/account-service";
import { requireUser } from "@/lib/mobile-auth";
import { jsonOk } from "@/lib/mobile-response";

// Permanently delete the caller's account: every child, every letter (draft
// and sealed alike), and every photo inside them - the same promise the web
// account page makes, run through the same service.
//
// No separate session revocation call: deleting the User row cascades to every
// Session, web and mobile alike, so the token this very request authenticated
// with is already gone once deleteAccountFor returns. The client's only
// remaining job is to forget the token locally.
export async function DELETE(request: Request): Promise<Response> {
  return requireUser(request, async (userId) => {
    await deleteAccountFor(userId);

    return jsonOk({ ok: true });
  });
}
