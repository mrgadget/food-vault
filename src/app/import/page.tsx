"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { readJobStream } from "@/lib/job-stream";

type Tab = "url" | "photos";
type Shot = { file: File; kind: "front" | "back" | "other"; preview: string };

export default function ImportPage() {
  const [tab, setTab] = useState<Tab>("url");

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Add a food</h1>

      <div className="mt-6 flex gap-1 rounded-full border border-line bg-surface p-1">
        <TabButton active={tab === "url"} onClick={() => setTab("url")}>
          From a link
        </TabButton>
        <TabButton active={tab === "photos"} onClick={() => setTab("photos")}>
          From photos
        </TabButton>
      </div>

      <div className="mt-8 rounded-card border border-line bg-surface p-6 shadow-sm">
        {tab === "url" ? <UrlImport /> : <PhotoImport />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        active ? "bg-ink text-paper shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

type Duplicate = { title: string; count: number };

function UrlImport() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const busy = status !== null;

  async function run(onExisting?: "replace" | "skip") {
    setStatus(onExisting === "replace" ? "Replacing…" : "Starting…");
    setError(null);
    setDuplicate(null);

    try {
      const response = await fetch("/api/import/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, onExisting }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "Something went wrong.");
      }

      // The import streams as x-ndjson; the duplicate and skip answers come back
      // as application/json. Match the stream's type exactly — "x-ndjson" also
      // contains "json", so a substring test would misread the stream.
      if ((response.headers.get("content-type") ?? "").includes("application/json")) {
        const result = await response.json();
        if (result.duplicate) {
          setDuplicate(result.duplicate);
          setStatus(null);
          return;
        }
        if (result.skipped) {
          router.push(`/foods/${result.id}`); // show the copy they already had
          return;
        }
      }

      const id = await readJobStream(response, setStatus);
      router.push(`/foods/${id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
      setStatus(null);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run();
      }}
    >
      <label htmlFor="url" className="block text-sm font-medium">
        Food URL
      </label>
      <input
        id="url"
        type="url"
        required
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://www.hellofresh.co.nz/recipecards/card/…"
        className="mt-2 w-full rounded-lg border border-line bg-paper px-4 py-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      <p className="mt-2 text-sm text-muted">
        A food page, or a link straight to a food-card PDF. We read it, pull out the food,
        and fill in anything it leaves unsaid.
      </p>

      {duplicate && (
        <div className="mt-4 rounded-card border border-accent/20 bg-accent-soft/60 p-4 text-sm">
          <p className="text-ink">
            You already have{" "}
            <span className="font-medium">
              {duplicate.count > 1 ? `${duplicate.count} foods` : `“${duplicate.title}”`}
            </span>{" "}
            from this link.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => run("replace")}
              className="rounded-full bg-accent px-4 py-1.5 font-medium text-accent-fg shadow-sm"
            >
              {duplicate.count > 1 ? "Replace them" : "Replace it"}
            </button>
            <button
              type="button"
              onClick={() => run("skip")}
              className="rounded-full border border-line bg-surface px-4 py-1.5 text-ink"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {!duplicate && (
        <button
          type="submit"
          disabled={busy || !url}
          className="mt-6 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0"
        >
          {status ?? "Import"}
        </button>
      )}
    </form>
  );
}

/**
 * The photo import streams its progress, so a failure can arrive on a 200
 * response. Validation failures still come back as ordinary JSON errors.
 */
/** The longest edge Anthropic's vision API keeps; larger uploads gain nothing. */
const UPLOAD_MAX_EDGE = 1568;

/**
 * Resize a photo to UPLOAD_MAX_EDGE and re-encode as JPEG in the browser.
 *
 * Extraction is unaffected (the API downsizes to this size regardless), the
 * upload shrinks, HEIC/PNG/etc. become JPEG the server can decode, and — because
 * the server crops the hero from exactly these bytes — the crop stays within a
 * Worker's memory. Throws if the browser can't decode the file; the caller then
 * falls back to the original.
 */
async function downscaleForUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, UPLOAD_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob ?? file;
  } finally {
    bitmap.close();
  }
}

async function submitImport(
  url: string,
  init: RequestInit,
  onStatus: (message: string) => void,
): Promise<string> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? "Something went wrong.");
  }
  return readJobStream(response, onStatus);
}

function PhotoImport() {
  const router = useRouter();
  const [shots, setShots] = useState<Shot[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = status !== null;

  function addFiles(files: FileList | null) {
    if (!files) return;
    const added = Array.from(files).map((file, i) => ({
      file,
      // First shot is nearly always the front of the card, second the back.
      kind: guessKind(shots.length + i),
      preview: URL.createObjectURL(file),
    }));
    setShots((current) => [...current, ...added]);
  }

  function remove(index: number) {
    setShots((current) => {
      URL.revokeObjectURL(current[index].preview);
      return current.filter((_, i) => i !== index);
    });
  }

  function setKind(index: number, kind: Shot["kind"]) {
    setShots((current) => current.map((shot, i) => (i === index ? { ...shot, kind } : shot)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Preparing photos…");
    setError(null);

    const form = new FormData();
    for (const shot of shots) {
      // Shrink to the size the vision API works at anyway; this also normalises
      // to JPEG so the server can decode it, and keeps the hero crop small
      // enough to run in a Worker. On any failure, send the original.
      let payload: Blob = shot.file;
      try {
        payload = await downscaleForUpload(shot.file);
      } catch {
        payload = shot.file;
      }
      form.append("images", payload, "photo.jpg");
      form.append("kinds", shot.kind);
    }

    setStatus("Uploading…");
    try {
      const id = await submitImport("/api/import/photos", { method: "POST", body: form }, setStatus);
      router.push(`/foods/${id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
      setStatus(null);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-sm text-muted">
        Photograph the whole card. For a meal-kit card that means the front and the back — the
        ingredients and the instructions are rarely on the same side.
      </p>

      <label className="mt-4 flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-line px-4 py-10 text-sm font-medium text-muted transition-colors hover:border-accent/50 hover:bg-accent-soft/30">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = ""; // Allow re-picking the same file.
          }}
        />
        Take a photo, or choose from your library
      </label>

      {shots.length > 0 && (
        <ul className="mt-6 space-y-3">
          {shots.map((shot, index) => (
            <li key={shot.preview} className="flex items-center gap-4 rounded-lg border border-line bg-paper p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.preview} alt="" className="h-16 w-16 rounded object-cover" />
              <select
                value={shot.kind}
                onChange={(event) => setKind(index, event.target.value as Shot["kind"])}
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
              >
                <option value="front">Front</option>
                <option value="back">Back</option>
                <option value="other">Other</option>
              </select>
              <button
                type="button"
                onClick={() => remove(index)}
                className="ml-auto text-sm text-muted underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy || shots.length === 0}
        className="mt-6 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-sm transition-transform hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0"
      >
        {status ?? `Import ${shots.length || ""} photo${shots.length === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}

function guessKind(index: number): Shot["kind"] {
  if (index === 0) return "front";
  if (index === 1) return "back";
  return "other";
}
