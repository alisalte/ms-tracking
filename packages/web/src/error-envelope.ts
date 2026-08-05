/**
 * JSON:API error envelope — the canonical wire shape every FleetVision error
 * response conforms to (API_Design.md §8.1). A single top-level `errors[]`
 * array keeps clients parsing one shape; the `code` field maps to the canonical
 * error catalog (shared-kernel `codes.ts`).
 */

/** One JSON:API error object. */
export interface JsonApiError {
  /** Canonical FleetVision error code (catalog in shared-kernel `codes.ts`). */
  code: string;
  /** HTTP status for this error (JSON:API permits a per-error status). */
  status: string;
  /** Short, stable, human-readable summary (never PII, never secrets). */
  title: string;
  /** Optional detail; safe to surface to the client. */
  detail?: string;
  /** Optional field/attribute path that triggered the error. */
  source?: { pointer?: string; parameter?: string };
  /** Optional request id, echoed for client support correlation. */
  meta?: Record<string, unknown>;
}

/** The top-level error document. */
export interface JsonApiErrorDocument {
  errors: JsonApiError[];
}

/** Build a single-error document. */
export function errorDocument(error: JsonApiError): JsonApiErrorDocument {
  return { errors: [error] };
}
