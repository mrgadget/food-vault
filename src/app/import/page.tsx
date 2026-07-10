"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { readJobStream } from "@/lib/job-stream";

type Tab = "url" | "photos";
type Shot = { file: File; kind: "front" | "back" | "other"; preview: string };

export default function ImportPage() {
  const [tab, setTab] = useState<Tab>("url");

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Add a recipe</h1>

      <div className="mt-6 flex gap-1 rounded-lg bg-stone-100 p-1">
        <TabButton active={tab === "url"} onClick={() => setTab("url")}>
          From a link
        </TabButton>
        <TabButton active={tab === "photos"} onClick={() => setTab("photos")}>
          From photos
        </TabButton>
      </div>

      <div className="mt-8">{tab === "url" ? <UrlImport /> : <PhotoImport />}</div>
    </>
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
      className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
        active ? "bg-white shadow-sm" : "text-stone-600"
      }`}
    >
      {children}
    </button>
  );
}

function UrlImport() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = status !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Starting…");
    setError(null);

    try {
      const id = await submitImport(
        "/api/import/url",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        },
        setStatus,
      );
      router.push(`/recipes/${id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
      setStatus(null);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="url" className="block text-sm font-medium">
        Recipe URL
      </label>
      <input
        id="url"
        type="url"
        required
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://www.hellofresh.com/recipes/..."
        className="mt-2 w-full rounded-lg border border-stone-300 px-4 py-3"
      />
      <p className="mt-2 text-sm text-stone-500">
        We read the page, pull out the recipe, and fill in anything it leaves unsaid.
      </p>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy || !url}
        className="mt-6 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {status ?? "Import"}
      </button>
    </form>
  );
}

/**
 * Import endpoints stream their progress, so a failure can arrive on a 200
 * response. Validation failures still come back as ordinary JSON errors.
 */
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
    setStatus("Uploading…");
    setError(null);

    const form = new FormData();
    for (const shot of shots) {
      form.append("images", shot.file);
      form.append("kinds", shot.kind);
    }

    try {
      const id = await submitImport("/api/import/photos", { method: "POST", body: form }, setStatus);
      router.push(`/recipes/${id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
      setStatus(null);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-sm text-stone-600">
        Photograph the whole card. For a meal-kit card that means the front and the back — the
        ingredients and the instructions are rarely on the same side.
      </p>

      <label className="mt-4 flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-stone-300 px-4 py-10 text-sm font-medium text-stone-600">
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
            <li key={shot.preview} className="flex items-center gap-4 rounded-lg border border-stone-200 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.preview} alt="" className="h-16 w-16 rounded object-cover" />
              <select
                value={shot.kind}
                onChange={(event) => setKind(index, event.target.value as Shot["kind"])}
                className="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              >
                <option value="front">Front</option>
                <option value="back">Back</option>
                <option value="other">Other</option>
              </select>
              <button
                type="button"
                onClick={() => remove(index)}
                className="ml-auto text-sm text-stone-500 underline"
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
        className="mt-6 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
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
