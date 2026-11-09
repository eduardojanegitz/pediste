import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/export";
import { getPendingParticipants } from "@/lib/orders.functions";
import { applyName, countdownText, reminderTemplate, whatsappToLink } from "./reminder";
import { loadPublicUrl } from "./share";
import { btnPlain, btnPrimary, field } from "./ui";

type PendingRound = { id: string; name: string; state: string; closes_at: string | null };

/** "Quem ainda não pediu": lista de quem já pediu antes e não pediu nesta rodada, com lembrete por WhatsApp. */
export function PendingCard({ round, path = "" }: { round: PendingRound; path?: string }) {
  const open = round.state === "open";
  const q = useQuery({
    queryKey: ["pending-participants", round.id],
    queryFn: () => getPendingParticipants({ data: { roundId: round.id } }),
    enabled: open,
    refetchInterval: 30_000,
  });

  // Diferença entre o relógio do servidor e o deste aparelho, para a contagem regressiva.
  const offset = useMemo(
    () => (q.data ? Date.parse(q.data.now) - Date.now() : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.dataUpdatedAt],
  );
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [open]);
  const left = countdownText(round.closes_at, tick + offset);

  const [link, setLink] = useState("");
  const [template, setTemplate] = useState("");
  const [edited, setEdited] = useState(false);
  const [reminded, setReminded] = useState<Set<string>>(new Set());
  const [showMsg, setShowMsg] = useState(false);

  useEffect(() => {
    setLink((loadPublicUrl() ?? window.location.origin) + path);
  }, [path]);
  useEffect(() => {
    if (!edited)
      setTemplate(reminderTemplate({ roundName: round.name, link, closesAt: round.closes_at }));
  }, [edited, round.name, round.closes_at, link]);
  useEffect(() => {
    setReminded(new Set());
    setEdited(false);
  }, [round.id]);

  if (!open || !q.data) return null;
  const people = q.data.people;
  if (people.length === 0 && !left) return null;
  const todo = people.filter((p) => !reminded.has(p.id));

  const remind = (id: string) => {
    const p = people.find((x) => x.id === id);
    if (!p) return;
    const url = whatsappToLink(p.phoneE164, applyName(template, p.name));
    if (!url) return void toast.error("Celular inválido para WhatsApp.");
    window.open(url, "_blank", "noopener,noreferrer");
    setReminded((s) => new Set(s).add(id));
  };

  return (
    <section aria-label="Quem ainda não pediu" className="pop-card mb-5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-3xl">
          Quem ainda não pediu{people.length > 0 && ` (${people.length})`}
        </h2>
        {left && (
          <span className="flex items-center gap-1 text-sm font-bold">
            <Clock className="h-4 w-4" aria-hidden /> Encerra em {left}
          </span>
        )}
      </div>
      {people.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Todo mundo que já pediu antes está nesta rodada.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Pessoas com celular que pediram em rodadas anteriores. O lembrete abre o seu WhatsApp
            com a mensagem pronta: quem envia é você.
          </p>
          <ul className="mt-3 divide-y-2 divide-foreground/10">
            {people.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.phone}</span>
                </span>
                <button
                  type="button"
                  onClick={() => remind(p.id)}
                  className={reminded.has(p.id) ? btnPlain : btnPrimary}
                >
                  {reminded.has(p.id) ? (
                    <>
                      <Check className="h-4 w-4" aria-hidden /> Lembrado
                    </>
                  ) : (
                    <>
                      <MessageCircle className="h-4 w-4" aria-hidden /> Lembrar
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {todo.length > 0 && (
              <button type="button" className={btnPlain} onClick={() => remind(todo[0]!.id)}>
                <MessageCircle className="h-4 w-4" aria-hidden /> Lembrar o próximo ({todo.length}{" "}
                restantes)
              </button>
            )}
            <button type="button" className={btnPlain} onClick={() => setShowMsg((v) => !v)}>
              Editar mensagem
            </button>
            <button
              type="button"
              className={btnPlain}
              onClick={async () => {
                try {
                  await copyText(template.replaceAll("{nome}", "").replace("Oi, !", "Oi!"));
                  toast.success("Mensagem copiada");
                } catch {
                  toast.error("Não foi possível copiar");
                }
              }}
            >
              <Copy className="h-4 w-4" aria-hidden /> Copiar mensagem
            </button>
          </div>
          {showMsg && (
            <div className="mt-3">
              <label htmlFor="reminder-msg" className="text-sm font-bold">
                Mensagem ({"{nome}"} vira o primeiro nome)
              </label>
              <textarea
                id="reminder-msg"
                rows={5}
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  setEdited(true);
                }}
                className={`${field} mt-1`}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
