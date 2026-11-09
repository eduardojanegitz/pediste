import { useEffect, useState } from "react";
import { CalendarClock, Moon } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { formatCountdown, formatSaoPaulo, formatSaoPauloTime } from "@/lib/format";
import type { ActiveRound } from "@/lib/orders.functions";
import { Shell } from "./Shell";

export function NoRoundScreen({ establishmentName }: { establishmentName?: string | undefined }) {
  return (
    <Shell>
      <Logo className="text-7xl" />
      <h1 className="mt-6 text-4xl">Ainda sem pedidos por aqui</h1>
      <p className="mt-3 text-muted-foreground">
        {establishmentName
          ? `Nenhuma rodada de ${establishmentName} está aberta no momento. Volte em breve!`
          : "Nenhuma rodada está aberta no momento. Volte em breve!"}
      </p>
    </Shell>
  );
}

/** Endereço com apelido que não existe (link digitado errado ou estabelecimento removido). */
export function EstablishmentNotFoundScreen() {
  return (
    <Shell>
      <Logo className="text-7xl" />
      <h1 className="mt-6 text-4xl">Estabelecimento não encontrado</h1>
      <p className="mt-3 text-muted-foreground">
        Confira o link que você recebeu ou peça um novo ao organizador.
      </p>
    </Shell>
  );
}

/** Aguardando abertura: contagem regressiva pelo relógio do SERVIDOR (não do aparelho). */
export function WaitingScreen({
  round,
  fetchedAt,
  onOpen,
}: {
  round: ActiveRound;
  fetchedAt: number;
  onOpen: () => void;
}) {
  const offset = Date.parse(round.server_now) - fetchedAt;
  const target = round.opens_at ? Date.parse(round.opens_at) : null;
  const [left, setLeft] = useState(() => (target ? target - (Date.now() + offset) : 0));

  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const ms = target - (Date.now() + offset);
      setLeft(ms);
      if (ms <= 0) onOpen();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [target, offset, onOpen]);

  return (
    <Shell>
      <Logo className="text-7xl" />
      <div className="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-full border-2 border-foreground bg-accent shadow-pop">
        <CalendarClock className="h-7 w-7" aria-hidden />
      </div>
      <h1 className="mt-5 text-5xl">Já já abre!</h1>
      <p className="mt-3 text-muted-foreground">
        O cardápio de <strong>{round.name}</strong> ainda não abriu para pedidos.
      </p>
      {round.opens_at && (
        <>
          <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Abre {formatSaoPaulo(round.opens_at)}
          </p>
          <p
            className="mt-1 font-display text-6xl tabular-nums text-primary"
            role="timer"
            aria-label={`Faltam ${formatCountdown(left)}`}
          >
            {formatCountdown(left)}
          </p>
        </>
      )}
    </Shell>
  );
}

export function ClosedScreen({ round }: { round: ActiveRound }) {
  return (
    <Shell>
      <Logo className="text-7xl" />
      <div className="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-full border-2 border-foreground bg-muted shadow-pop">
        <Moon className="h-7 w-7" aria-hidden />
      </div>
      <h1 className="mt-5 text-5xl">Pedidos encerrados!</h1>
      <p className="mt-3 text-muted-foreground">
        Os pedidos de <strong>{round.name}</strong> já foram encerrados
        {round.closes_at ? ` (às ${formatSaoPauloTime(round.closes_at)})` : ""}. Obrigado por
        participar!
      </p>
    </Shell>
  );
}
