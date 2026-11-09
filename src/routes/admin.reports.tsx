import { createFileRoute } from "@tanstack/react-router";
import { ReportView } from "@/features/admin/ReportView";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [{ title: "Relatórios — Pediste" }, { name: "robots", content: "noindex" }],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <div>
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Painel
        </p>
        <h1 className="text-6xl text-primary">Relatórios</h1>
      </header>
      <ReportView />
    </div>
  );
}
