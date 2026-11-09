import { z } from "zod";

const TZ = "America/Sao_Paulo";
const iso = z.string().datetime({ offset: true });

/** Janela de pedidos. null = sem limite naquele lado. Abertura precisa vir antes do encerramento. */
export const scheduleSchema = z
  .object({ opensAt: iso.nullable(), closesAt: iso.nullable() })
  .refine((s) => !s.opensAt || !s.closesAt || Date.parse(s.closesAt) > Date.parse(s.opensAt), {
    path: ["closesAt"],
    message: "O encerramento precisa ser depois da abertura",
  });

/**
 * "2026-11-04T11:30" (campo datetime-local, hora de Brasília) -> ISO UTC.
 * O Brasil não tem horário de verão desde 2019, então Brasília é sempre UTC-03:00.
 * Independe do fuso do navegador de quem configura.
 */
export function spLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO -> "YYYY-MM-DDTHH:mm" na hora de Brasília (valor do campo datetime-local). */
export function isoToSpLocal(isoString: string | null): string {
  if (!isoString) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(isoString));
  return parts.replace(" ", "T");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Soma `days` dias a "YYYY-MM-DDTHH:mm" (só calendário, sem fuso: Brasília não tem horário de verão). */
export function addDaysLocal(local: string, days: number): string {
  const [date = "", time = ""] = local.split("T");
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${time}`;
}

const dayNumber = (local: string) => {
  const [y = 0, m = 1, d = 1] = (local.split("T")[0] ?? "").split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/**
 * Horários de uma rodada antiga trazidos para a frente, mantendo hora do dia e duração: o encerramento
 * (ou a abertura, se não houver encerramento) cai hoje se o horário ainda não passou, senão amanhã.
 * Sem horários = ambos vazios. Resultado em "YYYY-MM-DDTHH:mm" (hora de Brasília), pronto para os campos.
 */
export function copySchedule(
  round: { opens_at: string | null; closes_at: string | null },
  nowMs: number = Date.now(),
): { opens: string; closes: string } {
  const opens = isoToSpLocal(round.opens_at);
  const closes = isoToSpLocal(round.closes_at);
  const anchor = closes || opens;
  if (!anchor) return { opens: "", closes: "" };
  const now = isoToSpLocal(new Date(nowMs).toISOString());
  const timeOf = (l: string) => l.split("T")[1] ?? "";
  const target = timeOf(anchor) > timeOf(now) ? 0 : 1;
  const delta = dayNumber(now) + target - dayNumber(anchor);
  return {
    opens: opens ? addDaysLocal(opens, delta) : "",
    closes: closes ? addDaysLocal(closes, delta) : "",
  };
}
