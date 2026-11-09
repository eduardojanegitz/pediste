import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Dados públicos do estabelecimento do endereço (`/` = padrão, `/e/<apelido>`): só nome e apelido.
 * `null` = não existe. Chamada sem argumento = estabelecimento padrão.
 */
export const getEstablishment = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ slug: z.string().max(40).optional() })
      .optional()
      .transform((v) => v ?? {})
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ name: string; slug: string; isDefault: boolean } | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveEstablishment } = await import("@/lib/establishment.server");
    const est = await resolveEstablishment(supabaseAdmin, data.slug);
    return est ? { name: est.name, slug: est.slug, isDefault: est.isDefault } : null;
  });
