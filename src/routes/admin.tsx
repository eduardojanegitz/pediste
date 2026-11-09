import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getAdminSession } from "@/lib/auth.functions";
import { authErrorKind } from "@/lib/admin-auth";
import { Logo } from "@/components/brand/Logo";
import {
  EstablishmentProvider,
  EstablishmentSwitcher,
} from "@/features/admin/EstablishmentProvider";

export const Route = createFileRoute("/admin")({
  // O painel não precisa de SSR: a sessão vive no navegador e a guarda roda lá.
  // A segurança real está nas funções de servidor (requireAdmin), não aqui.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Painel — PedeAí!" },
      { name: "description", content: "Gerencie produtos, rodadas e pedidos do cardápio." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/admin/login", search: { redirect: location.pathname } });
    }
    try {
      const me = await getAdminSession();
      return { adminEmail: me.email, isSuper: me.isSuper, establishments: me.establishments };
    } catch (e) {
      const kind = authErrorKind(e);
      if (!kind) throw e; // falha de rede etc.: mostra a tela de erro, sem deslogar
      await supabase.auth.signOut();
      throw redirect({ to: "/admin/login", search: { redirect: location.pathname, reason: kind } });
    }
  },
  component: AdminLayout,
});

const tabs = [
  { to: "/admin", label: "Cardápio", exact: true },
  { to: "/admin/rounds", label: "Rodadas", exact: false },
  { to: "/admin/orders", label: "Pedidos", exact: false },
  { to: "/admin/reports", label: "Relatórios", exact: false },
  { to: "/admin/settings", label: "Ajustes", exact: false },
] as const;

/** Abas só do super administrador (o servidor também confere; esconder aqui é só conforto). */
const superTabs = [
  { to: "/admin/establishments", label: "Estabelecimentos", exact: false },
  { to: "/admin/health", label: "Saúde", exact: false },
] as const;

function AdminLayout() {
  const { adminEmail, isSuper, establishments } = Route.useRouteContext();
  const router = useRouter();
  const qc = useQueryClient();
  const leaving = useRef(false);
  const [signingOut, setSigningOut] = useState(false);

  // Sessão expirada ou revogada (outra aba, token vencido): volta ao login.
  useEffect(() => {
    const expire = (reason: "expired" | "forbidden") => {
      if (leaving.current) return;
      leaving.current = true;
      void supabase.auth.signOut().finally(() => {
        qc.clear();
        void router.navigate({ to: "/admin/login", search: { reason } });
      });
    };
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") expire("expired");
    });
    const unsub = qc.getQueryCache().subscribe((ev) => {
      if (ev.type === "updated" && ev.action.type === "error") {
        const kind = authErrorKind(ev.action.error);
        if (kind) expire(kind);
      }
    });
    return () => {
      data.subscription.unsubscribe();
      unsub();
    };
  }, [qc, router]);

  const logout = async () => {
    leaving.current = true;
    setSigningOut(true);
    await supabase.auth.signOut();
    qc.clear();
    await router.navigate({ to: "/admin/login" });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Logo className="text-5xl" animate={false} />
        <div className="flex items-center gap-3">
          {adminEmail && (
            <span className="hidden text-sm text-muted-foreground sm:inline">{adminEmail}</span>
          )}
          <button
            onClick={logout}
            disabled={signingOut}
            className="pop-press inline-flex items-center gap-2 rounded-full border-2 border-foreground bg-card px-4 py-2 text-sm font-bold shadow-pop disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" aria-hidden /> {signingOut ? "Saindo…" : "Sair"}
          </button>
        </div>
      </header>
      <nav
        aria-label="Seções do painel"
        className="-mx-1 mb-6 flex gap-3 overflow-x-auto px-1 pb-2 pt-1"
      >
        {[...tabs, ...(isSuper ? superTabs : [])].map((t) => (
          <Link
            key={t.to}
            to={t.to}
            activeOptions={{ exact: t.exact }}
            className="pop-press shrink-0 whitespace-nowrap rounded-full border-2 border-foreground bg-card px-5 py-2 font-bold shadow-pop"
            activeProps={{ className: "bg-primary text-primary-foreground" }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <EstablishmentProvider establishments={establishments} isSuper={isSuper}>
        <EstablishmentSwitcher />
        <Outlet />
      </EstablishmentProvider>
    </main>
  );
}
