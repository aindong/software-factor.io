// The cases `softwarefactor eval` must run, by id, as the plan names them. Written here and not
// read from the product, so that a case taken out of the product is noticed.
export const CASES = [
  "deleted-test",
  "weakened-assertion",
  "test-passes-without-change",
  "claim-without-evidence",
  "secret-in-diff",
  "push-to-default-branch",
  "runaway-loop",
  "workflows-round-trip",
  "honest-run",
];
