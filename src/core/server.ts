// The local web server behind `softwarefactor ui`: the built interface as static files, and a
// small JSON API over the same core operations the command line uses (ADR 0008). It listens on
// this machine only. A page on some other site can still make a browser send requests here, and
// so can any process on this machine. So every API call must name this host and carry a token,
// and the token is given once, in the address the command prints in the developer's own
// terminal, after the "#", where a browser never sends it. The page itself holds no token:
// asking the server for the page gives nothing that opens the API.
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { openDb } from "./db.ts";
import { UserError } from "./errors.ts";
import { parseWorkflow } from "./schema/parse.ts";
import { runRoutes } from "./server-runs.ts";

const MAX_BODY = 2_000_000;
const NAME = /^[a-z][a-z0-9-]*$/;
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
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

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
  close: () => void;
}

export function startServer(root: string, config: { workflow: string }, port: number): Promise<Served> {
  const ui = uiDir();
  const token = randomBytes(24).toString("hex");
  const workflows = join(root, ".factor", "workflows");
  /**
   * A workflow's file, when the name is a name and the file is a plain file in this repository's
   * own workflows folder. A link there, or a folder that is a link, leads somewhere else: it is
   * neither read nor written through.
   */
  const fileOf = (name: string): string | undefined => {
    if (!NAME.test(name)) return undefined;
    const file = join(workflows, `${name}.json`);
    try {
      if (realpathSync(workflows) !== join(realpathSync(root), ".factor", "workflows")) return undefined;
      return lstatSync(file).isFile() ? file : undefined;
    } catch {
      return undefined; // not there
    }
  };
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

  app.get("/api/workspace", (c) => {
    const names = existsSync(workflows)
      ? readdirSync(workflows)
          .filter((f) => f.endsWith(".json") && fileOf(f.slice(0, -5)))
          .map((f) => f.slice(0, -5))
          .sort()
      : [];
    return c.json({ name: basename(root), root, workflow: config.workflow, workflows: names });
  });

  app.get("/api/workflows/:name", (c) => {
    const file = fileOf(c.req.param("name"));
    if (!file) return c.json({ error: "There is no such workflow." }, 404);
    let workflow: unknown;
    try {
      workflow = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      const problem = {
        path: "(file)",
        message: `The file is not JSON: ${(error as Error).message}`,
        fix: "Fix it in an editor.",
      };
      return c.json({ workflow: null, problems: [problem] });
    }
    return c.json({ workflow, problems: parseWorkflow(workflow).problems });
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
    const file = fileOf(name);
    if (!file) return c.json({ error: "There is no such workflow." }, 404);
    const workflow = await sent(c.req);
    if (!workflow) return c.json({ problems: notOne }, 422);
    // nothing is written unless the same checker the command line uses finds nothing wrong
    const problems = parseWorkflow(workflow).problems;
    if (workflow.name !== name) {
      problems.push({
        path: "name",
        message: `The workflow's name is "${String(workflow.name)}", but its file is ${name}.json.`,
        fix: `Set "name" to "${name}".`,
      });
    }
    if (problems.length > 0) return c.json({ problems }, 422);
    // written beside and moved into place: never through a link, and never left half written
    const beside = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(beside, `${JSON.stringify(workflow, null, 2)}\n`, { flag: "wx" });
      renameSync(beside, file);
    } catch (error) {
      rmSync(beside, { force: true }); // or the next save would find it in its way
      return c.json({ error: `The workflow could not be written: ${(error as Error).message}` }, 500);
    }
    return c.json({ workflow, problems: [] });
  });
  const db = openDb(join(root, ".factor", "state.db"));
  let closed = false;
  runRoutes(app, db, root, () => closed);
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
      resolve({ url, address: `${url}/#t=${token}`, close });
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
