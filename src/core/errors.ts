/** A problem the person can fix. The command line prints the message and the fix, with no stack trace. */
export class UserError extends Error {
  fix: string;
  constructor(message: string, fix: string) {
    super(message);
    this.name = "UserError";
    this.fix = fix;
  }
}
