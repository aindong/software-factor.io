// From the correctness review of task 16: the shell listens for runs on every page, also on
// the page that says the tab has no key. Without a key it must not listen at all.
import { afterEach, expect, it, vi } from "vitest";

const kept = vi.hoisted(() => ({ leave: undefined as (() => void) | undefined }));
// the hook without a renderer: subscribing is all that is looked at
vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: (tell: () => void) => () => void, get: () => unknown) => {
    kept.leave = subscribe(() => {});
    return get();
  },
}));
afterEach(() => {
  kept.leave?.();
  vi.unstubAllGlobals();
});

it("a page with no key does not listen for runs, so it is not loaded again for ever", async () => {
  const reload = vi.fn();
  const fetched = vi.fn(async () => ({ status: 401, ok: false, body: null, json: async () => ({}) }));
  vi.stubGlobal("location", { hash: "", pathname: "/", reload });
  vi.stubGlobal("history", { replaceState: () => {} });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("addEventListener", () => {});
  vi.stubGlobal("fetch", fetched);
  const { hasKey } = await import("./api.ts");
  const { useRuns } = await import("./live.ts");
  expect(hasKey).toBe(false);
  useRuns(); // the shell calls this on every page
  await new Promise((r) => setTimeout(r, 50));
  expect(reload.mock.calls.length, "the page with no key was told to load again").toBe(0);
  expect(fetched.mock.calls.length, "the page with no key asked the server").toBe(0);
});
