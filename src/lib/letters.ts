export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function countdown(target: Date): string {
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return "Ready to open!";

  const days = Math.floor(ms / 86_400_000);
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const rem = days % 365;
    return `${years} year${years > 1 ? "s" : ""}${
      rem ? ` ${rem} day${rem > 1 ? "s" : ""}` : ""
    } to go`;
  }
  if (days >= 1) return `${days} day${days > 1 ? "s" : ""} to go`;

  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours > 1 ? "s" : ""} to go`;

  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins} minute${mins > 1 ? "s" : ""} to go`;
}
