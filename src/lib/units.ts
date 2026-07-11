/**
 * Amount formatting and metric/imperial conversion.
 *
 * Quantities are stored metric (see the extraction prompt); this converts them
 * to the reader's chosen system at display time. A converter that normalises to
 * a base unit and re-emits also copes with older recipes stored in imperial —
 * it simply converts the other way — so the reader always sees their system.
 */

export type UnitSystem = "metric" | "imperial";

const G_PER_OZ = 28.3495;
const G_PER_LB = 453.592;
const ML_PER_FLOZ = 29.5735;

/** Cooking fractions a reader expects to see, in place of decimals. */
const NICE_FRACTIONS: [number, string][] = [
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [3 / 8, "3/8"],
  [1 / 2, "1/2"],
  [5 / 8, "5/8"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
  [7 / 8, "7/8"],
];

/**
 * A number as a cook would write it: 0.5 -> "1/2", 1.75 -> "1 3/4", 150 -> "150".
 * Amounts that aren't near a common fraction fall back to a trimmed decimal.
 */
export function formatNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const n = Math.abs(value);

  const whole = Math.floor(n);
  const frac = n - whole;

  if (frac < 0.02) return sign + String(whole);
  if (frac > 0.98) return sign + String(whole + 1);

  let best: string | null = null;
  let bestErr = 0.04;
  for (const [candidate, label] of NICE_FRACTIONS) {
    const err = Math.abs(frac - candidate);
    if (err < bestErr) {
      bestErr = err;
      best = label;
    }
  }
  if (best) return sign + (whole > 0 ? `${whole} ${best}` : best);

  // No tidy fraction; show a short decimal.
  return sign + String(Math.round(n * 100) / 100);
}

type Dimension = { dim: "mass" | "volume"; perBase: number };

/** Grams-per-unit or millilitres-per-unit, or null for a unit we don't convert. */
function classify(unit: string): Dimension | null {
  const u = unit.trim().toLowerCase().replace(/\.$/, "");
  const mass: Record<string, number> = {
    g: 1, gram: 1, grams: 1, gm: 1,
    kg: 1000, kilogram: 1000, kilograms: 1000,
    oz: G_PER_OZ, ounce: G_PER_OZ, ounces: G_PER_OZ,
    lb: G_PER_LB, lbs: G_PER_LB, pound: G_PER_LB, pounds: G_PER_LB,
  };
  const volume: Record<string, number> = {
    ml: 1, milliliter: 1, millilitre: 1, milliliters: 1, millilitres: 1,
    l: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000,
    "fl oz": ML_PER_FLOZ, floz: ML_PER_FLOZ, "fluid ounce": ML_PER_FLOZ, "fluid ounces": ML_PER_FLOZ,
  };
  if (u in mass) return { dim: "mass", perBase: mass[u] };
  if (u in volume) return { dim: "volume", perBase: volume[u] };
  return null;
}

/** Metric bulk units read as decimals; everything else takes fractions. */
const DECIMAL_UNITS = new Set(["kg", "L"]);

/** Round to a precision a cook would actually measure at. */
function roundForUnit(quantity: number, unit: string): number {
  if (unit === "g" || unit === "ml") {
    if (quantity >= 50) return Math.round(quantity / 5) * 5;
    if (quantity >= 10) return Math.round(quantity);
    return Math.round(quantity * 10) / 10;
  }
  if (unit === "kg" || unit === "L") return Math.round(quantity * 100) / 100;
  if (unit === "lb") return Math.round(quantity * 8) / 8; // eighths — "1 1/8 lb"
  return Math.round(quantity * 4) / 4; // oz, fl oz — quarters
}

function formatFor(quantity: number, unit: string): string {
  const amount = DECIMAL_UNITS.has(unit)
    ? String(Math.round(quantity * 100) / 100)
    : formatNumber(quantity);
  return `${amount} ${unit}`;
}

/**
 * A stored (metric) amount rendered in the reader's system. Units we can't
 * convert — teaspoons, cloves, packets — pass through untouched, only their
 * number tidied into a fraction.
 */
export function displayAmount(
  quantity: number | null,
  unit: string | null,
  system: UnitSystem,
): string {
  // A null quantity is "to taste": show only the unit, if any.
  if (quantity === null) return unit ?? "";

  const dimension = unit ? classify(unit) : null;
  if (!dimension) {
    return unit ? `${formatNumber(quantity)} ${unit}` : formatNumber(quantity);
  }

  const base = quantity * dimension.perBase; // grams or millilitres
  const converted = emit(base, dimension.dim, system);
  return formatFor(roundForUnit(converted.quantity, converted.unit), converted.unit);
}

function emit(base: number, dim: "mass" | "volume", system: UnitSystem): { quantity: number; unit: string } {
  if (dim === "mass") {
    if (system === "metric") {
      return base >= 1000 ? { quantity: base / 1000, unit: "kg" } : { quantity: base, unit: "g" };
    }
    const oz = base / G_PER_OZ;
    return oz >= 16 ? { quantity: oz / 16, unit: "lb" } : { quantity: oz, unit: "oz" };
  }
  if (system === "metric") {
    return base >= 1000 ? { quantity: base / 1000, unit: "L" } : { quantity: base, unit: "ml" };
  }
  return { quantity: base / ML_PER_FLOZ, unit: "fl oz" };
}

/**
 * Convert oven temperatures written into free text to the reader's system.
 *
 * Bidirectional on purpose: newer recipes store Celsius, but ones imported
 * before metric normalisation hold Fahrenheit, so a reader must be able to see
 * either turned into their own — no re-import required. Matches "220°C",
 * "220 C", "350°F", "350 degrees F".
 *
 * A plausible-oven-range guard keeps it from mistaking a cup abbreviation
 * ("2 C flour") or a stray letter for a temperature.
 */
export function convertTemperatures(text: string, system: UnitSystem): string {
  return text.replace(
    /(\d{2,3})\s*(?:°\s*|degrees?\s+)?([CF])(?:elsius|ahrenheit)?\b/gi,
    (match, value, letter) => {
      const n = Number(value);
      const isCelsius = letter.toUpperCase() === "C";
      // Wide enough for a meat-probe temperature (74°C / 165°F), not so wide it
      // mistakes a stray number for one. Two-plus digits already rules out a
      // cup abbreviation ("2 C flour").
      const looksLikeTemp = isCelsius ? n >= 40 && n <= 300 : n >= 100 && n <= 550;
      if (!looksLikeTemp) return match;

      if (system === "metric") {
        if (isCelsius) return match;
        return `${round5((n - 32) * 5 / 9)}°C`;
      }
      if (!isCelsius) return match;
      return `${round5((n * 9) / 5 + 32)}°F`;
    },
  );
}

/** Oven temperatures are round numbers; snap conversions to the nearest 5. */
function round5(value: number): number {
  return Math.round(value / 5) * 5;
}
