// core/schedule@1: one task each time the schedule comes round. The factory has no clock of its
// own running: a time that came while nothing ran is collected once, at the next collect.
import { nowMs } from "../clock.ts";
import { lastDue } from "./cron.ts";
import type { Collected } from "./index.ts";

const two = (n: number) => String(n).padStart(2, "0");

export function collectSchedule(
  _: unknown,
  settings: { cron: string; title: string; body: string },
): Collected {
  const due = lastDue(settings.cron, new Date(nowMs()));
  if (!due) return { tasks: [] };
  // the time it was due is the key: collecting again before the next time adds nothing
  const key = `${due.getFullYear()}-${two(due.getMonth() + 1)}-${two(due.getDate())}T${two(due.getHours())}:${two(due.getMinutes())}`;
  return { tasks: [{ key, title: settings.title, body: settings.body }] };
}
