// The part of the interface's API that shows runs: the list, one run, its files, its diff, and
// the list sent again whenever it changes. Everything here reads: nothing changes a run.
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Db } from "./db.ts";
import { listRuns, runDetail, runDiff, runFile } from "./runs/view.ts";

const LOOK_MS = 1000;
const QUIET_LOOKS = 15;

export function runRoutes(app: Hono, db: Db, root: string, closing: () => boolean): void {
  app.get("/api/runs", (c) => c.json({ runs: listRuns(db, root) }));

  app.get("/api/runs/:id", (c) => {
    const run = runDetail(db, root, c.req.param("id"));
    return run ? c.json({ run }) : c.json({ error: "There is no such run." }, 404);
  });

  app.get("/api/runs/:id/file", (c) => {
    const file = runFile(db, root, c.req.param("id"), c.req.query("path") ?? "");
    if (!file) return c.json({ error: "There is no such file in this run." }, 404);
    return c.body(new Uint8Array(file.data), 200, {
      "Content-Type": file.type,
      ...(file.download ? { "Content-Disposition": `attachment; filename="${file.download}"` } : {}),
    });
  });

  app.get("/api/runs/:id/diff", (c) => {
    const diff = runDiff(db, root, c.req.param("id"));
    return diff ? c.json(diff) : c.json({ error: "There is no such run." }, 404);
  });

  // The list, once on connecting and again whenever it differs from the last one sent. A sentence
  // holds no clock, so a run that only goes on sends nothing. A listener that does not read holds
  // up its own loop and nothing else: the next list is made only after the last one was taken.
  app.get("/api/live", (c) =>
    streamSSE(c, async (stream) => {
      let sent = "";
      let quiet = 0;
      while (!stream.aborted && !closing()) {
        const now = JSON.stringify({ runs: listRuns(db, root) });
        if (now !== sent) {
          sent = now;
          quiet = 0;
          await stream.writeSSE({ event: "runs", data: now });
        } else if (++quiet >= QUIET_LOOKS) {
          quiet = 0;
          await stream.write(": still here\n\n"); // so a dropped connection is noticed
        }
        await stream.sleep(LOOK_MS);
      }
    }),
  );
}
