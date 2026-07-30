// JSON <-> child-service adapters, shared by the collection and item routes.
//
// Lives here rather than in a route file because a Next route module may only
// export HTTP handlers, and because both routes must refuse in exactly the same
// words - a create and an edit disagreeing about what "that birthday doesn't
// look right" means is precisely the drift this API is built to avoid.

import {
  childServiceMessage,
  type ChildInput,
  type ChildServiceFailure,
} from "./child-service.ts";
import { asString, jsonError } from "./mobile-response.ts";

// Adapt a JSON body to the same strings the web form submits, so both front
// doors run one validation path. Anything missing or of the wrong type arrives
// as "" and is rejected by the parser on its own terms, rather than being
// second-guessed here.
export function childInputFrom(
  body: Record<string, unknown> | null,
): ChildInput {
  return {
    name: asString(body?.name),
    avatar: asString(body?.avatar),
    birthday: asString(body?.birthday),
    openAtAge: asString(body?.openAtAge),
    photo: asString(body?.photo),
    photoAction: asString(body?.photoAction),
  };
}

// A refusal, as a code the app can branch on plus copy it can show. The code is
// the service's own, so the phone and the browser refuse for the same reasons.
export function childError(failure: ChildServiceFailure): Response {
  const message = childServiceMessage(failure.error, {
    name: failure.values?.name ?? "",
    currentAge: failure.currentAge,
  });

  // A child that isn't yours reads as a 404, never a 403 - a 403 would confirm
  // the id exists, the same reasoning the web image route uses. Everything else
  // is the caller sending something invalid.
  const status = failure.error === "CHILD_NOT_FOUND" ? 404 : 400;

  return jsonError(failure.error, message, status);
}
