import {
  deleteLetterFor,
  getDraftFor,
  saveLetterFor,
} from "@/lib/letter-service";
import { requireUser } from "@/lib/mobile-auth";
import {
  letterError,
  letterInputFrom,
  toApiLetterDetail,
} from "@/lib/mobile-letter-io";
import { jsonOk, notFound, readJson } from "@/lib/mobile-response";

type Params = { params: Promise<{ id: string }> };

// One draft the caller authored.
//
// Drafts only. A sealed letter is gone from its author's view forever, and a
// missing letter, someone else's letter, and a sealed letter all answer 404
// alike - so this can't be used to learn which ids exist.
export async function GET(
  request: Request,
  { params }: Params,
): Promise<Response> {
  return requireUser(request, async (userId) => {
    const { id } = await params;

    const draft = await getDraftFor(userId, id);
    if (!draft) return notFound();

    return jsonOk({ letter: toApiLetterDetail(draft) });
  });
}

// Edit a draft. The service scopes its write with `status: "DRAFT"`, so a
// sealed letter is unreachable here by construction rather than by a check this
// route could forget.
export async function PATCH(
  request: Request,
  { params }: Params,
): Promise<Response> {
  return requireUser(request, async (userId) => {
    const { id } = await params;
    const body = await readJson(request);

    const result = await saveLetterFor(userId, letterInputFrom(body, { id }));
    if (!result.ok) return letterError(result.error);

    const draft = await getDraftFor(userId, id);
    return draft ? jsonOk({ letter: toApiLetterDetail(draft) }) : notFound();
  });
}

// Delete a draft, and the photos inside it. Only a draft: a sealed letter can
// never be removed, by its author or anyone else.
export async function DELETE(
  request: Request,
  { params }: Params,
): Promise<Response> {
  return requireUser(request, async (userId) => {
    const { id } = await params;

    const result = await deleteLetterFor(userId, id);
    if (!result.ok) return letterError(result.error);

    return jsonOk({ deleted: result.value.id });
  });
}
