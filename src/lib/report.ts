/** Uma linha do relatório: um pedido confirmado, com o valor já calculado no servidor. */
export type ReportRow = {
  orderId: string;
  roundId: string;
  roundName: string;
  participantId: string;
  name: string;
  /** E.164 (+55…); só o painel do administrador vê. */
  phoneE164: string | null;
  createdAt: string;
  paidAt: string | null;
  /** Centavos; itens sem preço não contam. null = nenhum item do pedido tem preço. */
  valueCents: number | null;
};

export type PersonTotal = {
  participantId: string;
  name: string;
  phoneE164: string | null;
  orders: number;
  totalCents: number;
  paidCents: number;
  dueCents: number;
};

export type RoundTotal = {
  roundId: string;
  name: string;
  firstAt: string;
  orders: number;
  people: number;
  totalCents: number;
  paidCents: number;
  dueCents: number;
};

export type ReportSummary = {
  orders: number;
  people: number;
  rounds: number;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  /** Valor médio dos pedidos que têm preço; null se nenhum tem. */
  avgTicketCents: number | null;
};

const v = (r: ReportRow) => r.valueCents ?? 0;

/** Por pessoa: quem deve mais primeiro; empate pelo maior gasto e depois pelo nome. */
export function byPerson(rows: ReportRow[]): PersonTotal[] {
  const m = new Map<string, PersonTotal>();
  for (const r of rows) {
    const p = m.get(r.participantId) ?? {
      participantId: r.participantId,
      name: r.name,
      phoneE164: r.phoneE164,
      orders: 0,
      totalCents: 0,
      paidCents: 0,
      dueCents: 0,
    };
    p.orders += 1;
    p.totalCents += v(r);
    if (r.paidAt) p.paidCents += v(r);
    else p.dueCents += v(r);
    m.set(r.participantId, p);
  }
  return [...m.values()].sort(
    (a, b) =>
      b.dueCents - a.dueCents ||
      b.totalCents - a.totalCents ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}

/** Por rodada: a mais recente primeiro. */
export function byRound(rows: ReportRow[]): RoundTotal[] {
  const m = new Map<string, RoundTotal & { ids: Set<string> }>();
  for (const r of rows) {
    const t = m.get(r.roundId) ?? {
      roundId: r.roundId,
      name: r.roundName,
      firstAt: r.createdAt,
      orders: 0,
      people: 0,
      totalCents: 0,
      paidCents: 0,
      dueCents: 0,
      ids: new Set<string>(),
    };
    t.orders += 1;
    t.ids.add(r.participantId);
    t.totalCents += v(r);
    if (r.paidAt) t.paidCents += v(r);
    else t.dueCents += v(r);
    if (Date.parse(r.createdAt) < Date.parse(t.firstAt)) t.firstAt = r.createdAt;
    m.set(r.roundId, t);
  }
  return [...m.values()]
    .map(({ ids, ...t }) => ({ ...t, people: ids.size }))
    .sort((a, b) => Date.parse(b.firstAt) - Date.parse(a.firstAt));
}

export function summarizeReport(rows: ReportRow[]): ReportSummary {
  const priced = rows.filter((r) => r.valueCents != null);
  const total = rows.reduce((s, r) => s + v(r), 0);
  const paid = rows.filter((r) => r.paidAt).reduce((s, r) => s + v(r), 0);
  return {
    orders: rows.length,
    people: new Set(rows.map((r) => r.participantId)).size,
    rounds: new Set(rows.map((r) => r.roundId)).size,
    totalCents: total,
    paidCents: paid,
    dueCents: total - paid,
    avgTicketCents: priced.length ? Math.round(total / priced.length) : null,
  };
}

// ---------- Período (datas de Brasília, "YYYY-MM-DD") ----------

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseYmd = (s: string) => {
  const [y = 0, m = 1, d = 1] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Início do dia (00:00 de Brasília) como instante ISO. Brasília é sempre UTC-03:00. */
export const spDayStartIso = (date: string) => new Date(`${date}T00:00:00-03:00`).toISOString();

/** Instante ISO do início do dia SEGUINTE a `date` (limite superior exclusivo do período). */
export function spNextDayStartIso(date: string) {
  const d = parseYmd(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return spDayStartIso(ymd(d));
}

export type Period = { from: string; to: string };

/** Datas válidas, `from` <= `to` e no máximo ~13 meses (evita puxar o banco inteiro). */
export function validPeriod(p: Period): string | null {
  if (!DATE_RE.test(p.from) || !DATE_RE.test(p.to)) return "Datas inválidas.";
  const a = parseYmd(p.from);
  const b = parseYmd(p.to);
  // Recusa datas que não existem (ex.: 31/02), que o JavaScript "corrigiria" para outro dia.
  if (ymd(a) !== p.from || ymd(b) !== p.to) return "Datas inválidas.";
  if (b < a) return "A data final precisa ser depois da inicial.";
  if ((b.getTime() - a.getTime()) / 86_400_000 > 400) return "Escolha um período de até 13 meses.";
  return null;
}

/** "Este mês", "Mês passado" e "Últimos 30 dias" a partir de hoje (data de Brasília). */
export function presets(today: string): { label: string; period: Period }[] {
  const t = parseYmd(today);
  const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  const prevFirst = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
  const prevLast = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
  const d30 = new Date(t);
  d30.setUTCDate(d30.getUTCDate() - 29);
  return [
    { label: "Este mês", period: { from: ymd(first), to: today } },
    { label: "Mês passado", period: { from: ymd(prevFirst), to: ymd(prevLast) } },
    { label: "Últimos 30 dias", period: { from: ymd(d30), to: today } },
  ];
}

export const formatDateBR = (date: string) => date.split("-").reverse().join("/");

/** Mensagem de cobrança (o WhatsApp é aberto pelo administrador; nada é enviado sozinho). */
export function chargeMessage(input: {
  name: string;
  dueCents: number;
  period: Period;
  money: (cents: number) => string;
}): string {
  const first = input.name.trim().split(/\s+/)[0] ?? input.name;
  return [
    `Oi, ${first}! 😊`,
    "",
    `Passando para lembrar do pagamento dos pedidos de ${formatDateBR(input.period.from)} a ${formatDateBR(input.period.to)}: *${input.money(input.dueCents)}* em aberto.`,
    "",
    "Se já pagou, é só me avisar. Obrigado!",
  ].join("\n");
}
