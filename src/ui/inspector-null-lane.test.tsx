// From the second review of task 14: JSON that is valid but odd must not take the page down.
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Inspector } from "./Inspector.tsx";

const nothing = () => {};
const draw = (doc: Record<string, unknown>, selected?: string) =>
  renderToStaticMarkup(
    <Inspector
      doc={doc}
      selected={selected}
      problems={[]}
      open={false}
      headRef={createRef<HTMLHeadingElement>()}
      connectRef={createRef<HTMLSelectElement>()}
      onChange={nothing}
      onSelect={nothing}
      onClose={nothing}
    />,
  );

it("draws the inspector for JSON whose lanes hold a null", () => {
  expect(() => draw({ lanes: [null, { id: "a", on: {} }] })).not.toThrow();
  expect(draw({ lanes: [null, { id: "a", on: {} }] }, "a")).toContain("Lane a");
});
