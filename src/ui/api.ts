// The interface's calls to its own server. Every call carries the token the served page holds.
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
const token = readToken();
/** Drop a key the server no longer takes (it was started again): the page then says how to get one. */
export function forgetKey(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing was kept
  }
  location.reload();
}
// the printed address opened in a tab that is already on this page changes only what is after
// the "#", which loads nothing: load the page again, so that the key is read
addEventListener("hashchange", () => /^#t=[0-9a-f]+$/.test(location.hash) && location.reload());
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
  /** Why the server refused, when it did. */
  error?: string;
}

export const getWorkspace = () => call<WorkspaceInfo>("/api/workspace");
export const getWorkflow = (name: string) => call<Loaded>(`/api/workflows/${encodeURIComponent(name)}`);
export const saveWorkflow = (name: string, workflow: Json) =>
  call<Loaded>(`/api/workflows/${encodeURIComponent(name)}`, "PUT", { workflow });
