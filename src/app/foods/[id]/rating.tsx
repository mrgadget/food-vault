"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STARS = [1, 2, 3, 4, 5];

export function StarRating({
  foodId,
  initial,
  readOnly = false,
}: {
  foodId: string;
  initial: number | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(initial);
  const [hover, setHover] = useState<number | null>(null);
  const [error, setError] = useState(false);

  async function set(value: number | null) {
    const previous = rating;
    setRating(value); // optimistic
    setError(false);

    const response = await fetch(`/api/foods/${foodId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: value }),
    });

    if (!response.ok) {
      setRating(previous); // roll back
      setError(true);
      return;
    }
    // Keep the listing's copy of the rating in step.
    router.refresh();
  }

  // While hovering, preview the rating the cursor would set.
  const shown = hover ?? rating ?? 0;

  // A viewer sees the rating but cannot change it.
  if (readOnly) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex text-2xl leading-none">
          {STARS.map((star) => (
            <span key={star} className={star <= (rating ?? 0) ? "text-accent" : "text-line"}>
              ★
            </span>
          ))}
        </div>
        {rating !== null && <span className="text-sm text-muted">{rating}/5</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex" onMouseLeave={() => setHover(null)}>
        {STARS.map((star) => (
          <button
            key={star}
            type="button"
            // Clicking the current rating clears it, so a star can be un-set.
            onClick={() => set(star === rating ? null : star)}
            onMouseEnter={() => setHover(star)}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            className="p-0.5 text-2xl leading-none transition-transform hover:scale-110"
          >
            <span className={star <= shown ? "text-accent" : "text-line"}>★</span>
          </button>
        ))}
      </div>
      {rating !== null && <span className="text-sm text-muted">{rating}/5</span>}
      {error && <span className="text-sm text-red-700">Couldn&apos;t save</span>}
    </div>
  );
}
