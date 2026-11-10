// The lane type sample/say@1. It runs in the run's worktree. Exit 0 passes the lane.
const { say = "hello from the sample plugin" } = JSON.parse(process.env.FACTOR_WITH ?? "{}");
console.log(say);
