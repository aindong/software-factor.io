// How long a lane has worked, as text that ticks. It is not an animation (those live in
// working.css): it is a number that changes. With reduced motion it changes every 15 seconds, not every one.
import { useEffect, useState } from "react";
import { span } from "./words.ts";

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), still() ? 15_000 : 1000);
    return () => clearInterval(tick);
  }, []);
  return <>{span(now - Date.parse(since))}</>;
}
