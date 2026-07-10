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
  | { type: "done"; id: string }
  | { type: "error"; message: string };

export type Progress = (message: string) => void;

export function streamJob(run: (progress: Progress) => Promise<string>): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: JobEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        const id = await run((message) => send({ type: "status", message }));
        send({ type: "done", id });
      } catch (error) {
        send({ type: "error", message: userFacingMessage(error) });
      } finally {
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

function userFacingMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  console.error("Import job failed", error);
  return "Something went wrong on our end.";
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
      else outcome = event;
    }
  }

  if (!outcome) throw new Error("The import ended without a result.");
  if (outcome.type === "error") throw new Error(outcome.message);
  return outcome.id;
}
