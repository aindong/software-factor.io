// The five fields of a schedule (minute, hour, day of the month, month, weekday), read the way
// cron reads them: a number, a range, a list, a step, or * for any. Names of months and days are
// not taken. No dependency: the whole of it is a set of numbers for each field.
const FIELDS = [
  ["minute", 0, 59],
  ["hour", 0, 23],
  ["day of the month", 1, 31],
  ["month", 1, 12],
  ["weekday", 0, 7], // 0 and 7 are both Sunday
] as const;
const LOOK_BACK_DAYS = 31;

interface Cron {
  sets: Set<number>[];
  /** Whether the field was written as any: cron joins the two day fields with "or" only when both are given. */
  any: boolean[];
}

function read(cron: string): Cron | string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== FIELDS.length)
    return "A schedule has five fields: minute, hour, day of the month, month, weekday.";
  const sets: Set<number>[] = [];
  for (const [i, [name, min, max]] of FIELDS.entries()) {
    const set = new Set<number>();
    for (const piece of (parts[i] ?? "").split(",")) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(piece);
      const [from, to] = m?.[1] === "*" ? [min, max] : (m?.[1] ?? "").split("-").map(Number);
      const step = m?.[2] === undefined ? 1 : Number(m[2]);
      const last = to ?? (m?.[2] === undefined ? from : max); // "5/15" runs from 5 to the end
      if (
        !m ||
        from === undefined ||
        last === undefined ||
        from < min ||
        last > max ||
        from > last ||
        step < 1
      )
        return `The ${name} "${piece}" cannot be read: it is a number from ${min} to ${max}, a range, a list, a step, or *.`;
      for (let n = from; n <= last; n += step) set.add(name === "weekday" ? n % 7 : n);
    }
    sets.push(set);
  }
  return { sets, any: parts.map((p) => p.startsWith("*")) };
}

/** What is wrong with a schedule, or nothing. */
export const cronProblem = (cron: string): string | undefined => {
  const result = read(cron);
  return typeof result === "string" ? result : undefined;
};

/** The latest minute at or before now when the schedule was due, in local time. Nothing if that is over a month ago. */
export function lastDue(cron: string, now: Date): Date | undefined {
  const c = read(cron);
  if (typeof c === "string") return undefined;
  const [minute, hour, day, month, weekday] = c.sets as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let back = 0; back <= LOOK_BACK_DAYS * 24 * 60; back += 1) {
    const t = new Date(start - back * 60_000);
    if (!minute.has(t.getMinutes()) || !hour.has(t.getHours()) || !month.has(t.getMonth() + 1)) continue;
    const onDay = day.has(t.getDate());
    const onWeekday = weekday.has(t.getDay());
    if (c.any[2] || c.any[4] ? onDay && onWeekday : onDay || onWeekday) return t;
  }
  return undefined;
}
