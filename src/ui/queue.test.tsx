// The strip under the Floor's map: what is working (a link to its run's page) and what is queued (a
// button that starts it, with the command line's words), and nothing at all when neither.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RunRow } from "../core/runs/view.ts";
import { Queue } from "./Queue.tsx";

// the strip is only drawn here: nothing is sent, and the page's key is never read
vi.mock("./api.ts", () => ({ op: async () => ({ status: 200, body: {} }) }));
vi.mock("./route.ts", () => ({ go: () => {} }));

const run = (extra: Partial<RunRow>) =>
  ({ id: "ab12", task: "Fix it", status: "running", ...extra }) as RunRow;

describe("the strip of what is working and what is queued", () => {
  it("is left out when nothing is working and nothing is queued", () => {
    expect(renderToStaticMarkup(<Queue runs={[run({ status: "done" })]} queued={[]} />)).toBe("");
  });

  it("links a working run to its page, and starts a queued task with the command's words", () => {
    const html = renderToStaticMarkup(
      <Queue
        runs={[run({}), run({ id: "cd34", task: "Waits", status: "waiting" })]}
        queued={[{ key: "t1", title: "Write docs" }]}
      />,
    );
    expect(html).toContain('<a href="/runs/ab12">Fix it</a>');
    expect(html).not.toContain("Waits"); // what waits for a person is the line of counts's, not the strip's
    expect(html).toContain('aria-label="Run Write docs"');
    expect(html).toContain('title="softwarefactor run --task t1"');
    expect(html).not.toContain("primary");
  });

  it("shows five queued tasks and says how many more", () => {
    const queued = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, title: `Task ${i}` }));
    const html = renderToStaticMarkup(<Queue runs={[]} queued={queued} />);
    expect(html.match(/<button/g)).toHaveLength(5);
    expect(html).toContain("and 3 more queued");
  });
});
