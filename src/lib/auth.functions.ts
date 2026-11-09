import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/admin-middleware";

export type AdminEstablishment = { id: string; name: string; slug: string; isDefault: boolean };

/** Confirma, no servidor, que a sessão atual é de um administrador. */
export const getAdminSession = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string }).email ?? null;
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data } = context.establishmentIds.length
      ? await db
          .from("establishments")
          .select("id, name, slug, is_default")
          .in("id", context.establishmentIds)
          .order("is_default", { ascending: false })
          .order("name")
      : { data: [] };
    const establishments: AdminEstablishment[] = (data ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      isDefault: e.is_default,
    }));
    return { adminId: context.adminId, email, isSuper: context.isSuper, establishments };
  });
