import { sealLetterFor } from "@/lib/letter-service";
import { requireUser } from "@/lib/mobile-auth";
import { letterError } from "@/lib/mobile-letter-io";
import { jsonOk } from "@/lib/mobile-response";

type Params = { params: Promise<{ id: string }> };

// Seal a draft. DRAFT -> SENT, one way, final: after this the author can never
// view, edit, or delete it again.
//
// The request carries no letter content. Sealing what is *stored* rather than
// what the caller sends means a client can't smuggle different words into a
// letter in the same breath as making them permanent - if there are unsaved
// edits, PATCH first, then seal. The service still runs the whole of
// saveLetterFor, so the completeness rules, the photo entitlement check, and
// the final image reconciliation all apply exactly as on the web.
export async function POST(
  request: Request,
  { params }: Params,
): Promise<Response> {
  return requireUser(request, async (userId) => {
    const { id } = await params;

    const result = await sealLetterFor(userId, id);
    if (!result.ok) return letterError(result.error);

    return jsonOk({ id: result.value.id, sealed: result.value.sealed });
  });
}
