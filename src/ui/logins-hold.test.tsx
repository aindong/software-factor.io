// A login's hold is said with its day when it ends on another day than today: a time of day alone
// would read as this evening for a hold that ends in three days.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccountsView } from "../core/views.ts";
import { Logins } from "./Logins.tsx";

const held = (at: number): AccountsView["accounts"] => [
  {
    name: "work",
    agent: "claude",
    limits: [],
    headroom: 0.9,
    heldUntil: new Date(at).toISOString(),
    reading: null,
    models: [],
  },
];
const said = (at: number) =>
  renderToStaticMarkup(<Logins accounts={held(at)} />)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("a login on hold", () => {
  it("names the day when the hold ends on another day", () => {
    const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    expect(said(Date.now() + 3 * 86_400_000)).toContain(day);
  });
  it("names no day when it ends today", () => {
    const soon = new Date();
    soon.setHours(23, 59, 0, 0);
    if (soon.getTime() - Date.now() < 60_000) return; // too near midnight to tell
    expect(said(soon.getTime())).not.toMatch(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
  });
});
