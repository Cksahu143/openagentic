import type { SupabaseClient } from "@supabase/supabase-js";

export async function hasPermission(
  supabase: SupabaseClient,
  userId: string,
  scope: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("permission_grants")
    .select("granted")
    .eq("user_id", userId)
    .eq("scope", scope)
    .maybeSingle();

  if (error) throw new Error(`Could not check ${scope} permission: ${error.message}`);
  return data?.granted === true;
}

export async function requirePermission(
  supabase: SupabaseClient,
  userId: string,
  scope: string,
): Promise<void> {
  if (!(await hasPermission(supabase, userId, scope))) {
    throw new Error(`Permission "${scope}" is not enabled. Open Permissions to enable it.`);
  }
}