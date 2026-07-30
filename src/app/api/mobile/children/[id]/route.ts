import { deleteChildFor, updateChildFor } from "@/lib/child-service";
import { requireUser } from "@/lib/mobile-auth";
import { childError, childInputFrom } from "@/lib/mobile-child-io";
import { toApiChild } from "@/lib/mobile-contract";
import { jsonOk, readJson } from "@/lib/mobile-response";

type Params = { params: Promise<{ id: string }> };

// Edit a child. Only the owner may, which the service enforces by scoping its
// lookup on parentId before it writes anything.
export async function PATCH(
  request: Request,
  { params }: Params,
): Promise<Response> {
  return requireUser(request, async (userId) => {
    const { id } = await params;
    const body = await readJson(request);

    const result = await updateChildFor(userId, id, childInputFrom(body));
    if (!result.ok) return childError(result);

    return jsonOk({ child: toApiChild(result.value) });
  });
}

// Delete a child, every letter written to them - drafts and sealed alike - and
// every photo inside those letters. The open link stops working.
//
// This is the destructive promise sole ownership exists to make keepable, and
// it runs the same service the web action does: blobs first, then rows, all in
// one transaction.
export async function DELETE(
  request: Request,
  { params }: Params,
): Promise<Response> {
  return requireUser(request, async (userId) => {
    const { id } = await params;

    const result = await deleteChildFor(userId, id);
    if (!result.ok) return childError(result);

    return jsonOk({ deleted: result.value.id });
  });
}
