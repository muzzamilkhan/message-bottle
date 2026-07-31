import { listLettersFor, saveLetterFor } from "@/lib/letter-service";
import { requireUser } from "@/lib/mobile-auth";
import {
  letterError,
  letterInputFrom,
  toApiLetterSummary,
} from "@/lib/mobile-letter-io";
import { jsonOk, readJson } from "@/lib/mobile-response";

// The caller's letters: drafts in full, sealed ones as a count.
//
// The asymmetry is the sealing invariant, not an oversight. Once a letter is
// SENT its author can never read it again - not the body, not even the title -
// so there is nothing here to return but how many there are. The web dashboard
// shows exactly this. Do not add sent titles.
export async function GET(request: Request): Promise<Response> {
  return requireUser(request, async (userId) => {
    const { drafts, sentCount } = await listLettersFor(userId);

    return jsonOk({
      drafts: drafts.map(toApiLetterSummary),
      sentCount,
    });
  });
}

// Create a draft. Always a draft: a new letter can't be born sealed, so there
// is no path here that writes SENT.
export async function POST(request: Request): Promise<Response> {
  return requireUser(request, async (userId) => {
    const body = await readJson(request);

    const result = await saveLetterFor(userId, letterInputFrom(body, { id: "" }));
    if (!result.ok) return letterError(result.error);

    return jsonOk({ id: result.value.id }, 201);
  });
}
