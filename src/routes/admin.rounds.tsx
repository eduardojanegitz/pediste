import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Lock, Play, RotateCcw, Save, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import { ScheduleFields } from "@/features/admin/ScheduleFields";
import { ShareDialog } from "@/features/admin/ShareDialog";
import { btnPlain, btnPrimary, errMsg, field } from "@/features/admin/ui";
import { formatSaoPaulo } from "@/lib/format";
import {
  closeRound,
  listRounds,
  openRound,
  reopenRound,
  updateRoundSchedule,
  type Round,
  type RoundState,
} from "@/lib/orders.functions";
import { copySchedule, isoToSpLocal, spLocalToIso } from "@/lib/schedule";

const roundsQuery = queryOptions({
  queryKey: ["rounds"],
  queryFn: () => listRounds(),
  refetchInterval: 30_000,
});

export const Route = createFileRoute("/admin/rounds")({
  head: () => ({ meta: [{ title: "Rodadas — PedeAí!" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(roundsQuery),
  pendingComponent: () => <div className="h-40 animate-pulse rounded-3xl bg-muted" />,
  component: RoundsPage,
});

const STATE: Record<RoundState, { label: string; cls: string }> = {
  waiting: { label: "Aguardando abertura", cls: "bg-accent text-accent-foreground" },
  open: { label: "Aberta", cls: "bg-primary text-primary-foreground" },
  closed: { label: "Encerrada", cls: "bg-muted text-foreground" },
};

function StateBadge({ state }: { state: RoundState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border-2 border-foreground px-3 py-0.5 text-xs font-bold ${STATE[state].cls}`}
    >
      {STATE[state].label}
    </span>
  );
}

/** Converte os campos (hora de Brasília) em horários ISO; devolve erro amigável se algo estiver inválido. */
function readSchedule(
  opens: string,
  closes: string,
): { opensAt: string | null; closesAt: string | null } | string {
  const opensAt = opens ? spLocalToIso(opens) : null;
  const closesAt = closes ? spLocalToIso(closes) : null;
  if (opens && !opensAt) return "Abertura inválida.";
  if (closes && !closesAt) return "Encerramento inválido.";
  if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) {
    return "O encerramento precisa ser depois da abertura.";
  }
  return { opensAt, closesAt };
}

function RoundsPage() {
  const { data: rounds } = useSuspenseQuery(roundsQuery);
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["rounds"] });
    void qc.invalidateQueries({ queryKey: ["active-round"] });
  };
  const open = useServerFn(openRound);
  const close = useServerFn(closeRound);
  const saveSchedule = useServerFn(updateRoundSchedule);
  const reopen = useServerFn(reopenRound);

  const current = rounds.find((r) => r.status === "open");
  const [name, setName] = useState("");
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [reopening, setReopening] = useState<Round | null>(null);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    const s = readSchedule(opens, closes);
    if (typeof s === "string") return void toast.error(s);
    void run(() => open({ data: { name, schedule: s } }), "Rodada criada!").then(() => {
      setName("");
      setOpens("");
      setCloses("");
    });
  };

  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Painel
      </p>
      <h1 className="mb-6 text-6xl text-primary">Rodadas</h1>

      {current ? (
        <CurrentRound
          key={`${current.id}-${current.opens_at}-${current.closes_at}`}
          round={current}
          busy={busy}
          reduce={reduce ?? false}
          onSave={(opensV, closesV) => {
            const s = readSchedule(opensV, closesV);
            if (typeof s === "string") return void toast.error(s);
            void run(
              () => saveSchedule({ data: { id: current.id, schedule: s } }),
              "Horários salvos",
            );
          }}
          onClose={() => setConfirmClose(true)}
          onReopen={() => setReopening(current)}
        />
      ) : (
        <form onSubmit={submitNew} className="pop-card mb-8 space-y-4 p-5 sm:p-6">
          <h2 className="text-4xl">Abrir nova rodada</h2>
          <p className="text-sm text-muted-foreground">
            Só uma rodada pode ficar aberta por vez. Sem horários, os pedidos abrem agora e só
            encerram quando você encerrar.
          </p>
          {rounds.length > 0 && (
            <div>
              <label htmlFor="r-copy" className="mb-1 block text-sm font-bold">
                Copiar de uma rodada anterior
              </label>
              <select
                id="r-copy"
                value=""
                onChange={(e) => {
                  const src = rounds.find((r) => r.id === e.target.value);
                  if (!src) return;
                  const s = copySchedule(src);
                  setName(src.name);
                  setOpens(s.opens);
                  setCloses(s.closes);
                  toast.success(`Copiado de “${src.name}”. Confira os horários e abra.`);
                }}
                className={field}
              >
                <option value="">Escolher…</option>
                {rounds.slice(0, 10).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.closes_at ? ` · encerrava ${formatSaoPaulo(r.closes_at)}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Traz o nome e os horários para hoje (ou amanhã, se o horário de hoje já passou). O
                cardápio é o mesmo de sempre.
              </p>
            </div>
          )}
          <div>
            <label htmlFor="r-name" className="mb-1 block text-sm font-bold">
              Nome
            </label>
            <input
              id="r-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Ex.: Almoço de sexta"
              className={field}
            />
          </div>
          <ScheduleFields
            idPrefix="new"
            opens={opens}
            closes={closes}
            onOpens={setOpens}
            onCloses={setCloses}
          />
          <button disabled={busy || !name.trim()} className={btnPrimary}>
            <Play className="h-4 w-4" aria-hidden /> {opens ? "Agendar rodada" : "Abrir agora"}
          </button>
        </form>
      )}

      <h2 className="mb-3 mt-8 text-3xl">Histórico</h2>
      {rounds.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma rodada ainda.</p>
      ) : (
        <ul className="space-y-2">
          {rounds.map((r) => (
            <li
              key={r.id}
              className="pop-card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {r.name} <StateBadge state={r.state} />
                </p>
                <p className="text-sm text-muted-foreground">
                  {r.opens_at
                    ? `Abre ${formatSaoPaulo(r.opens_at)}`
                    : `Criada ${formatSaoPaulo(r.opened_at)}`}
                  {r.closes_at ? ` · encerra ${formatSaoPaulo(r.closes_at)}` : ""}
                  {r.closed_at ? ` · encerrada ${formatSaoPaulo(r.closed_at)}` : ""}
                </p>
              </div>
              {r.state === "closed" && r.id !== current?.id && (
                <button className={btnPlain} onClick={() => setReopening(r)} disabled={busy}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Reabrir
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={`Encerrar “${current?.name ?? ""}” agora?`}
        description="Ninguém poderá mais fazer, editar ou cancelar pedidos. Você pode reabrir depois."
        confirmLabel="Encerrar agora"
        onConfirm={() => {
          setConfirmClose(false);
          if (current) void run(() => close({ data: { id: current.id } }), "Rodada encerrada");
        }}
      />
      <ReopenDialog
        round={reopening}
        busy={busy}
        onClose={() => setReopening(null)}
        onConfirm={(closesAt) => {
          const r = reopening;
          if (!r) return;
          void run(() => reopen({ data: { id: r.id, closesAt } }), "Rodada reaberta").then(() =>
            setReopening(null),
          );
        }}
      />
    </div>
  );
}

function CurrentRound({
  round,
  busy,
  reduce,
  onSave,
  onClose,
  onReopen,
}: {
  round: Round;
  busy: boolean;
  reduce: boolean;
  onSave: (opens: string, closes: string) => void;
  onClose: () => void;
  onReopen: () => void;
}) {
  const [opens, setOpens] = useState(isoToSpLocal(round.opens_at));
  const [closes, setCloses] = useState(isoToSpLocal(round.closes_at));
  const [shareOpen, setShareOpen] = useState(false);
  const dirty = opens !== isoToSpLocal(round.opens_at) || closes !== isoToSpLocal(round.closes_at);
  // Encerrada pelo horário mas ainda marcada como aberta: oferece reabrir com novo horário.
  const expired = round.state === "closed";
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label="Rodada atual"
      className="pop-card mb-8 space-y-4 bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Rodada atual
          </p>
          <h2 className="text-5xl">{round.name}</h2>
          <p className="mt-1">
            <StateBadge state={round.state} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!expired && (
            <button className={btnPrimary} onClick={() => setShareOpen(true)}>
              <Share2 className="h-4 w-4" aria-hidden /> Compartilhar
            </button>
          )}
          {expired ? (
            <button className={btnPrimary} onClick={onReopen} disabled={busy}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Reabrir
            </button>
          ) : (
            <button
              className={`${btnPlain} bg-foreground text-background`}
              onClick={onClose}
              disabled={busy}
            >
              <Lock className="h-4 w-4" aria-hidden /> Encerrar agora
            </button>
          )}
        </div>
      </div>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} round={round} />
      <ScheduleFields
        idPrefix="cur"
        opens={opens}
        closes={closes}
        onOpens={setOpens}
        onCloses={setCloses}
      />
      <button className={btnPlain} onClick={() => onSave(opens, closes)} disabled={busy || !dirty}>
        <Save className="h-4 w-4" aria-hidden /> Salvar horários
      </button>
    </motion.section>
  );
}

function ReopenDialog({
  round,
  busy,
  onClose,
  onConfirm,
}: {
  round: Round | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (closesAt: string | null) => void;
}) {
  const [closes, setCloses] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={round !== null}
      onOpenChange={(o) => {
        if (!o) {
          setCloses("");
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="rounded-3xl border-2 border-foreground bg-background shadow-pop-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-4xl font-normal">
            Reabrir “{round?.name}”
          </DialogTitle>
          <DialogDescription>
            Escolha até quando os pedidos ficam abertos, ou deixe em branco para encerrar
            manualmente.
          </DialogDescription>
        </DialogHeader>
        <ScheduleFields
          idPrefix="reopen"
          showOpens={false}
          opens=""
          closes={closes}
          onOpens={() => {}}
          onCloses={setCloses}
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className={btnPlain} onClick={onClose}>
            Cancelar
          </button>
          <button
            className={btnPrimary}
            disabled={busy}
            onClick={() => {
              const iso = closes ? spLocalToIso(closes) : null;
              if (closes && !iso) {
                setError("Encerramento inválido.");
                return;
              }
              if (iso && Date.parse(iso) <= Date.now()) {
                setError("Escolha um horário no futuro.");
                return;
              }
              setError(null);
              onConfirm(iso);
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Reabrir
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
