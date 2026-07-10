import type { UnitSystem } from "@/lib/units";
import type { ServerClient } from "@/lib/supabase/server";

/** The reader's unit system, defaulting to metric when they've never set one. */
export async function getUnitSystem(supabase: ServerClient): Promise<UnitSystem> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("unit_system")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.unit_system as UnitSystem | undefined) ?? "metric";
}

/** Upsert the reader's unit system. RLS ties the row to the signed-in user. */
export async function setUnitSystem(
  supabase: ServerClient,
  userId: string,
  system: UnitSystem,
): Promise<void> {
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, unit_system: system, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
