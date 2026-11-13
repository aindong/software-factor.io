// The box the floor's map scrolls in. When part of the map is out of sight to the right, a fade at the
// edge and a line in words say how many stations are there, so that a cut is not taken for the end.
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";

export function MapScroll({
  children,
  boxRef,
}: {
  children: ReactNode;
  boxRef?: RefObject<HTMLDivElement | null>;
}) {
  // a page that moves the box itself (a run's page puts the lane that failed in view) gives its own ref
  const own = useRef<HTMLDivElement>(null);
  const box = boxRef ?? own;
  const [more, setMore] = useState(0);
  useLayoutEffect(() => {
    const look = () => {
      const edge = box.current?.getBoundingClientRect().right ?? 0;
      const out = [...(box.current?.querySelectorAll(".station .body") ?? [])].filter(
        (s) => s.getBoundingClientRect().right > edge + 0.5,
      ).length;
      setMore(out);
    };
    look();
    addEventListener("resize", look);
    box.current?.addEventListener("scroll", look, { passive: true });
    const node = box.current;
    return () => {
      removeEventListener("resize", look);
      node?.removeEventListener("scroll", look);
    };
  });
  return (
    <>
      <div className="map-scroll" ref={box} data-more={more > 0}>
        {children}
      </div>
      {more > 0 ? (
        <p className="map-more">
          {more} more {more === 1 ? "station" : "stations"} to the right
        </p>
      ) : null}
    </>
  );
}
