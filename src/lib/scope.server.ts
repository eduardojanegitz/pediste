import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertEstablishment, type AdminScope } from "@/lib/scope";

type Db = SupabaseClient<Database>;

const NOT_FOUND = "Não encontrado.";

/** Estabelecimento de uma rodada; erro se a rodada não existe. */
export async function establishmentOfRound(db: Db, roundId: string): Promise<string> {
  const { data } = await db
    .from("rounds")
    .select("establishment_id")
    .eq("id", roundId)
    .maybeSingle();
  if (!data) throw new Error(NOT_FOUND);
  return data.establishment_id;
}

/** O administrador pode mexer nesta rodada? Devolve o estabelecimento dela. */
export async function assertRoundAccess(db: Db, s: AdminScope, roundId: string): Promise<string> {
  const est = await establishmentOfRound(db, roundId);
  assertEstablishment(s, est);
  return est;
}

export async function assertCategoryAccess(db: Db, s: AdminScope, categoryId: string) {
  const { data } = await db
    .from("categories")
    .select("establishment_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (!data) throw new Error(NOT_FOUND);
  assertEstablishment(s, data.establishment_id);
  return data.establishment_id;
}

export async function assertProductAccess(db: Db, s: AdminScope, productId: string) {
  const { data } = await db
    .from("products")
    .select("categories(establishment_id)")
    .eq("id", productId)
    .maybeSingle();
  const est = (data as unknown as { categories: { establishment_id: string } | null } | null)
    ?.categories?.establishment_id;
  if (!est) throw new Error(NOT_FOUND);
  assertEstablishment(s, est);
  return est;
}

/** Vários ids de uma vez (reordenar): todos precisam ser do mesmo conjunto acessível. */
export async function assertCategoriesAccess(db: Db, s: AdminScope, ids: string[]) {
  const { data } = await db.from("categories").select("id, establishment_id").in("id", ids);
  if (!data || data.length !== new Set(ids).size) throw new Error(NOT_FOUND);
  for (const c of data) assertEstablishment(s, c.establishment_id);
}

export async function assertProductsAccess(db: Db, s: AdminScope, ids: string[]) {
  const { data } = await db
    .from("products")
    .select("id, categories(establishment_id)")
    .in("id", ids);
  if (!data || data.length !== new Set(ids).size) throw new Error(NOT_FOUND);
  for (const p of data as unknown as { categories: { establishment_id: string } | null }[]) {
    if (!p.categories) throw new Error(NOT_FOUND);
    assertEstablishment(s, p.categories.establishment_id);
  }
}

/** Pedido -> rodada -> estabelecimento. */
export async function assertOrderAccess(db: Db, s: AdminScope, orderId: string) {
  const { data } = await db.from("orders").select("round_id").eq("id", orderId).maybeSingle();
  if (!data) throw new Error(NOT_FOUND);
  return assertRoundAccess(db, s, data.round_id);
}
