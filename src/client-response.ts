const STREAMING_CONTENT_TYPES = new Set([
  'text/event-stream',
  'application/x-ndjson',
  'application/ndjson',
]);

/**
 * Parses ordinary client responses as JSON while preserving streaming bodies.
 */
export async function parseClientResponse(response: Response, raw = false): Promise<unknown> {
  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();

  if (raw || (contentType && STREAMING_CONTENT_TYPES.has(contentType))) {
    return response;
  }

  return response.json();
}
