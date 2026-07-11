/**
 * A newline-delimited JSON response for work that takes longer than a request
 * is normally allowed to take.
 *
 * Cloudflare closes a proxied request that has produced no bytes within its
 * idle window, and a photo extraction can easily run past it. Streaming
 * sidesteps that: the status line goes out immediately, the connection stays
 * warm, and the outcome arrives on the last line.
 *
 * The cost is that the HTTP status is committed to 200 before we know whether
 * the job succeeds. Callers must read `type` on the final line rather than
 * trusting `response.ok`.
 */

export type JobEvent =
  | { type: "status"; message: string }
  | { type: "ping" }
  | { type: "done"; id: string }
  | { type: "error"; message: string };

export type Progress = (message: string) => void;

/**
 * The longest a single step may run silently. Extraction is one ~40s API call
 * that emits nothing while it waits, and a proxy in the path will drop a stream
 * that produces no bytes for long enough. A heartbeat under that window keeps
 * the connection warm through the quiet stretches.
 */
const HEARTBEAT_MS = 5_000;

export function streamJob(run: (progress: Progress) => Promise<string>): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: JobEvent) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const heartbeat = setInterval(() => send({ type: "ping" }), HEARTBEAT_MS);

      try {
        const id = await run((message) => send({ type: "status", message }));
        send({ type: "done", id });
      } catch (error) {
        send({ type: "error", message: userFacingMessage(error) });
      } finally {
        clearInterval(heartbeat);
        open = false;
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Defeat any proxy that would otherwise buffer the whole body.
      "x-accel-buffering": "no",
    },
  });
}

/** Errors we raised deliberately carry a message worth showing; nothing else does. */
export class UserFacingError extends Error {}

/**
 * Anything not explicitly marked safe is replaced, because a mid-stream failure
 * cannot carry an HTTP status and the message goes straight to the browser —
 * an unfiltered one could be a Postgres connection string.
 *
 * The tradeoff is that the user is handed a shrug. So both halves get the same
 * short id: the reader can quote it, and it greps straight to the stack trace
 * in `wrangler tail`.
 */
function userFacingMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;

  const id = crypto.randomUUID().slice(0, 8);
  console.error(`Import job failed [${id}]`, error);
  return `Something went wrong on our end. Reference ${id}.`;
}

/** Reads a streamJob response on the client, calling `onStatus` as work progresses. */
export async function readJobStream(
  response: Response,
  onStatus: (message: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("The server sent an empty response.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  // Only a terminal event lands here; status lines are consumed as they arrive.
  let outcome: Extract<JobEvent, { type: "done" | "error" }> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // The final chunk may not end in a newline, so hold the tail back.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as JobEvent;
      if (event.type === "status") onStatus(event.message);
      // Heartbeats (and any unknown event) are ignored; only a terminal event
      // resolves the job.
      else if (event.type === "done" || event.type === "error") outcome = event;
    }
  }

  if (!outcome) throw new Error("The import ended without a result.");
  if (outcome.type === "error") throw new Error(outcome.message);
  return outcome.id;
}
