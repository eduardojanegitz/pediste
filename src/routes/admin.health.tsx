import { createFileRoute } from "@tanstack/react-router";
import { HealthView } from "@/features/admin/HealthView";

export const Route = createFileRoute("/admin/health")({
  head: () => ({
    meta: [{ title: "Saúde — Pediste" }, { name: "robots", content: "noindex" }],
  }),
  component: HealthPage,
});

function HealthPage() {
  const { isSuper } = Route.useRouteContext();
  return (
    <div>
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Painel
        </p>
        <h1 className="text-6xl text-primary">Saúde</h1>
      </header>
      {isSuper ? (
        <HealthView />
      ) : (
        <div role="alert" className="pop-card p-8 text-center">
          <h2 className="text-3xl">Só para o super administrador</h2>
        </div>
      )}
    </div>
  );
}
