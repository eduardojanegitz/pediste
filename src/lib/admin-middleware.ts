import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Exige um usuário autenticado (JWT válido) que esteja na tabela `admins`.
 * A checagem é feita no servidor com o client administrativo; o frontend só redireciona.
 * Erros começam com "Unauthorized" (sem sessão/token inválido) ou "Forbidden" (sem permissão).
 *
 * O contexto traz também o escopo: se o administrador é super e quais estabelecimentos ele acessa
 * (o super acessa todos). Cada função do painel confere o estabelecimento com `assertEstablishment`
 * e as ajudantes de `scope.server.ts`.
 */
export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin;
    const { data, error } = await db
      .from("admins")
      .select("user_id, is_super")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error("Não foi possível verificar o acesso. Tente novamente.");
    }
    if (!data) throw new Error("Forbidden: esta conta não tem acesso ao painel.");

    const { data: links, error: e2 } = data.is_super
      ? await db.from("establishments").select("id")
      : await db
          .from("admin_establishments")
          .select("establishment_id")
          .eq("admin_id", context.userId);
    if (e2) {
      console.error(e2);
      throw new Error("Não foi possível verificar o acesso. Tente novamente.");
    }
    const establishmentIds = (links ?? []).map((l) =>
      "id" in l ? (l as { id: string }).id : (l as { establishment_id: string }).establishment_id,
    );
    return next({
      context: { adminId: context.userId, isSuper: data.is_super, establishmentIds },
    });
  });
