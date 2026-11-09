import { createFileRoute } from "@tanstack/react-router";
import { BoardPage } from "@/features/board/BoardPage";

// Página pública (sem login) acessada por link secreto: não indexar e não vazar o endereço via Referer.
export const Route = createFileRoute("/comanda/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Comanda ao vivo — Pediste" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: Page,
});

function Page() {
  const { token } = Route.useParams();
  return <BoardPage token={token} />;
}
