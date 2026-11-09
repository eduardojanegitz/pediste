import type { PulseRow } from "@/lib/orders.functions";

export type AlertKind = "new" | "edited" | "cancelled";
export type AlertEvent = { kind: AlertKind; orderId: string; name: string };

/**
 * Compara duas leituras do "pulso" da rodada e diz o que mudou.
 * - `prev === null` é a primeira leitura (linha de base): nada é novidade.
 * - pedido que não existia (ou estava cancelado) e agora está confirmado = novo;
 * - versão maior em pedido confirmado = editado;
 * - confirmado que virou cancelado = cancelado.
 */
export function diffPulse(prev: PulseRow[] | null, next: PulseRow[]): AlertEvent[] {
  if (prev === null) return [];
  const before = new Map(prev.map((r) => [r.id, r]));
  const events: AlertEvent[] = [];
  for (const r of next) {
    const old = before.get(r.id);
    if (r.status === "confirmed" && (!old || old.status === "cancelled")) {
      events.push({ kind: "new", orderId: r.id, name: r.name });
    } else if (old && old.status === "confirmed" && r.status === "cancelled") {
      events.push({ kind: "cancelled", orderId: r.id, name: r.name });
    } else if (old && r.status === "confirmed" && r.version > old.version) {
      events.push({ kind: "edited", orderId: r.id, name: r.name });
    }
  }
  return events;
}

const PRIORITY: AlertKind[] = ["new", "edited", "cancelled"];

/** O som mais importante do lote (um som só, mesmo se chegarem vários pedidos juntos). */
export function strongestKind(events: AlertEvent[]): AlertKind | null {
  return PRIORITY.find((k) => events.some((e) => e.kind === k)) ?? null;
}

/** Texto curto para aviso na tela: "Maria fez um pedido" · "3 novos pedidos". */
export function describeEvents(events: AlertEvent[]): string {
  if (events.length === 0) return "";
  const count = (k: AlertKind) => events.filter((e) => e.kind === k);
  const parts: string[] = [];
  const news = count("new");
  if (news.length === 1) parts.push(`${news[0]!.name} fez um pedido`);
  else if (news.length > 1) parts.push(`${news.length} novos pedidos`);
  const edited = count("edited");
  if (edited.length === 1) parts.push(`${edited[0]!.name} editou o pedido`);
  else if (edited.length > 1) parts.push(`${edited.length} pedidos editados`);
  const gone = count("cancelled");
  if (gone.length === 1) parts.push(`${gone[0]!.name} cancelou o pedido`);
  else if (gone.length > 1) parts.push(`${gone.length} pedidos cancelados`);
  return parts.join(" · ");
}

/** Assinatura estável do pulso: muda quando qualquer pedido é criado, editado ou cancelado. */
export function pulseSignature(rows: PulseRow[]): string {
  return rows.map((r) => `${r.id}:${r.version}:${r.status}`).join("|");
}

/** Título da aba com a contagem de novidades não vistas: "(2) Pedidos — Pediste". */
export function titleWithCount(base: string, unseen: number): string {
  return unseen > 0 ? `(${unseen}) ${base}` : base;
}
