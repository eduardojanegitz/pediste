import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileSpreadsheet, FileText, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import {
  byPerson,
  byRound,
  chargeMessage,
  formatDateBR,
  presets,
  summarizeReport,
  validPeriod,
  type Period,
} from "@/lib/report";
import { exportReportExcel, exportReportPdf } from "@/lib/report-export";
import { getReport } from "@/lib/report.functions";
import { isoToSpLocal } from "@/lib/schedule";
import { useEstablishment } from "./establishment-context";
import { whatsappToLink } from "./reminder";
import { btnPlain, btnPrimary, errMsg, field } from "./ui";

const todayBR = () => isoToSpLocal(new Date().toISOString()).slice(0, 10);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pop-card p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-4xl">{value}</p>
    </div>
  );
}

/** Relatórios: gasto por pessoa e por rodada em um período, com cobrança por WhatsApp e exportação. */
export function ReportView() {
  const { current } = useEstablishment();
  const options = useMemo(() => presets(todayBR()), []);
  const [period, setPeriod] = useState<Period>(options[0]!.period);
  const invalid = validPeriod(period);
  const q = useQuery({
    queryKey: ["report", current.id, period.from, period.to],
    queryFn: () => getReport({ data: { establishmentId: current.id, ...period } }),
    enabled: !invalid,
  });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const summary = useMemo(() => summarizeReport(rows), [rows]);
  const people = useMemo(() => byPerson(rows), [rows]);
  const rounds = useMemo(() => byRound(rows), [rows]);

  const charge = (i: number) => {
    const p = people[i];
    if (!p) return;
    const text = chargeMessage({ name: p.name, dueCents: p.dueCents, period, money: formatBRL });
    const url = p.phoneE164 ? whatsappToLink(p.phoneE164, text) : null;
    if (!url) return void toast.error("Esta pessoa não tem celular válido cadastrado.");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div>
      <section aria-label="Período" className="pop-card mb-5 space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className={
                o.period.from === period.from && o.period.to === period.to ? btnPrimary : btnPlain
              }
              onClick={() => setPeriod(o.period)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="rp-from" className="mb-1 block text-sm font-bold">
              De
            </label>
            <input
              id="rp-from"
              type="date"
              value={period.from}
              onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="rp-to" className="mb-1 block text-sm font-bold">
              Até
            </label>
            <input
              id="rp-to"
              type="date"
              value={period.to}
              onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
              className={field}
            />
          </div>
        </div>
        {invalid && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {invalid}
          </p>
        )}
      </section>

      {q.isLoading && <div className="h-40 animate-pulse rounded-3xl bg-muted" />}
      {q.isError && (
        <div role="alert" className="pop-card p-8 text-center">
          <h2 className="text-3xl">Não foi possível carregar o relatório</h2>
          <button className={`${btnPrimary} mt-4`} onClick={() => void q.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}

      {q.data && rows.length === 0 && (
        <div className="pop-card p-10 text-center">
          <h2 className="text-4xl">Nenhum pedido neste período</h2>
        </div>
      )}

      {q.data && rows.length > 0 && (
        <>
          {q.data.truncated && (
            <p role="alert" className="mb-3 text-sm font-semibold text-destructive">
              Há mais pedidos do que o relatório mostra. Reduza o período.
            </p>
          )}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total" value={formatBRL(summary.totalCents)} />
            <Stat label="Recebido" value={formatBRL(summary.paidCents)} />
            <Stat label="A receber" value={formatBRL(summary.dueCents)} />
            <Stat
              label="Ticket médio"
              value={summary.avgTicketCents != null ? formatBRL(summary.avgTicketCents) : "—"}
            />
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {summary.orders} pedido(s) · {summary.people} pessoa(s) · {summary.rounds} rodada(s) ·{" "}
            {formatDateBR(period.from)} a {formatDateBR(period.to)}. Valores pelos preços atuais dos
            produtos; itens sem preço não entram.
          </p>
          <div className="mb-5 flex flex-wrap gap-2">
            <button
              className={btnPlain}
              onClick={() => void run(() => exportReportPdf(rows, period))}
            >
              <FileText className="h-4 w-4" aria-hidden /> PDF
            </button>
            <button
              className={btnPlain}
              onClick={() => void run(() => exportReportExcel(rows, period))}
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
            </button>
          </div>

          <h2 className="mb-2 text-3xl">Por pessoa</h2>
          <ul className="mb-8 space-y-2">
            {people.map((p, i) => (
              <li
                key={p.participantId}
                className="pop-card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold">{p.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {p.orders} pedido(s) · total {formatBRL(p.totalCents)} · pago{" "}
                    {formatBRL(p.paidCents)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`font-display text-3xl ${p.dueCents > 0 ? "text-destructive" : ""}`}
                  >
                    {p.dueCents > 0 ? formatBRL(p.dueCents) : "Em dia"}
                  </span>
                  {p.dueCents > 0 && (
                    <button className={btnPrimary} onClick={() => charge(i)}>
                      <MessageCircle className="h-4 w-4" aria-hidden /> Cobrar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <h2 className="mb-2 text-3xl">Por rodada</h2>
          <ul className="space-y-2">
            {rounds.map((r) => (
              <li
                key={r.roundId}
                className="pop-card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold">{r.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(r.firstAt).toLocaleDateString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}{" "}
                    · {r.people} pessoa(s) · {r.orders} pedido(s)
                  </p>
                </div>
                <p className="text-sm font-semibold">
                  Total {formatBRL(r.totalCents)} · recebido {formatBRL(r.paidCents)} · a receber{" "}
                  {formatBRL(r.dueCents)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
