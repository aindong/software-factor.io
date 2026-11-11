// The interface's calls to its own server. Every call carries the token the served page holds.
import type { RunDetail, RunRow } from "../core/runs/view.ts";
import type { Problem } from "../core/schema/parse.ts";

// The session's key comes in the address the command printed, after the "#", where the browser
// never sends it. It is kept for this tab, and taken out of the address bar and the history.
const KEY = "factor-token";
function readToken(): string {
  const given = /^#t=([0-9a-f]+)$/.exec(location.hash)?.[1];
  try {
    if (given) {
      sessionStorage.setItem(KEY, given);
      history.replaceState(null, "", location.pathname);
    }
    return given ?? sessionStorage.getItem(KEY) ?? "";
  } catch {
    return given ?? ""; // storage is blocked: the key lasts until the page is reloaded
  }
}
let token = readToken();
// the key was refused and the page was kept, because it holds work a reload would lose
let refused = false;
/** Drop a key the server no longer takes (it was started again): the page then says how to get one. */
export function forgetKey(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing was kept
  }
  // also out of the address: a key left there would be read again, refused again, and so on
  if (location.hash) history.replaceState(null, "", location.pathname);
  // Whoever holds unsaved work answers the browser's own question before leaving: asked here, no
  // dialog is shown. A page that holds work is kept, and takes the new key in place when it comes.
  refused = !dispatchEvent(new Event("beforeunload", { cancelable: true }));
  if (!refused) location.reload();
}
// the printed address opened in a tab that is already on this page changes only what is after
// the "#", which loads nothing: load the page again, so that the key is read
addEventListener("hashchange", () => {
  const given = /^#t=([0-9a-f]+)$/.exec(location.hash)?.[1];
  if (!given) return;
  if (!refused) return location.reload();
  // the page was kept for its unsaved work: the new key is taken without loading it again
  token = given;
  refused = false;
  try {
    sessionStorage.setItem(KEY, given);
  } catch {
    // storage is blocked: the key lasts until the page is reloaded
  }
  history.replaceState(null, "", location.pathname);
  dispatchEvent(new Event("factor:key"));
});
/** False when the page was opened without the session's key: the API will refuse it. */
export const hasKey = token !== "";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
  try {
    const answer = await fetch(path, {
      method,
      headers: { "x-factor-token": token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: answer.status, body: (await answer.json()) as T };
  } catch {
    // no answer, or one that is not JSON: status 0, and the reason where every answer has it
    const error = "the server did not answer. Is `softwarefactor ui` still running?";
    return { status: 0, body: { error } as T };
  }
}

export type Json = Record<string, unknown>;
export interface WorkspaceInfo {
  name: string;
  root: string;
  workflow: string;
  workflows: string[];
}
export interface Loaded {
  workflow: Json | null;
  problems: Problem[];
  /** Why the server refused, when it did, and what to do. */
  error?: string;
  fix?: string;
  /** The version of the file that was read, or that the file has now. A save names the one it began from. */
  version?: string;
}

export const getWorkspace = () => call<WorkspaceInfo>("/api/workspace");
export const getWorkflow = (name: string) => call<Loaded>(`/api/workflows/${encodeURIComponent(name)}`);
export const saveWorkflow = (name: string, workflow: Json, base?: string) =>
  call<Loaded>(`/api/workflows/${encodeURIComponent(name)}`, "PUT", { workflow, base });

/** One operation of the factory, by its name: the same table the command line and the MCP server serve. */
export const op = <T>(name: string, input: unknown = {}) =>
  call<T & { error?: string; fix?: string }>(`/api/op/${name}`, "POST", input);

// ---- runs

export type { RunDetail, RunRow };

const runPath = (id: string) => `/api/runs/${encodeURIComponent(id)}`;
export const getRun = (id: string) => call<{ run?: RunDetail; error?: string }>(runPath(id));
export const getDiff = (id: string) =>
  call<{ diff?: string; cut?: boolean; changed?: string[]; note?: string; error?: string }>(
    `${runPath(id)}/diff`,
  );
/** A file of a run, by the path the record gives. Nothing when the server has no such file. */
export async function getFile(id: string, path: string): Promise<Blob | "too large" | undefined> {
  try {
    const answer = await fetch(`${runPath(id)}/file?path=${encodeURIComponent(path)}`, {
      headers: { "x-factor-token": token },
    });
    if (answer.status === 413) return "too large";
    return answer.ok ? await answer.blob() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Listen to the list of runs: the server sends it on connecting and whenever it changes. The
 * browser's own event source cannot carry the token, so the stream is read by hand. When the
 * connection drops it is made again. Returns what stops the listening.
 */
export function listen(onRuns: (runs: RunRow[]) => void, onState: (live: boolean) => void): () => void {
  const control = new AbortController();
  const stream = async () => {
    const answer = await fetch("/api/live", { headers: { "x-factor-token": token }, signal: control.signal });
    if (answer.status === 401) return forgetKey();
    const reader = answer.body?.getReader();
    if (!answer.ok || !reader) throw new Error("no stream");
    onState(true);
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
        const data = pending
          .slice(0, end)
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        pending = pending.slice(end + 2);
        if (data) onRuns((JSON.parse(data) as { runs: RunRow[] }).runs);
      }
    }
  };
  (async () => {
    while (!control.signal.aborted) {
      await stream().catch(() => {}); // the server went away, or the listening was stopped
      if (control.signal.aborted) return;
      onState(false);
      // with a refused key there is nothing to ask again until the new one is here
      if (refused) await new Promise((got) => addEventListener("factor:key", got, { once: true }));
      else await new Promise((again) => setTimeout(again, 2000));
    }
  })();
  return () => control.abort();
}
