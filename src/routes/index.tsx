import { createFileRoute } from "@tanstack/react-router";
import { ParticipantPage } from "@/features/order/ParticipantPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pediste — Faça seu pedido" },
      { name: "description", content: "Escolha seus itens no cardápio e confirme seu pedido." },
      { property: "og:title", content: "Pediste — Faça seu pedido" },
      {
        property: "og:description",
        content: "Escolha seus itens no cardápio e confirme seu pedido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <ParticipantPage />;
}
