import { createFileRoute } from "@tanstack/react-router";
import { EstablishmentsView } from "@/features/admin/EstablishmentsView";

export const Route = createFileRoute("/admin/establishments")({
  head: () => ({
    meta: [{ title: "Estabelecimentos — Pediste" }, { name: "robots", content: "noindex" }],
  }),
  component: EstablishmentsPage,
});

function EstablishmentsPage() {
  const { isSuper } = Route.useRouteContext();
  return (
    <div>
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Painel
        </p>
        <h1 className="text-6xl text-primary">Estabelecimentos</h1>
      </header>
      {isSuper ? (
        <EstablishmentsView />
      ) : (
        <div role="alert" className="pop-card p-8 text-center">
          <h2 className="text-3xl">Só para o super administrador</h2>
          <p className="mt-2 text-muted-foreground">
            Peça a um super administrador para criar estabelecimentos ou liberar acessos.
          </p>
        </div>
      )}
    </div>
  );
}
