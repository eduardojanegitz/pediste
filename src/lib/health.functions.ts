import { createServerFn } from "@tanstack/react-start";
import { requireSuperAdmin } from "@/lib/admin-middleware";
import type { HealthReport } from "@/lib/health";

/**
 * Confere a configuração do sistema (migrações aplicadas, variáveis, segurança e uso).
 * Só o super administrador. Nunca devolve valores de segredos: só "ok", "atenção" ou "falha" com orientação.
 */
export const getSystemHealth = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<HealthReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runHealthChecks } = await import("@/lib/health.server");
    const checks = await runHealthChecks({ db: supabaseAdmin, env: process.env });
    return { generatedAt: new Date().toISOString(), checks };
  });
