// The list of runs, kept up to date by the server for as long as a screen shows it.
import { useEffect, useState } from "react";
import { listen, type RunRow } from "./api.ts";

export function useRuns(): { runs: RunRow[] | undefined; live: boolean } {
  const [runs, setRuns] = useState<RunRow[]>();
  const [live, setLive] = useState(true);
  useEffect(() => listen(setRuns, setLive), []);
  return { runs, live };
}
