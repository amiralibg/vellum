/** A failure to report as one line and exit with `code`: 1 for failures, 2 for wrong usage. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2 = 1,
  ) {
    super(message);
  }
}
