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
/** False when the page was opened without the session's key: the API will refuse it. */
export const hasKey = token !== "";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
  const answer = await fetch(path, {
    method,
    headers: { "x-factor-token": token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: answer.status, body: (await answer.json()) as T };
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
}

export const getWorkspace = () => call<WorkspaceInfo>("/api/workspace");
export const getWorkflow = (name: string) => call<Loaded>(`/api/workflows/${encodeURIComponent(name)}`);
export const saveWorkflow = (name: string, workflow: Json) =>
  call<Loaded>(`/api/workflows/${encodeURIComponent(name)}`, "PUT", { workflow });
