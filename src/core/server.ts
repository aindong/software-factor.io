// The local web server behind `softwarefactor ui`: the built interface as static files, and a
// small JSON API over the same core operations the command line uses (ADR 0008). It listens on
// this machine only. A page on some other site can still make a browser send requests here, and
// so can any process on this machine. So every API call must name this host and carry a token,
// and the token is given once, in the address the command prints in the developer's own
// terminal, after the "#", where a browser never sends it. The page itself holds no token:
// asking the server for the page gives nothing that opens the API.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { openDb } from "./db.ts";
import { UserError } from "./errors.ts";
import {
  inputProblem,
  OPERATIONS,
  readWorkflow,
  saveWorkflow,
  workflowFile,
  workspaceInfo,
} from "./operations.ts";
import { parseWorkflow } from "./schema/parse.ts";
import { runRoutes } from "./server-runs.ts";

/**
 * Which operation each route of the API belongs to (ADR 0008). A route with a place of its own
 * is a convenience for the page, such as a file sent as bytes: it does nothing an operation does
 * not. A test fails when the server has a route that is not here.
 */
export const ROUTE_OPS: Record<string, string> = {
  "GET /api/workspace": "workspace",
  "GET /api/workflows/:name": "workflow_get",
  "PUT /api/workflows/:name": "workflow_save",
  "POST /api/check": "workflow_check",
  "GET /api/runs": "runs_list",
  "GET /api/runs/:id": "runs_get",
  "GET /api/runs/:id/file": "runs_file",
  "GET /api/runs/:id/diff": "runs_diff",
  "GET /api/live": "runs_list",
  "POST /api/op/:name": "*",
};

const MAX_BODY = 2_000_000;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
// nothing is loaded from anywhere but this server: the tool works with no network
// and no other site may put the page in a frame, where it could steer clicks onto Save
const POLICY =
  "default-src 'self'; img-src 'self' data: blob:; media-src blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

/** Where the built interface is: beside the built command, or in dist/ when run from source. */
function uiDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // the built interface has its files in assets/: the source folder beside this file does not
  const found = [join(here, "..", "ui"), join(here, "..", "..", "dist", "ui")].find(
    (d) => existsSync(join(d, "index.html")) && existsSync(join(d, "assets")),
  );
  if (!found) {
    throw new UserError("The interface is not built.", "Run `pnpm run build` in the softwarefactor folder.");
  }
  return found;
}

export interface Served {
  url: string;
  /** The address to open: the url, and the token after the "#". */
  address: string;
  /** Every route the server answers, as "METHOD /path". */
  routes: string[];
  close: () => void;
}

export function startServer(root: string, config: { workflow: string }, port: number): Promise<Served> {
  const ui = uiDir();
  const token = randomBytes(24).toString("hex");
  let host = "";
  const app = new Hono();

  // a request that names another host comes from another site's page, whatever address it reached
  app.use("*", async (c, next) => {
    const named = c.req.header("host") ?? "";
    if (named !== host && named !== host.replace("127.0.0.1", "localhost")) return c.text("Forbidden", 403);
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("Content-Security-Policy", POLICY);
    c.header("Cache-Control", "no-store");
  });
  app.use("/api/*", async (c, next) => {
    const given = Buffer.from(c.req.header("x-factor-token") ?? "");
    const wanted = Buffer.from(token);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      return c.json({ error: "This request does not carry the page's token." }, 401);
    }
    await next();
  });
  app.use("/api/*", bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: "Too large." }, 413) }));

  app.get("/api/workspace", (c) => c.json({ ...workspaceInfo(root), workflow: config.workflow }));

  app.get("/api/workflows/:name", (c) => {
    if (!workflowFile(root, c.req.param("name"))) return c.json({ error: "There is no such workflow." }, 404);
    return c.json(readWorkflow(root, c.req.param("name")));
  });

  /** The workflow in a request's body, or nothing when the body is not an object that holds one. */
  const sent = async (request: {
    json: () => Promise<unknown>;
  }): Promise<Record<string, unknown> | undefined> => {
    const body = await request.json().catch(() => undefined);
    const workflow =
      typeof body === "object" && body !== null ? (body as { workflow?: unknown }).workflow : undefined;
    return typeof workflow === "object" && workflow !== null && !Array.isArray(workflow)
      ? (workflow as Record<string, unknown>)
      : undefined;
  };
  const notOne = [
    {
      path: "(top)",
      message: "This is not a workflow: it must be a JSON object.",
      fix: "Send the workflow as an object.",
    },
  ];

  app.post("/api/check", async (c) => {
    const workflow = await sent(c.req);
    return c.json({ problems: workflow ? parseWorkflow(workflow).problems : notOne });
  });

  app.put("/api/workflows/:name", async (c) => {
    const name = c.req.param("name");
    if (!workflowFile(root, name)) return c.json({ error: "There is no such workflow." }, 404);
    const workflow = await sent(c.req);
    if (!workflow) return c.json({ problems: notOne }, 422);
    try {
      // nothing is written unless the same checker the command line uses finds nothing wrong
      const { saved, problems } = saveWorkflow(root, name, workflow);
      return saved ? c.json({ workflow, problems: [] }) : c.json({ problems }, 422);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  const db = openDb(join(root, ".factor", "state.db"));
  let closed = false;
  runRoutes(app, db, root, () => closed);

  // Every operation of the factory, by its name: the same table the operator MCP server serves.
  // An input the operation's own schema refuses is 422, and what the factory refuses is 409, in
  // the words the command line would use.
  app.post("/api/op/:name", async (c) => {
    const operation = OPERATIONS.find((o) => o.name === c.req.param("name"));
    if (!operation) return c.json({ error: "There is no such operation." }, 404);
    const input = operation.input.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return c.json(inputProblem(input.error.issues), 422);
    try {
      return c.json((await operation.run({ root, db }, input.data as never)) ?? {});
    } catch (error) {
      if (error instanceof UserError) return c.json({ error: error.message, fix: error.fix }, 409);
      return c.json({ error: (error as Error).message }, 500);
    }
  });
  app.all("/api/*", (c) => c.json({ error: "There is no such operation." }, 404));

  // the interface: its files as they were built, and its one page for every other path
  const page = readFileSync(join(ui, "index.html"), "utf8");
  app.get("/assets/*", (c) => {
    let file = "";
    try {
      file = normalize(join(ui, decodeURIComponent(new URL(c.req.url).pathname)));
      if (!file.startsWith(`${join(ui, "assets")}${sep}`) || !statSync(file).isFile()) file = "";
    } catch {
      file = ""; // an address that does not decode, or a file that is not there
    }
    if (!file) return c.text("Not found", 404);
    return c.body(readFileSync(file), 200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    });
  });
  // any other path is a place inside the interface, which is one page. Not under assets/: a file
  // that is not there is not there.
  app.get("*", (c) =>
    new URL(c.req.url).pathname.startsWith("/assets/") ? c.text("Not found", 404) : c.html(page),
  );

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
      host = `127.0.0.1:${info.port}`;
      const url = `http://${host}`;
      const close = () => {
        closed = true;
        server.close();
        // a page that listens for changes holds its connection open for good
        (server as { closeAllConnections?: () => void }).closeAllConnections?.();
        db.close();
      };
      const routes = [
        ...new Set(
          app.routes
            // what is left out is asked of every route, or catches what no route took
            .filter((r) => !r.path.includes("*"))
            .map((r) => `${r.method} ${r.path}`),
        ),
      ];
      resolve({ url, address: `${url}/#t=${token}`, routes, close });
    });
    server.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "EADDRINUSE"
          ? new UserError(`Port ${port} is in use.`, "Close what uses it, or pick another with --port.")
          : error,
      ),
    );
  });
}
