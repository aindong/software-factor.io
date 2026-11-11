// What a tab in the background shows: its title and its icon. Both say when something waits for
// a person, so the page need not be looked at to know. The icon cannot read the palette, so the
// rail's navy and the signal yellow are written here as plain colours.
const NAVY = "%23232b45";
const mark = (waits: boolean) =>
  `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='${NAVY}'/><path d='M6 21h8l5-10h7' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/><circle cx='9' cy='21' r='3.5' fill='white'/><circle cx='22' cy='11' r='3.5' fill='white'/>${
    waits
      ? `<rect x='18' y='18' width='12' height='12' rx='2' fill='%23f2c400' stroke='${NAVY}' stroke-width='2'/>`
      : ""
  }</svg>`;

/** The tab's title: how many runs wait for a person, how many work, then the section. */
export const titleOf = (section: string, waits: number, working = 0) =>
  `${waits > 0 ? `(${waits}) ` : ""}${working > 0 ? `(${working} working) ` : ""}${section} · Software Factor.io`;

/** The tab's title and icon for a section, with how many runs wait for a person and how many work. */
export function showInTab(section: string, waits: number, working = 0): void {
  document.title = titleOf(section, waits, working);
  document.querySelector<HTMLLinkElement>("link[rel=icon]")?.setAttribute("href", mark(waits > 0));
}
