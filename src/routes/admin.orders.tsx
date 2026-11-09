import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ClipboardCopy,
  Copy,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Share2,
  Store,
  CheckCircle2,
  BadgeCheck,
  Undo2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertsBar } from "@/features/admin/AlertsBar";
import { changedSincePrint, type PrintOptions } from "@/features/admin/comanda";
import { BoardLinkDialog } from "@/features/admin/BoardLinkDialog";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import { PrintDialog } from "@/features/admin/PrintDialog";
import { PendingCard } from "@/features/admin/PendingCard";
import {
  pickEstablishment,
  readStoredEstablishment,
  useEstablishment,
} from "@/features/admin/establishment-context";
import { ShareDialog } from "@/features/admin/ShareDialog";
import {
  consolidate,
  emptyFilters,
  filterOrders,
  groupByCategory,
  NO_CATEGORY,
  orderValue,
  summarize,
  type OrderFilters,
} from "@/features/admin/orders-logic";
import { btnPlain, btnPrimary, errMsg, field } from "@/features/admin/ui";
import { useOrderAlerts } from "@/features/admin/useOrderAlerts";
import { copyText, exportExcel, exportPdf, toText } from "@/lib/export";
import { formatBRL, formatSaoPauloTime } from "@/lib/format";
import {
  getRoundOrders,
  listRounds,
  resetParticipantCode,
  setOrderPaid,
  type RoundOrder,
} from "@/lib/orders.functions";

const roundsQuery = (establishmentId: string) =>
  queryOptions({
    queryKey: ["rounds", establishmentId],
    queryFn: () => listRounds({ data: { establishmentId } }),
  });

export const Route = createFileRoute("/admin/orders")({
  head: () => ({ meta: [{ title: "Pedidos — PedeAí!" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => {
    const est = pickEstablishment(context.establishments, readStoredEstablishment());
    return est ? context.queryClient.ensureQueryData(roundsQuery(est.id)) : undefined;
  },
  pendingComponent: () => <div className="h-40 animate-pulse rounded-3xl bg-muted" />,
  component: OrdersPage,
});

function Counter({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const rounded = useTransform(mv, (v) => Math.round(v));
  useEffect(() => {
    const c = animate(mv, value, { duration: reduce ? 0 : 0.6, ease: "easeOut" });
    return () => c.stop();
  }, [value, mv, reduce]);
  return <motion.span>{rounded}</motion.span>;
}

function Tile({
  label,
  children,
  tone,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  tone: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className={`pop-card p-4 ${tone}`}>
      <p className="text-xs font-bold uppercase tracking-widest">{label}</p>
      <p className="font-display text-5xl leading-none">{children}</p>
      {sub && <p className="mt-1 text-xs font-semibold">{sub}</p>}
    </div>
  );
}

type View = "participants" | "totals";

function OrdersPage() {
  const { current } = useEstablishment();
  const { data: rounds } = useSuspenseQuery(roundsQuery(current.id));
  const [roundId, setRoundId] = useState<string | undefined>(
    rounds.find((r) => r.status === "open")?.id ?? rounds[0]?.id,
  );
  const round = rounds.find((r) => r.id === roundId);
  // Atualiza sozinho a cada 30 s para acompanhar novos pedidos e edições.
  const q = useQuery({
    queryKey: ["round-orders", roundId],
    queryFn: () => getRoundOrders({ data: { roundId: roundId! } }),
    enabled: !!roundId,
    refetchInterval: 30_000,
  });
  const orders = useMemo(() => q.data ?? [], [q.data]);
  const alerts = useOrderAlerts({ roundId, active: !!round && round.state !== "closed" });
  const [filters, setFilters] = useState<OrderFilters>(emptyFilters);
  const [view, setView] = useState<View>("participants");
  const [resetFor, setResetFor] = useState<RoundOrder | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [printPreset, setPrintPreset] = useState<Partial<PrintOptions> | undefined>(undefined);
  const changedAfterPrint = useMemo(
    () => changedSincePrint(orders, round?.last_printed_at ?? null),
    [orders, round?.last_printed_at],
  );
  const openPrint = (preset?: Partial<PrintOptions>) => {
    setPrintPreset(preset);
    setPrintOpen(true);
  };

  const filtered = useMemo(() => filterOrders(orders, filters), [orders, filters]);
  const stats = useMemo(() => summarize(orders), [orders]);
  const totals = useMemo(() => consolidate(filtered), [filtered]);
  const categories = useMemo(() => consolidate(orders).map((c) => c.category), [orders]);
  const products = useMemo(
    () =>
      consolidate(orders).flatMap((c) =>
        !filters.category || (c.category ?? NO_CATEGORY) === filters.category ? c.products : [],
      ),
    [orders, filters.category],
  );
  const filtering =
    filters.search ||
    filters.category ||
    filters.productId ||
    filters.editedOnly ||
    filters.payment;
  const markPaid = useServerFn(setOrderPaid);
  const togglePaid = async (o: RoundOrder) => {
    try {
      await markPaid({ data: { orderId: o.order_id, paid: !o.paid_at } });
      await q.refetch();
      toast.success(o.paid_at ? "Pagamento desmarcado" : `${o.participant}: pago`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const run = (fn: () => Promise<void>, ok?: string) => async () => {
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch {
      toast.error("Não foi possível concluir a exportação.");
    }
  };

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Painel
          </p>
          <h1 className="text-6xl text-primary">Pedidos</h1>
        </div>
        {rounds.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="round" className="sr-only">
              Rodada
            </label>
            <select
              id="round"
              value={roundId}
              onChange={(e) => {
                setRoundId(e.target.value);
                setFilters(emptyFilters);
              }}
              className="rounded-full border-2 border-foreground bg-card px-4 py-2 font-bold"
            >
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{" "}
                  {r.state === "open" ? "(aberta)" : r.state === "waiting" ? "(aguardando)" : ""}
                </option>
              ))}
            </select>
            {round && (
              <button className={btnPlain} onClick={() => setBoardOpen(true)}>
                <Store className="h-4 w-4" aria-hidden /> Link do estabelecimento
              </button>
            )}
            {round && round.state !== "closed" && (
              <button className={btnPlain} onClick={() => setShareOpen(true)}>
                <Share2 className="h-4 w-4" aria-hidden /> Compartilhar
              </button>
            )}
            <button
              aria-label="Atualizar pedidos"
              className={btnPlain}
              onClick={() => void q.refetch()}
            >
              <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        )}
      </header>
      {round && <AlertsBar alerts={alerts} />}
      {alerts.newIds.size > 0 && (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-foreground bg-secondary p-3 text-secondary-foreground"
        >
          <p className="text-sm font-bold">
            {alerts.newIds.size === 1
              ? "1 pedido novo ou alterado"
              : `${alerts.newIds.size} pedidos novos ou alterados`}
          </p>
          <button type="button" className={btnPlain} onClick={alerts.markSeen}>
            <Check className="h-4 w-4" aria-hidden /> Marcar como vistos
          </button>
        </div>
      )}
      {q.dataUpdatedAt > 0 && (
        <p className="-mt-3 mb-4 text-xs text-muted-foreground" aria-live="off">
          Atualizado às {formatSaoPauloTime(new Date(q.dataUpdatedAt).toISOString())} · atualiza
          sozinho
        </p>
      )}

      {!round ? (
        <div className="pop-card p-10 text-center">
          <h2 className="text-4xl">Nenhuma rodada</h2>
          <p className="mt-2 text-muted-foreground">
            Crie uma rodada na aba Rodadas para receber pedidos.
          </p>
        </div>
      ) : q.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-3xl bg-muted" />
          ))}
        </div>
      ) : q.isError ? (
        <div role="alert" className="pop-card p-8 text-center">
          <h2 className="text-3xl">Não foi possível carregar os pedidos</h2>
          <button className={`${btnPrimary} mt-4`} onClick={() => void q.refetch()}>
            Tentar de novo
          </button>
        </div>
      ) : orders.length === 0 ? (
        <>
          {round && <PendingCard round={round} />}
          <div className="pop-card p-10 text-center">
            <h2 className="text-4xl">Sem pedidos ainda</h2>
            <p className="mt-2 text-muted-foreground">Os pedidos confirmados aparecem aqui.</p>
          </div>
        </>
      ) : (
        <>
          <div
            className={`mb-6 grid gap-4 ${stats.totalCents != null ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}
          >
            <Tile label="Pedidos" tone="bg-secondary text-secondary-foreground">
              <Counter value={stats.orders} />
            </Tile>
            <Tile label="Itens" tone="bg-accent text-accent-foreground">
              <Counter value={stats.items} />
            </Tile>
            <Tile label="Editados" tone="bg-card">
              <Counter value={stats.edited} />
            </Tile>
            {stats.totalCents != null && (
              <Tile
                label="Valor"
                tone="bg-card"
                sub={
                  <>
                    Recebido {formatBRL(stats.paidCents ?? 0)} · a receber{" "}
                    {formatBRL(stats.pendingCents ?? 0)}
                  </>
                }
              >
                <span className="text-4xl">{formatBRL(stats.totalCents)}</span>
              </Tile>
            )}
          </div>

          {changedAfterPrint.size > 0 && round.last_printed_at && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-foreground bg-accent p-3 text-accent-foreground"
            >
              <p className="text-sm font-bold">
                {changedAfterPrint.size === 1
                  ? "1 pedido mudou depois da última comanda impressa"
                  : `${changedAfterPrint.size} pedidos mudaram depois da última comanda impressa`}{" "}
                ({formatSaoPauloTime(round.last_printed_at)})
              </p>
              <button
                type="button"
                className={btnPlain}
                onClick={() => openPrint({ mode: "people", onlyChanged: true })}
              >
                <Printer className="h-4 w-4" aria-hidden /> Imprimir só os alterados
              </button>
            </div>
          )}
          <div className="mb-6 flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={() => openPrint()}>
              <Printer className="h-4 w-4" aria-hidden /> Imprimir comanda
            </button>
            <button className={btnPlain} onClick={run(() => exportPdf(round.name, orders))}>
              <FileText className="h-4 w-4" aria-hidden /> PDF
            </button>
            <button className={btnPlain} onClick={run(() => exportExcel(round.name, orders))}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
            </button>
            <button
              className={btnPlain}
              onClick={run(
                () => copyText(toText(round.name, orders)),
                "Copiado para a área de transferência",
              )}
            >
              <ClipboardCopy className="h-4 w-4" aria-hidden /> Copiar texto
            </button>
          </div>

          <section aria-label="Filtros" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <label htmlFor="f-search" className="sr-only">
                Buscar participante
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                id="f-search"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Buscar nome ou celular"
                className={`${field} pl-10`}
              />
            </div>
            <div>
              <label htmlFor="f-cat" className="sr-only">
                Categoria
              </label>
              <select
                id="f-cat"
                value={filters.category}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, category: e.target.value, productId: "" }))
                }
                className={field}
              >
                <option value="">Todas as categorias</option>
                {categories.map((c) => (
                  <option key={c ?? NO_CATEGORY} value={c ?? NO_CATEGORY}>
                    {c ?? "Sem categoria"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-prod" className="sr-only">
                Produto
              </label>
              <select
                id="f-prod"
                value={filters.productId}
                onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value }))}
                className={field}
              >
                <option value="">Todos os produtos</option>
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>
                    {p.product}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-2 border-foreground bg-card px-4">
              <input
                type="checkbox"
                checked={filters.editedOnly}
                onChange={(e) => setFilters((f) => ({ ...f, editedOnly: e.target.checked }))}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              <span className="text-sm font-semibold">Só pedidos editados</span>
            </label>
            {stats.totalCents != null && (
              <div>
                <label htmlFor="f-pay" className="sr-only">
                  Pagamento
                </label>
                <select
                  id="f-pay"
                  value={filters.payment}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      payment: e.target.value as OrderFilters["payment"],
                    }))
                  }
                  className={field}
                >
                  <option value="">Todos os pagamentos</option>
                  <option value="pending">A receber</option>
                  <option value="paid">Pagos</option>
                </select>
              </div>
            )}
          </section>

          <div
            role="group"
            aria-label="Visualização"
            className="mb-5 inline-flex rounded-full border-2 border-foreground bg-card p-1"
          >
            {(
              [
                ["participants", "Por participante"],
                ["totals", "Consolidado"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`min-h-10 rounded-full px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === v ? "bg-primary text-primary-foreground" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>

          {filtering && (
            <p className="mb-3 text-sm text-muted-foreground">
              {filtered.length} de {orders.length} pedido(s)
            </p>
          )}

          {round && <PendingCard round={round} />}

          {filtered.length === 0 ? (
            <div className="pop-card p-8 text-center">
              <h2 className="text-3xl">Nenhum pedido com esses filtros</h2>
              <button className={`${btnPlain} mt-4`} onClick={() => setFilters(emptyFilters)}>
                Limpar filtros
              </button>
            </div>
          ) : view === "participants" ? (
            <ul className="grid gap-4 md:grid-cols-2">
              {filtered.map((o, i) => (
                <ParticipantCard
                  key={o.order_id}
                  order={o}
                  index={i}
                  isNew={alerts.newIds.has(o.order_id)}
                  afterPrint={changedAfterPrint.get(o.order_id) ?? null}
                  onTogglePaid={() => void togglePaid(o)}
                  onReset={() => setResetFor(o)}
                />
              ))}
            </ul>
          ) : (
            <div className="space-y-4">
              {totals.map((c) => (
                <section
                  key={c.category ?? NO_CATEGORY}
                  aria-label={c.category ?? "Sem categoria"}
                  className="pop-card p-4"
                >
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-3xl">{c.category ?? "Sem categoria"}</h2>
                    <span className="text-sm font-bold text-muted-foreground">
                      {c.quantity} no total
                    </span>
                  </div>
                  <ul className="mt-3 space-y-3">
                    {c.products.map((p) => (
                      <li key={p.product_id}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{p.product}</span>
                          <span className="font-display text-3xl">{p.quantity}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <motion.div
                            className="h-full origin-left rounded-full bg-primary"
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: p.quantity / (c.products[0]?.quantity || 1) }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{p.people.join(", ")}</p>
                        {p.notes.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {p.notes.map((n, k) => (
                              <li key={k} className="text-xs font-semibold text-primary">
                                Obs.: {n.text}{" "}
                                <span className="text-muted-foreground">({n.person})</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {round && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} round={round} />}
      {round && <BoardLinkDialog open={boardOpen} onOpenChange={setBoardOpen} round={round} />}
      {round && (
        <PrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          round={round}
          orders={orders}
          preset={printPreset}
        />
      )}
      <ResetCodeFlow order={resetFor} onClose={() => setResetFor(null)} />
    </div>
  );
}

function ParticipantCard({
  order: o,
  index,
  isNew,
  afterPrint,
  onTogglePaid,
  onReset,
}: {
  order: RoundOrder;
  index: number;
  isNew: boolean;
  /** Mudou depois da última comanda impressa (novo ou editado), ou null. */
  afterPrint: "new" | "edited" | null;
  onTogglePaid: () => void;
  onReset: () => void;
}) {
  const reduce = useReducedMotion();
  const groups = groupByCategory(o.items);
  const value = orderValue(o);
  const changedAfterPay = !!o.paid_at && Date.parse(o.updated_at) > Date.parse(o.paid_at);
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.25) }}
      className={`pop-card p-4 ${isNew ? "ring-4 ring-primary/50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {isNew && (
            <span className="mb-1 inline-block rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-primary-foreground">
              Novo
            </span>
          )}
          <h3 className="truncate text-3xl">{o.participant}</h3>
          <p className="text-sm text-muted-foreground">{o.phone ?? "Sem celular"}</p>
        </div>
        {o.edited && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-foreground bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-foreground"
            title="Pedido alterado depois de confirmado"
          >
            <Pencil className="h-3 w-3" aria-hidden /> Editado {formatSaoPauloTime(o.updated_at)}
          </span>
        )}
      </div>
      {value != null && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-foreground px-3 py-2">
          <p className="text-sm font-bold">
            {formatBRL(value)}{" "}
            <span className={o.paid_at ? "text-primary" : "text-muted-foreground"}>
              {o.paid_at ? `· pago ${formatSaoPauloTime(o.paid_at)}` : "· a receber"}
            </span>
          </p>
          <button type="button" className={btnPlain} onClick={onTogglePaid}>
            {o.paid_at ? (
              <>
                <Undo2 className="h-4 w-4" aria-hidden /> Desfazer
              </>
            ) : (
              <>
                <BadgeCheck className="h-4 w-4" aria-hidden /> Marcar como pago
              </>
            )}
          </button>
          {changedAfterPay && (
            <p className="w-full text-xs font-bold text-destructive">
              O pedido mudou depois do pagamento: confira se o valor ainda confere.
            </p>
          )}
        </div>
      )}
      {o.done_at && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border-2 border-foreground bg-secondary px-2.5 py-0.5 text-xs font-bold text-secondary-foreground">
          <CheckCircle2 className="h-3 w-3" aria-hidden /> Concluído pelo estabelecimento{" "}
          {formatSaoPauloTime(o.done_at)}
          {Date.parse(o.updated_at) > Date.parse(o.done_at) && " · mudou depois"}
        </p>
      )}
      {afterPrint && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border-2 border-foreground px-2.5 py-0.5 text-xs font-bold">
          <Printer className="h-3 w-3" aria-hidden /> {afterPrint === "new" ? "Novo" : "Alterado"}{" "}
          após a impressão
        </p>
      )}
      <div className="mt-3 space-y-2">
        {groups.map((g) => (
          <div key={g.category ?? NO_CATEGORY}>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {g.category ?? "Sem categoria"}
            </p>
            <ul className="text-sm">
              {g.items.map((it) => (
                <li key={it.product_id} className="py-0.5">
                  <div className="flex justify-between gap-2">
                    <span>{it.product}</span>
                    <span className="font-bold">{it.quantity}x</span>
                  </div>
                  {it.note && <p className="text-xs font-semibold text-primary">Obs.: {it.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {o.phone && (
        <button
          onClick={onReset}
          className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <KeyRound className="h-4 w-4" aria-hidden /> Redefinir código de recuperação
        </button>
      )}
    </motion.li>
  );
}

/** Confirma, gera o código novo e o mostra uma única vez para o organizador repassar. */
function ResetCodeFlow({ order, onClose }: { order: RoundOrder | null; onClose: () => void }) {
  const reset = useServerFn(resetParticipantCode);
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => setConfirmOpen(order !== null), [order]);

  const generate = async () => {
    if (!order) return;
    setConfirmOpen(false);
    try {
      const r = await reset({ data: { participantId: order.participant_id } });
      setName(order.participant);
      setCode(r.code);
    } catch (e) {
      toast.error(errMsg(e));
      onClose();
    }
  };
  const done = () => {
    setCode(null);
    setCopied(false);
    onClose();
  };

  return (
    <>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o && code === null) onClose();
        }}
        title={`Redefinir o código de ${order?.participant ?? ""}?`}
        description="O código atual deixa de funcionar. Confirme que é mesmo a pessoa (por exemplo, ligando para o celular dela) antes de passar o novo código."
        confirmLabel="Gerar novo código"
        onConfirm={() => void generate()}
      />
      <Dialog open={code !== null} onOpenChange={(o) => !o && done()}>
        <DialogContent className="rounded-3xl border-2 border-foreground bg-background shadow-pop-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-4xl font-normal">
              Novo código de {name}
            </DialogTitle>
            <DialogDescription>
              Ele só aparece agora. Passe para a pessoa e peça que o guarde.
            </DialogDescription>
          </DialogHeader>
          <p className="select-all rounded-2xl border-2 border-dashed border-foreground bg-accent px-4 py-5 text-center font-mono text-3xl font-bold tracking-widest text-accent-foreground">
            {code}
          </p>
          <div className="flex gap-2">
            <button
              className={`${btnPlain} flex-1`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(code ?? "");
                  setCopied(true);
                } catch {
                  toast.error("Não foi possível copiar. Anote o código.");
                }
              }}
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}{" "}
              {copied ? "Copiado!" : "Copiar"}
            </button>
            <button className={`${btnPrimary} flex-1`} onClick={done}>
              Pronto
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
