import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { getSystemHealth } from "@/lib/health.functions";
import { HEALTH_GROUPS, summarizeHealth, type HealthStatus } from "@/lib/health";
import { btnPlain, btnPrimary } from "./ui";

const ICON: Record<HealthStatus, { Icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { Icon: CheckCircle2, cls: "text-accent-foreground", label: "Tudo certo" },
  warn: { Icon: AlertTriangle, cls: "text-foreground", label: "Atenção" },
  fail: { Icon: XCircle, cls: "text-destructive", label: "Falha" },
};

const BANNER: Record<HealthStatus, string> = {
  ok: "Tudo certo com a configuração.",
  warn: "Funciona, mas há pontos de atenção.",
  fail: "Há itens que precisam de correção.",
};

/** Saúde da configuração: migrações aplicadas, variáveis do servidor, segurança e uso. */
export function HealthView() {
  const q = useQuery({
    queryKey: ["system-health"],
    queryFn: () => getSystemHealth(),
    staleTime: 0,
    retry: false,
  });

  if (q.isLoading) return <div className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (q.isError || !q.data) {
    return (
      <div role="alert" className="pop-card p-8 text-center">
        <h2 className="text-3xl">Não foi possível verificar agora</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Se o banco ainda não tem as migrações mais recentes, aplique-as e tente de novo.
        </p>
        <button className={`${btnPrimary} mt-4`} onClick={() => void q.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const { checks, generatedAt } = q.data;
  const s = summarizeHealth(checks);
  const B = ICON[s.overall];

  return (
    <div>
      <section
        aria-label="Resumo"
        className={`pop-card mb-6 flex flex-wrap items-center justify-between gap-3 p-5 ${s.overall === "fail" ? "bg-destructive/10" : ""}`}
      >
        <div className="flex items-center gap-3">
          <B.Icon className={`h-8 w-8 ${B.cls}`} aria-hidden />
          <div>
            <h2 className="text-3xl">{BANNER[s.overall]}</h2>
            <p className="text-sm text-muted-foreground">
              {s.ok} ok · {s.warn} atenção · {s.fail} falha(s) · verificado às{" "}
              {new Date(generatedAt).toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
        <button className={btnPlain} onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} aria-hidden />{" "}
          Verificar de novo
        </button>
      </section>

      {HEALTH_GROUPS.map((group) => {
        const items = checks.filter((c) => c.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} aria-label={group} className="mb-6">
            <h3 className="mb-2 text-3xl">{group}</h3>
            <ul className="space-y-2">
              {items.map((c) => {
                const { Icon, cls, label } = ICON[c.status];
                return (
                  <li key={c.id} className="pop-card flex gap-3 px-4 py-3">
                    <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${cls}`} aria-label={label} />
                    <div className="min-w-0">
                      <p className="font-bold">{c.label}</p>
                      <p className="text-sm text-muted-foreground">{c.detail}</p>
                      {c.fix && c.status !== "ok" && (
                        <p className="mt-1 text-sm font-medium">
                          <span className="font-bold">O que fazer:</span> {c.fix}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
