import { z } from "zod";

/**
 * Structured-output schemas cannot express numeric or length constraints, so
 * every optional field is modelled as nullable rather than absent. The model
 * must always emit the key; `null` means "the source did not say".
 */

export const ingredientCategories = [
  "protein",
  "vegetable",
  "fruit",
  "grain",
  "dairy",
  "legume",
  "herb_spice",
  "sauce",
  "pantry",
  "other",
] as const;

export const ingredientSchema = z.object({
  quantity: z.number().nullable().describe("Numeric amount, or null for 'to taste'"),
  unit: z.string().nullable().describe("g, ml, tbsp, clove, ... or null"),
  item: z.string().describe("The ingredient itself, without quantity or prep"),
  prepNote: z.string().nullable().describe("e.g. 'finely diced', 'at room temperature'"),
  groupName: z.string().nullable().describe("Sub-food heading, e.g. 'For the sauce'"),
  category: z.enum(ingredientCategories).describe("What kind of ingredient this is"),
  canonical: z
    .string()
    .nullable()
    .describe("Lowercase common name for filtering: 'chicken', 'broccoli'. Null unless protein or vegetable."),
  inferred: z.boolean().describe("True if this was not stated in the source"),
});

export const sachetComponentSchema = z.object({
  item: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
});

export const sachetExpansionSchema = z.object({
  sachetName: z.string().describe("The blend as the source names it"),
  components: z.array(sachetComponentSchema),
  confidence: z.enum(["high", "medium", "low"]),
});

export const stepSchema = z.object({
  kind: z
    .enum(["major", "minor"])
    .describe("'major' for a numbered step, 'minor' for a bullet beneath one"),
  text: z
    .string()
    .describe("For a major step, its heading if it has one, else the whole instruction"),
  inferred: z.boolean().describe("True if this step was not stated in the source"),
});

/**
 * A photo import has no embedded images to lift out, so the hero is cropped from
 * one of the uploaded photographs. The model points at the finished-dish photo
 * and boxes it; the crop happens server-side. Coordinates are fractions of the
 * image (0-1), so they hold whatever that photo's pixel size turns out to be.
 */
export const heroImageSchema = z.object({
  imageIndex: z.number().int().describe("Which photograph holds the dish, numbered from 1 as labelled above"),
  x: z.number().describe("Left edge of the crop, 0-1 across the image width"),
  y: z.number().describe("Top edge of the crop, 0-1 down the image height"),
  width: z.number().describe("Crop width, 0-1 of the image width"),
  height: z.number().describe("Crop height, 0-1 of the image height"),
});

export const foodCourses = [
  "main",
  "starter",
  "side",
  "salad",
  "soup",
  "breakfast",
  "dessert",
  "baking",
  "snack",
  "drink",
  "sauce",
  "other",
] as const;

export const foodSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  course: z.enum(foodCourses).describe("The single course this dish belongs to"),
  servings: z.number().nullable(),
  prepMinutes: z.number().nullable(),
  cookMinutes: z.number().nullable(),
  cuisine: z.string().nullable(),
  tags: z.array(z.string()),
  ingredients: z.array(ingredientSchema),
  steps: z.array(stepSchema),
  sachetExpansions: z.array(sachetExpansionSchema),
  aiNotes: z
    .string()
    .nullable()
    .describe("Plain-English summary of what was inferred and why"),
  heroImage: heroImageSchema
    .nullable()
    .describe(
      "Photo imports only: the finished-dish photo to crop as the hero. Null when no photograph shows an appetising finished dish, and always null for web or PDF sources.",
    ),
});

export type Ingredient = z.infer<typeof ingredientSchema>;
export type SachetExpansion = z.infer<typeof sachetExpansionSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Food = z.infer<typeof foodSchema>;
