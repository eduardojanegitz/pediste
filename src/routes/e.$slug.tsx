import { createFileRoute } from "@tanstack/react-router";
import { ParticipantPage } from "@/features/order/ParticipantPage";

/** Pedido de um estabelecimento específico: /e/<apelido>. O endereço `/` abre o estabelecimento padrão. */
export const Route = createFileRoute("/e/$slug")({
  head: () => ({
    meta: [
      { title: "Pediste — Faça seu pedido" },
      { name: "description", content: "Escolha seus itens no cardápio e confirme seu pedido." },
    ],
  }),
  component: EstablishmentPage,
});

function EstablishmentPage() {
  const { slug } = Route.useParams();
  return <ParticipantPage slug={slug} />;
}
