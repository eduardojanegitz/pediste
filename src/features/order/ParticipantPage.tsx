import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { getMenu } from "@/lib/catalog.functions";
import { getEstablishment } from "@/lib/establishment.functions";
import { getMyOrder, getActiveRound, type ActiveRound } from "@/lib/orders.functions";
import { getToken } from "@/lib/participant";
import { OrderSuccess, type SuccessItem } from "./OrderSuccess";
import { ConfirmedOrder } from "./ConfirmedOrder";
import { IdentifyScreen } from "./IdentifyScreen";
import { OrderFlow } from "./OrderFlow";
import { Shell } from "./Shell";
import {
  ClosedScreen,
  EstablishmentNotFoundScreen,
  NoRoundScreen,
  WaitingScreen,
} from "./StatusScreens";
import { btnPrimary } from "./ui";

// As chaves incluem o apelido do estabelecimento ("" = padrão); invalidar por prefixo continua valendo.
const menuQuery = (slug: string | undefined) =>
  queryOptions({
    queryKey: ["menu", slug ?? ""],
    queryFn: () => getMenu({ data: { ...(slug ? { slug } : {}) } }),
    staleTime: 60_000,
  });
const roundQuery = (slug: string | undefined) =>
  queryOptions({
    queryKey: ["active-round", slug ?? ""],
    queryFn: () => getActiveRound({ data: { ...(slug ? { slug } : {}) } }),
    refetchInterval: 30_000,
  });
const establishmentQuery = (slug: string | undefined) =>
  queryOptions({
    queryKey: ["establishment", slug ?? ""],
    queryFn: () => getEstablishment({ data: { ...(slug ? { slug } : {}) } }),
    staleTime: 5 * 60_000,
  });

function Loading() {
  return (
    <Shell>
      <Logo className="text-6xl" />
      <div
        role="status"
        className="mt-6 flex items-center justify-center gap-2 text-muted-foreground"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Carregando o cardápio…
      </div>
    </Shell>
  );
}

/** Página do participante. `slug` ausente = estabelecimento padrão (endereço `/`); senão `/e/<apelido>`. */
export function ParticipantPage({ slug }: { slug?: string | undefined }) {
  const est = useQuery(establishmentQuery(slug));
  const round = useQuery({ ...roundQuery(slug), enabled: !!est.data });
  const refetchRound = useCallback(() => void round.refetch(), [round]);

  if (est.isPending) return <Loading />;
  if (est.data === null) return <EstablishmentNotFoundScreen />;
  if (!est.isError && round.isPending) return <Loading />;
  if (est.isError || round.isError) {
    return (
      <Shell>
        <Logo className="text-6xl" />
        <h1 className="mt-6 text-4xl">Ops, sem conexão</h1>
        <p className="mt-3 text-muted-foreground">
          Não foi possível carregar o cardápio. Verifique sua internet.
        </p>
        <button className={`${btnPrimary} mt-6`} onClick={refetchRound}>
          Tentar de novo
        </button>
      </Shell>
    );
  }
  if (!round.data) return <NoRoundScreen establishmentName={est.data?.name} />;
  return (
    <Participant
      round={round.data}
      slug={slug}
      fetchedAt={round.dataUpdatedAt}
      refetchRound={refetchRound}
    />
  );
}

/** Decide a tela do participante: estado da rodada, identificação, pedido existente ou jornada de escolha. */
function Participant({
  round,
  slug,
  fetchedAt,
  refetchRound,
}: {
  round: ActiveRound;
  slug: string | undefined;
  fetchedAt: number;
  refetchRound: () => void;
}) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => setToken(getToken()), []);

  const me = useQuery({
    queryKey: ["my-order", token, round.id],
    queryFn: () => getMyOrder({ data: { token: token!, roundId: round.id } }),
    enabled: !!token,
  });
  const menu = useQuery({ ...menuQuery(slug), enabled: round.state === "open" || !!me.data });

  const [editing, setEditing] = useState(false);
  const [celebrate, setCelebrate] = useState<{ update: boolean; items: SuccessItem[] } | null>(
    null,
  );
  const [lastWasUpdate, setLastWasUpdate] = useState(false);

  if (token === undefined || (token && me.isPending)) return <Loading />;

  const identified = !!token && !!me.data && !me.isError;
  const confirmed = identified && me.data?.status === "confirmed";

  // Fora do horário: só quem já tem pedido confirmado vê o pedido; os demais veem a tela do estado.
  if (round.state !== "open" && !(confirmed && round.state === "closed")) {
    return round.state === "waiting" ? (
      <WaitingScreen round={round} fetchedAt={fetchedAt} onOpen={refetchRound} />
    ) : (
      <ClosedScreen round={round} />
    );
  }

  if (!identified) {
    return (
      <IdentifyScreen
        roundName={round.name}
        onDone={(t) => {
          setToken(t);
          void qc.invalidateQueries({ queryKey: ["my-order"] });
        }}
      />
    );
  }

  if (menu.isPending) return <Loading />;
  if (menu.isError || !menu.data) {
    return (
      <Shell>
        <h1 className="text-4xl">Não foi possível carregar o cardápio</h1>
        <button className={`${btnPrimary} mt-6`} onClick={() => void menu.refetch()}>
          Tentar de novo
        </button>
      </Shell>
    );
  }
  const data = me.data!;

  return (
    <>
      {celebrate && (
        <OrderSuccess
          variant={celebrate.update ? "updated" : "created"}
          items={celebrate.items}
          token={token!}
          roundId={round.id}
          onView={() => setCelebrate(null)}
          onEdit={() => {
            setCelebrate(null);
            setEditing(true);
          }}
        />
      )}
      {confirmed && !editing ? (
        <ConfirmedOrder
          round={round}
          token={token!}
          me={data}
          menu={menu.data}
          canEdit={round.state === "open"}
          justUpdated={lastWasUpdate}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <OrderFlow
          key={data.participant.id}
          round={round}
          token={token!}
          me={data}
          menu={menu.data}
          existing={confirmed}
          onExit={() => setEditing(false)}
          onSaved={({ isUpdate, items }) => {
            setLastWasUpdate(isUpdate);
            setEditing(false);
            setCelebrate({ update: isUpdate, items });
          }}
        />
      )}
    </>
  );
}
