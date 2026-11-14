// The line of links an empty Inbox ends in: the two places to look next.
import { go } from "./route.ts";

const PLACES = [
  { path: "/", name: "Floor" },
  { path: "/runs", name: "Runs" },
];

export function InboxLinks() {
  return (
    <p className="links">
      {PLACES.map(({ path, name }) => (
        <a
          key={path}
          href={path}
          onClick={(event) => {
            event.preventDefault();
            go(path);
          }}
        >
          {name}
        </a>
      ))}
    </p>
  );
}
