// Which subscription tiers may use paid features. Billing doesn't exist yet —
// User.subscription is set by hand — so this is the whole entitlement story.

// Tiers allowed to upload inline letter images. Membership, not equality, so
// adding a tier later means adding a string here and nothing else.
export const IMAGE_UPLOAD_TIERS = ["PRO"] as const;

// Whether this subscription may upload images. Reading an image never consults
// this: the child opening a bottle has no account at all, and a letter sealed
// while the author was Pro must keep its photos forever.
export function canUploadImages(
  subscription: string | null | undefined,
): boolean {
  return (IMAGE_UPLOAD_TIERS as readonly string[]).includes(subscription ?? "");
}
