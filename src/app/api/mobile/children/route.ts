import { createChildFor, listChildrenFor } from "@/lib/child-service";
import { requireUser } from "@/lib/mobile-auth";
import { childError, childInputFrom } from "@/lib/mobile-child-io";
import { toApiChild } from "@/lib/mobile-contract";
import { jsonOk, readJson } from "@/lib/mobile-response";

// The caller's children. Scoped to them by the service, which queries on
// parentId - ownership is the whole access model and there is no sharing.
export async function GET(request: Request): Promise<Response> {
  return requireUser(request, async (userId) => {
    const children = await listChildrenFor(userId);
    return jsonOk({ children: children.map((child) => toApiChild(child)) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return requireUser(request, async (userId) => {
    const body = await readJson(request);
    const result = await createChildFor(userId, childInputFrom(body));
    if (!result.ok) return childError(result);

    return jsonOk({ child: toApiChild(result.value) }, 201);
  });
}
