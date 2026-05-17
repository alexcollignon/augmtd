const SAFE_PREFIXES = ['Unauthorized', 'Not found', 'Forbidden', 'Bad request', 'Invalid input'];

// Returns a client-safe error string. DB/internal error details stay server-side.
export function sanitizeError(err: unknown): string {
  if (err instanceof Error && SAFE_PREFIXES.some(p => err.message.startsWith(p))) {
    return err.message;
  }
  return 'An internal error occurred';
}
