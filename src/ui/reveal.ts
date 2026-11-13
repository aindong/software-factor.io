// Content that a person opens near the bottom of a page is brought into view, and not with a glide
// for a person who asked their system for less motion. The node is looked up after the next paint:
// what was just opened is not on the page until then.
export function reveal(node: () => Element | null | undefined) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() =>
    node()?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" }),
  );
}
