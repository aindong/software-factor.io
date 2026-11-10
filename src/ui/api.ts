// The interface's calls to its own server. Every call carries the token the served page holds.
import type { Problem } from "../core/schema/parse.ts";

const token = document.querySelector<HTMLMetaElement>('meta[name="factor-token"]')?.content ?? "";

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
