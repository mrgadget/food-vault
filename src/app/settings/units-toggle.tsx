"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { UnitSystem } from "@/lib/units";

const OPTIONS: { value: UnitSystem; label: string; hint: string }[] = [
  { value: "metric", label: "Metric", hint: "grams, millilitres, °C" },
  { value: "imperial", label: "Imperial", hint: "ounces, fluid ounces, °F" },
];

export function UnitsToggle({ initial }: { initial: UnitSystem }) {
  const router = useRouter();
  const [system, setSystem] = useState(initial);
  const [error, setError] = useState(false);

  async function choose(next: UnitSystem) {
    if (next === system) return;
    const previous = system;
    setSystem(next); // optimistic
    setError(false);

    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitSystem: next }),
    });

    if (!response.ok) {
      setSystem(previous);
      setError(true);
      return;
    }
    // Food pages read this server-side; refresh so they pick up the change.
    router.refresh();
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {OPTIONS.map((option) => {
          const active = option.value === system;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => choose(option.value)}
              className={`rounded-card border p-4 text-left transition-colors ${
                active
                  ? "border-accent bg-accent-soft/60 ring-1 ring-accent"
                  : "border-line bg-surface hover:border-accent/40"
              }`}
            >
              <span className="font-display text-lg font-semibold">{option.label}</span>
              <span className="mt-0.5 block text-sm text-muted">{option.hint}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-red-700">Couldn&apos;t save that. Try again.</p>}
    </div>
  );
}
