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
