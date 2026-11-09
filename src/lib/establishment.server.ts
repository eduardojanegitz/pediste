import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { SLUG_RE } from "@/lib/scope";

export type PublicEstablishment = { id: string; name: string; slug: string; isDefault: boolean };

/**
 * Estabelecimento do endereço público: sem apelido = o padrão; com apelido = o que tiver esse apelido.
 * `null` se não existe (apelido inválido ou desconhecido). Só devolve dados públicos (nome e apelido).
 */
export async function resolveEstablishment(
  db: SupabaseClient<Database>,
  slug: string | undefined,
): Promise<PublicEstablishment | null> {
  if (slug !== undefined && (slug.length > 40 || !SLUG_RE.test(slug))) return null;
  const q = db.from("establishments").select("id, name, slug, is_default");
  const { data } = await (
    slug === undefined ? q.eq("is_default", true) : q.eq("slug", slug)
  ).maybeSingle();
  return data
    ? { id: data.id, name: data.name, slug: data.slug, isDefault: data.is_default }
    : null;
}
