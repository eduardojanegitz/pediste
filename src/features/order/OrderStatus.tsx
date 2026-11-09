import { useEffect, useRef, useState } from "react";
import { BellOff, BellRing, CheckCircle2, ChefHat, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { PROGRESS_LABEL, type OrderProgress } from "@/lib/order-status";
import { getPushConfig, removePushSubscription, savePushSubscription } from "@/lib/push.functions";
import {
  currentSubscription,
  missingPushParts,
  pushSupport,
  subscribePush,
  unsubscribePush,
  type PushSupport,
} from "@/lib/push-client";
import { playReadyAlert } from "./readyAlert";
import { useMyStatus } from "./useMyStatus";

const STEPS: { key: OrderProgress; icon: typeof CheckCircle2 }[] = [
  { key: "received", icon: CheckCircle2 },
  { key: "preparing", icon: ChefHat },
  { key: "ready", icon: PackageCheck },
];

type PushState =
  | "loading"
  | "unsupported"
  | "noserver"
  | "error"
  | "needs-install"
  | "denied"
  | "off"
  | "on"
  | "busy";

/** Card de status do pedido + botão para ser avisado no celular quando ficar pronto. */
export function OrderStatus({ token, roundId }: { token: string; roundId: string }) {
  const { data } = useMyStatus(token, roundId);
  const progress = data && data.state !== "none" ? data.state : null;
  const prev = useRef<OrderProgress | null>(null);

  // Quando vira "pronto" com a página aberta: som, vibração e título da aba.
  useEffect(() => {
    if (!progress) return;
    if (progress === "ready" && prev.current && prev.current !== "ready") playReadyAlert();
    prev.current = progress;
  }, [progress]);
  useEffect(() => {
    if (progress !== "ready") return;
    const old = document.title;
    document.title = "Pedido pronto! · Pediste";
    return () => {
      document.title = old;
    };
  }, [progress]);

  if (!progress) return null;
  const idx = STEPS.findIndex((s) => s.key === progress);
  const ready = progress === "ready";

  return (
    <section
      aria-label="Status do pedido"
      aria-live="polite"
      className={`pop-card mt-5 p-4 ${ready ? "bg-secondary text-secondary-foreground" : ""}`}
    >
      <h2 className="text-3xl">{ready ? "Seu pedido está pronto!" : "Status do pedido"}</h2>
      <ol className="mt-3 flex items-start justify-between gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const reached = i <= idx;
          return (
            <li
              key={s.key}
              aria-current={i === idx ? "step" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 text-center text-sm font-bold ${reached ? "" : "opacity-40"}`}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-foreground ${reached ? "bg-primary text-primary-foreground" : "bg-card"}`}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              {PROGRESS_LABEL[s.key]}
            </li>
          );
        })}
      </ol>
      {!ready && <PushToggle token={token} />}
    </section>
  );
}

function PushToggle({ token }: { token: string }) {
  const [state, setState] = useState<PushState>("loading");
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const sup: PushSupport = pushSupport();
      if (sup === "unsupported") return alive && setState("unsupported");
      try {
        const cfg = await getPushConfig();
        if (!cfg.publicKey) return alive && setState("noserver");
        if (!alive) return;
        setKey(cfg.publicKey);
        if (sup === "needs-install") return setState("needs-install");
        if (Notification.permission === "denied") return setState("denied");
        const sub = await currentSubscription();
        if (alive) setState(sub && Notification.permission === "granted" ? "on" : "off");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enable = async () => {
    if (!key) return;
    setState("busy");
    const r = await subscribePush(key);
    if (!r.ok) {
      setState(r.reason === "denied" ? "denied" : "off");
      if (r.reason === "failed") toast.error("Não foi possível ativar o aviso neste aparelho.");
      return;
    }
    try {
      const saved = await savePushSubscription({ data: { token, endpoint: r.endpoint } });
      if (!saved.ok) throw new Error("save");
      setState("on");
      toast.success("Pronto! Avisaremos quando o pedido ficar pronto.");
    } catch {
      setState("off");
      toast.error("Não foi possível ativar o aviso. Tente de novo.");
    }
  };

  const disable = async () => {
    setState("busy");
    try {
      const endpoint = await unsubscribePush();
      if (endpoint) await removePushSubscription({ data: { token, endpoint } });
    } catch {
      /* a inscrição local já foi removida; o servidor limpa quando o serviço responder "expirada" */
    }
    setState("off");
  };

  if (state === "loading") return null;
  const base = "mt-4 flex items-center gap-2 text-sm font-medium";
  if (state === "unsupported" || state === "noserver" || state === "error") {
    const why =
      state === "noserver"
        ? "o servidor ainda não tem as chaves de aviso"
        : state === "error"
          ? "não foi possível consultar o servidor"
          : `este navegador não oferece o recurso (${missingPushParts().join(", ") || "desconhecido"}). No iPhone é preciso iOS 16.4 ou mais novo e abrir o app pela tela inicial; evite abrir por dentro de outros aplicativos`;
    return (
      <p className={base}>
        <BellOff className="h-4 w-4 shrink-0" aria-hidden /> Aviso no celular indisponível: {why}.
      </p>
    );
  }
  if (state === "needs-install")
    return (
      <p className={base}>
        <BellOff className="h-4 w-4 shrink-0" aria-hidden /> Para receber aviso no iPhone, toque em
        Compartilhar e “Adicionar à Tela de Início”, e abra o Pediste por lá.
      </p>
    );
  if (state === "denied")
    return (
      <p className={base}>
        <BellOff className="h-4 w-4 shrink-0" aria-hidden /> As notificações estão bloqueadas neste
        navegador. Libere nas configurações do site para ser avisado.
      </p>
    );
  const on = state === "on";
  return (
    <button
      type="button"
      disabled={state === "busy"}
      aria-pressed={on}
      onClick={() => void (on ? disable() : enable())}
      className="pop-press mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-foreground bg-card px-4 py-2 text-sm font-bold shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      {on ? (
        <>
          <BellRing className="h-4 w-4" aria-hidden /> Aviso ativado · desativar
        </>
      ) : (
        <>
          <BellRing className="h-4 w-4" aria-hidden /> Avisar no celular quando ficar pronto
        </>
      )}
    </button>
  );
}
