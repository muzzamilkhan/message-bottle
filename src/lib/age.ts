// Helpers for the "bottle timer" - a child unlocks their bottles once they
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

// The moment a child turns `age` - their birthday shifted forward `age` years.
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

// How a child's bottle timer reads on their card: whether it has unlocked, and
// the label describing it. Returns nulls when the child has no timer set.
export type BottleTimer = {
  unlocked: boolean;
  timerLabel: string | null;
};

export function describeBottleTimer(
  child: { name: string; birthday: Date | null; openAtAge: number | null },
  formatDate: (date: Date) => string,
  at: Date = new Date(),
): BottleTimer {
  if (!child.birthday || !child.openAtAge) {
    return { unlocked: false, timerLabel: null };
  }

  const unlocked = hasReachedOpenAge(child.birthday, child.openAtAge, at);
  const openDate = birthdayAtAge(child.birthday, child.openAtAge);

  return {
    unlocked,
    timerLabel: unlocked
      ? `Unlocked - ${child.name} can open their bottles now`
      : `Opens at age ${child.openAtAge} · ${formatDate(openDate)}`,
  };
}
