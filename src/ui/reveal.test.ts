import { afterEach, describe, expect, it, vi } from "vitest";
import { reveal } from "./reveal.ts";

afterEach(() => vi.unstubAllGlobals());
const scene = (reduced: boolean) => {
  const scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => run());
  reveal(() => ({ scrollIntoView }) as unknown as Element);
  return scrollIntoView;
};

describe("bringing opened content into view", () => {
  it("glides, and only to the nearest edge", () => {
    expect(scene(false)).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  });
  it("does not glide for a person who asked for less motion", () => {
    expect(scene(true)).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });
  it("does nothing when there is nothing to show", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => run());
    expect(() => reveal(() => null)).not.toThrow();
  });
});
