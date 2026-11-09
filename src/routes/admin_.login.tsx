import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getAdminSession } from "@/lib/auth.functions";
import { authErrorKind, friendlyLoginError, safeAdminRedirect } from "@/lib/admin-auth";
import { Logo } from "@/components/brand/Logo";

type LoginSearch = { redirect?: string | undefined; reason?: "expired" | "forbidden" | undefined };

// Rota "admin_": URL /admin/login, mas fora do layout protegido de /admin.
export const Route = createFileRoute("/admin_/login")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): LoginSearch => ({
    redirect: typeof s["redirect"] === "string" ? s["redirect"] : undefined,
    reason: s["reason"] === "expired" || s["reason"] === "forbidden" ? s["reason"] : undefined,
  }),
  head: () => ({
    meta: [{ title: "Entrar — Pediste" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async ({ search }) => {
    // Quem já tem sessão de admin válida vai direto ao painel.
    if (search.reason) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    try {
      await getAdminSession();
    } catch {
      return;
    }
    throw redirect({ to: "/admin" });
  },
  component: LoginPage,
});

const notices: Record<NonNullable<LoginSearch["reason"]>, string> = {
  expired: "Sua sessão expirou. Entre novamente para continuar.",
  forbidden: "Esta conta não tem acesso ao painel.",
};

function LoginPage() {
  const { redirect: redirectTo, reason } = Route.useSearch();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(reason ? notices[reason] : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state !== "idle") return;
    setError(null);
    setState("loading");
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      setError(friendlyLoginError(authError));
      setState("idle");
      return;
    }
    try {
      await getAdminSession(); // confirma no servidor que é administrador
    } catch (err) {
      await supabase.auth.signOut();
      setError(authErrorKind(err) ? notices.forbidden : friendlyLoginError(err));
      setState("idle");
      return;
    }
    setState("done");
    const target = safeAdminRedirect(redirectTo);
    setTimeout(() => router.history.push(target), reduce ? 0 : 700);
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Painel da marca (somente telas largas) */}
      <aside
        className="relative hidden overflow-hidden border-r-[2.5px] border-foreground bg-primary lg:block"
        aria-hidden
      >
        <motion.div
          className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-accent"
          initial={reduce ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 110, damping: 14 }}
        />
        <motion.div
          className="absolute -bottom-24 -left-16 h-72 w-72 rounded-[4rem] bg-secondary"
          initial={reduce ? false : { scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 12 }}
          transition={{ type: "spring", stiffness: 90, damping: 12, delay: 0.1 }}
        />
        <div className="relative z-10 flex h-full flex-col justify-center px-16">
          <div className="pop-card inline-block self-start bg-card px-8 py-6">
            <Logo className="text-8xl" />
          </div>
          <p className="mt-8 max-w-sm text-2xl font-semibold leading-snug text-primary-foreground">
            Cardápio, pedidos e rodadas num só lugar.
          </p>
        </div>
      </aside>

      <section className="flex items-center justify-center px-5 py-12">
        <motion.div
          className="w-full max-w-sm"
          initial={reduce ? false : { y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 18 }}
        >
          <div className="mb-8 lg:hidden">
            <Logo className="text-7xl" />
          </div>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            <LockKeyhole className="h-4 w-4" aria-hidden /> Área do administrador
          </p>
          <h1 className="mt-2 text-6xl">Entrar</h1>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-bold">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
                className="w-full rounded-2xl border-2 border-foreground bg-card px-4 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-bold">
                Senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? "login-error" : undefined}
                  className="w-full rounded-2xl border-2 border-foreground bg-card py-3 pl-4 pr-14 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={show}
                  className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {error && (
                <motion.p
                  id="login-error"
                  role="alert"
                  initial={reduce ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-2xl border-2 border-destructive bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={state !== "idle" || !email.trim() || !password}
              className="pop-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-foreground bg-primary px-5 py-3 text-lg font-bold text-primary-foreground shadow-pop disabled:opacity-60"
            >
              {state === "loading" && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
              {state === "done" && <Check className="h-5 w-5" aria-hidden />}
              {state === "idle" ? "Entrar" : state === "loading" ? "Entrando…" : "Tudo certo!"}
            </button>
          </form>
          <p className="mt-6 text-sm text-muted-foreground">
            O acesso é restrito. Participantes não precisam de conta: basta abrir o cardápio.
          </p>
        </motion.div>
      </section>
    </main>
  );
}
