// How long a lane has worked, as text that ticks. It is not an animation (those live in
// working.css): it is a number that changes. With reduced motion it changes every 15 seconds, not every one.
import { useEffect, useState } from "react";
import { ago, span } from "./words.ts";

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), still() ? 15_000 : 1000);
    return () => clearInterval(tick);
  }, []);
  return <>{span(now - Date.parse(since))}</>;
}

/** When something happened, as "2 min ago", kept up to date: it changes every 15 seconds, which is as fine as minutes need. */
export function Ago({ at }: { at: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);
  return <>{ago(at, now)}</>;
}
