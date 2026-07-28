// Helpers for the "bottle timer" — a child unlocks their bottles once they
// reach a chosen age, computed from their birthday.

// Whole years between `birthday` and `at` (how old the child is on that day).
export function ageInYears(birthday: Date, at: Date = new Date()): number {
  let age = at.getFullYear() - birthday.getFullYear();
  const monthDiff = at.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < birthday.getDate())) {
    age -= 1;
  }
  return age;
}

// The moment a child turns `age` — their birthday shifted forward `age` years.
export function birthdayAtAge(birthday: Date, age: number): Date {
  const d = new Date(birthday);
  d.setFullYear(d.getFullYear() + age);
  return d;
}

// True once the child has reached the bottle-timer age.
export function hasReachedOpenAge(
  birthday: Date,
  openAtAge: number,
  at: Date = new Date(),
): boolean {
  return at.getTime() >= birthdayAtAge(birthday, openAtAge).getTime();
}

// The day a letter actually becomes openable for the child: the later of the
// letter's own delivery date and the day the child reaches their open age.
// A letter dated before the child is old enough still waits for the age gate.
export function effectiveOpenDate(
  deliverAt: Date,
  birthday: Date | null,
  openAtAge: number | null,
): Date {
  if (!birthday || openAtAge == null) return deliverAt;
  const ageDate = birthdayAtAge(birthday, openAtAge);
  return ageDate.getTime() > deliverAt.getTime() ? ageDate : deliverAt;
}
