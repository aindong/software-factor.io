// JSON that is valid but odd must not take the page down: a step that leads to something that is no text.
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

it("lists the ways of an outcome whose step leads to an object", () => {
  const doc = {
    lanes: [
      {
        id: "a",
        on: {
          pass: [{ to: { lane: "b" }, when: { ref: "change.tier", in: ["ui"] } }, { to: "@done" }],
          fail: "@stop",
        },
      },
    ],
  };
  expect(draw(doc, "a")).toContain("Lane a");
});
