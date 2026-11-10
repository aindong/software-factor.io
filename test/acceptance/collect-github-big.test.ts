// From the security review of task 18: a few very long issues must not stop the whole collector.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { edit, standIn, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("collects issues whose JSON is larger than 1 MB, and says who opened each", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "" });
  edit(repo, (w) => {
    w.collectors = [{ id: "issues", uses: "core/github-issues@1", with: { label: "factory" } }];
  });
  const log = standIn(
    repo,
    "gh",
    `"${process.execPath}" -e 'const b="x".repeat(60000);console.log(JSON.stringify(Array.from({length:30},(_,i)=>({number:i+1,title:"T"+i,body:b,labels:[],author:{login:"someone"},url:"https://github.com/acme/shop/issues/"+(i+1)}))))'`,
  );
  const r = repo.sf("collect");
  expect(r.stdout).not.toMatch(/could not collect/);
  expect(tasks(repo)).toHaveLength(30);
  // the person at the checkpoint sees where the text came from and who wrote it
  expect(tasks(repo)[0]?.body.split("\n")[0]).toBe(
    "GitHub issue #1, opened by someone: https://github.com/acme/shop/issues/1",
  );
  expect(readFileSync(log, "utf8")).toContain("[number,title,body,labels,author,url]");
});
