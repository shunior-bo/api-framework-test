/**
 * Errors raised by the coverage tool.
 *
 * `InputError` means the user must fix an input (missing spec, no records,
 * invalid JSON, unknown flag). The CLI maps it to exit code 2 and prints the
 * actionable message.
 */
export class InputError extends Error {
  /**
   * @param message - Actionable description of what to fix.
   */
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}
