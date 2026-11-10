# Panels

A panel runs several agents on the same lane at once, each starting from the lane's `agent` settings and
overriding `role`, `prompt`, `tier` or `effort`. `join` is `all` or `any`. A member with `"advisory": true` is
reported but never decides the outcome. A member with `when` only joins when the condition holds, which is how a
review is sized to the change.

How a panel runs:

- Every member that joins is started at the same time, as a lane in small named `<lane>.<member>`: its own
  prompt (the lane's instructions, then "Your part in this review"), its own folder, its own factor server, its
  own session and its own hand-off, which the host checks like any other. The run says who reviewed and who was
  left out.
- Members only read. They share the run's worktree, and whatever one of them changed is dropped and fails the
  lane.
- A member's hand-off is taken and checked the moment that member ends, so a member that is still running
  cannot rewrite it.
- The verdict: with `all`, one deciding member that fails makes the lane fail; otherwise a member that asks a
  person makes the run wait with its question; otherwise the lane passes. With `any`, one deciding member that
  passes is enough; otherwise a question waits; otherwise the lane fails. A member that crashed, left no
  hand-off or left one the host rejects has failed. There is no retry and no repair round for a member.
- The lane's note and the hand-off to the next lane list each member's verdict, such as
  `logic: pass. The logic holds.` An advising member is marked `(advises)`.
- Outputs that are lists are joined in the order of the members, from every member whose hand-off the host
  accepted, advising ones too. Any other output is the first member's that gave it. Each member must give the
  outputs the lane requires, and the joined value is checked like any output.
- The lane's gates run once, after the panel, as for any lane.
- The lane's time limit is every member's. When it is up, all are stopped, and what they used is still
  counted. An account that is held holds the whole panel before it starts, but only when a member that takes
  part this time is on it. A member whose account hits its limit in the middle holds the run: the panel fails
  this try and starts again, whole, after the hold.
- When a person answers a member's question, the whole panel starts again and every member is given the
  answer.
- A panel that is entered again, after a round back to the build, is sized again to the change as it is then.

A role can say `"differentVendorFrom": ["author"]`. When both roles are bound to the same vendor, the lane
still runs, and the run says so in its log and under "Still open" in the run's hand-off. The factory does not
pick another account by itself: bind the role to an account of another vendor with `softwarefactor role bind`.
