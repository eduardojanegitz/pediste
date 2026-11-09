export type HealthStatus = "ok" | "warn" | "fail";

export type HealthCheck = {
  id: string;
  group: "Banco de dados" | "Servidor" | "Segurança" | "Uso";
  label: string;
  status: HealthStatus;
  /** O que foi encontrado, em português simples. */
  detail: string;
  /** O que fazer, quando não está ok. */
  fix?: string | undefined;
};

export type HealthReport = { generatedAt: string; checks: HealthCheck[] };

export function summarizeHealth(checks: HealthCheck[]) {
  const count = (s: HealthStatus) => checks.filter((c) => c.status === s).length;
  const fail = count("fail");
  const warn = count("warn");
  return {
    ok: count("ok"),
    warn,
    fail,
    overall: (fail > 0 ? "fail" : warn > 0 ? "warn" : "ok") as HealthStatus,
  };
}

/** O contato do VAPID parece o valor de exemplo ou não é um `mailto:`/`https:` válido? */
export function subjectLooksPlaceholder(subject: string | undefined): boolean {
  if (!subject) return true;
  if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/i.test(subject)) return true;
  return /exemplo\.com|example\.com|pedeai\.local|seu-email/i.test(subject);
}

/** Ordem de exibição dos grupos. */
export const HEALTH_GROUPS: HealthCheck["group"][] = [
  "Banco de dados",
  "Servidor",
  "Segurança",
  "Uso",
];
