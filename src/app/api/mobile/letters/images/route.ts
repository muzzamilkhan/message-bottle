import { uploadLetterImageFor } from "@/lib/letter-service";
import { requireUser } from "@/lib/mobile-auth";
import { letterError } from "@/lib/mobile-letter-io";
import { badRequest, jsonOk } from "@/lib/mobile-response";

// Upload one compressed photo and get back the id to write into a letter body
// as `[[img:<id>]]`.
//
// Multipart rather than a raw binary body, because the service needs the
// decoded width and height alongside the bytes and a File carries its own MIME
// type - the same three things the web editor sends.
//
// The client is expected to downscale and compress first, exactly as the web
// editor does, but that is a courtesy: every size, dimension, type, and count
// check runs server-side in uploadLetterImageFor, including the Pro gate.
// Uploading is gated; reading never is.
export async function POST(request: Request): Promise<Response> {
  return requireUser(request, async (userId) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return badRequest("Send the photo as multipart/form-data.");
    }

    const file = form.get("image");
    const result = await uploadLetterImageFor(userId, {
      // A non-File field is malformed, which the service reports in its own
      // words; hand it something it can reject rather than deciding here.
      file: file instanceof File ? file : new File([], ""),
      width: Number(form.get("width")),
      height: Number(form.get("height")),
      letterId: String(form.get("letterId") ?? ""),
    });
    if (!result.ok) return letterError(result.error);

    return jsonOk({ image: result.value }, 201);
  });
}
