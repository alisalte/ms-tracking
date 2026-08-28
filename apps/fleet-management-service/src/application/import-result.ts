/**
 * Partial-success shape for spreadsheet import (vehicles / devices).
 * `row` is the 1-based Excel row the UI sent (header = 1).
 */
export interface ImportFailure {
  readonly row: number;
  readonly error: string;
}

export interface ImportResult<T> {
  readonly created: T[];
  readonly failed: ImportFailure[];
  readonly warnings: ImportFailure[];
}
