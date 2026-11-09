import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { PixSettingsForm } from "@/features/admin/PixSettings";
import { getPixSettings } from "@/lib/pix.functions";

const settingsQuery = queryOptions({ queryKey: ["pix-settings"], queryFn: () => getPixSettings() });

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Ajustes — Pediste" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  pendingComponent: () => <div className="h-40 animate-pulse rounded-3xl bg-muted" />,
  component: SettingsPage,
});

function SettingsPage() {
  const { data } = useSuspenseQuery(settingsQuery);
  return (
    <div>
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Painel
        </p>
        <h1 className="text-6xl text-primary">Ajustes</h1>
      </header>
      <PixSettingsForm settings={data.settings} audit={data.audit} />
    </div>
  );
}
