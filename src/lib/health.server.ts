import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { subjectLooksPlaceholder, type HealthCheck, type HealthStatus } from "@/lib/health";
import { vapidSelfTest } from "@/lib/webpush.server";

type Db = SupabaseClient<Database>;
type Deps = {
  db: Db;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

/** Uma consulta de teste: a tabela/coluna (ou função) existe? Só olha a estrutura, nunca dados de pessoas. */
type Probe = {
  id: string;
  migration: string;
  label: string;
  run: (db: Db) => Promise<{ error: unknown }>;
};

const col = (table: string, column: string) => (db: Db) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).from(table).select(column).limit(1) as Promise<{ error: unknown }>;
const rpc = (fn: string, args: Record<string, unknown>) => (db: Db) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).rpc(fn, args) as Promise<{ error: unknown }>;

const NIL = "00000000-0000-0000-0000-000000000000";

/** Cada migração do app e uma sonda que prova que ela foi aplicada. */
export const PROBES: Probe[] = [
  {
    id: "m-v2-categories",
    migration: "20261104000100 a 20261104000500",
    label: "Regras de categoria (mín./máx.)",
    run: col("categories", "min_select"),
  },
  {
    id: "m-v2-phone",
    migration: "20261104000100 a 20261104000500",
    label: "Celular do participante",
    run: col("participants", "phone_e164"),
  },
  {
    id: "m-v2-schedule",
    migration: "20261104000100 a 20261104000500",
    label: "Horários da rodada",
    run: col("rounds", "opens_at"),
  },
  {
    id: "m-v2-limits",
    migration: "20261104000100 a 20261104000500",
    label: "Limite de requisições",
    run: col("rate_limits", "key"),
  },
  {
    id: "m-notes",
    migration: "20261106000100_order_item_notes.sql",
    label: "Observação por item",
    run: col("order_items", "note"),
  },
  {
    id: "m-printed",
    migration: "20261106000200_round_last_printed.sql",
    label: "Controle de comanda impressa",
    run: col("rounds", "last_printed_at"),
  },
  {
    id: "m-pix",
    migration: "20261106000300_pix_payments.sql",
    label: "Pix e pagamento",
    run: col("admin_settings", "pix_key"),
  },
  {
    id: "m-board",
    migration: "20261106000400_board_links.sql",
    label: "Link do estabelecimento",
    run: col("board_links", "token_hash"),
  },
  {
    id: "m-done",
    migration: "20261106000500_order_done.sql",
    label: "Pedido concluído",
    run: col("orders", "done_at"),
  },
  {
    id: "m-push",
    migration: "20261107000100_push_subscriptions.sql",
    label: "Inscrições de aviso no celular",
    run: col("push_subscriptions", "endpoint"),
  },
  {
    id: "m-est",
    migration: "20261109000100_establishments.sql",
    label: "Estabelecimentos e administradores",
    run: col("establishments", "slug"),
  },
  {
    id: "m-active",
    migration: "20261109000200_active_round_by_establishment.sql",
    label: "Rodada atual por estabelecimento",
    run: rpc("get_active_round_for", { p_establishment: NIL }),
  },
  {
    id: "m-find",
    migration: "20261109000300_find_user_by_email.sql",
    label: "Liberar administrador por e-mail",
    run: rpc("find_user_id_by_email", { p_email: "" }),
  },
  {
    id: "m-price",
    migration: "20261109000400_order_item_price.sql",
    label: "Preço guardado no pedido",
    run: col("order_items", "unit_price_cents"),
  },
];

const mk = (
  group: HealthCheck["group"],
  id: string,
  label: string,
  status: HealthStatus,
  detail: string,
  fix?: string,
): HealthCheck => ({ id, group, label, status, detail, fix });

/** Roda todas as verificações. Nunca lança: cada uma que falhar vira um item "fail" ou "warn". */
export async function runHealthChecks({
  db,
  env,
  fetchImpl = fetch,
}: Deps): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  // ---- Banco de dados: migrações aplicadas
  const probed = await Promise.all(
    PROBES.map(async (p) => {
      try {
        const { error } = await p.run(db);
        return { p, ok: !error };
      } catch {
        return { p, ok: false };
      }
    }),
  );
  for (const { p, ok } of probed) {
    checks.push(
      ok
        ? mk("Banco de dados", p.id, p.label, "ok", "Aplicada.")
        : mk(
            "Banco de dados",
            p.id,
            p.label,
            "fail",
            "Não encontrada no banco.",
            `Aplique a migração ${p.migration} no SQL Editor do Supabase (veja o README, seção Banco de dados).`,
          ),
    );
  }

  // ---- Servidor: variáveis de ambiente
  const has = (k: string) => !!env[k];
  checks.push(
    has("SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY")
      ? mk("Servidor", "env-supabase", "Conexão com o Supabase", "ok", "Variáveis configuradas.")
      : mk(
          "Servidor",
          "env-supabase",
          "Conexão com o Supabase",
          "fail",
          "Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.",
          "Defina-as nas variáveis do servidor (Vercel > Settings > Environment Variables) e faça um novo deploy.",
        ),
  );

  const vapidPub = env["VAPID_PUBLIC_KEY"];
  const vapidPriv = env["VAPID_PRIVATE_KEY"];
  if (!vapidPub && !vapidPriv) {
    checks.push(
      mk(
        "Servidor",
        "vapid",
        "Aviso no celular (chaves VAPID)",
        "warn",
        'Não configurado: o botão "Avisar no celular" não aparece para os participantes.',
        "Rode `node scripts/gen-vapid.mjs` e defina VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT no servidor; depois faça um novo deploy.",
      ),
    );
  } else if (!vapidPub || !vapidPriv) {
    checks.push(
      mk(
        "Servidor",
        "vapid",
        "Aviso no celular (chaves VAPID)",
        "fail",
        `Só uma das chaves está definida (falta ${vapidPub ? "VAPID_PRIVATE_KEY" : "VAPID_PUBLIC_KEY"}).`,
        "Defina as duas, geradas juntas pelo mesmo `node scripts/gen-vapid.mjs`.",
      ),
    );
  } else {
    const err = await vapidSelfTest({
      publicKey: vapidPub,
      privateKey: vapidPriv,
      subject: env["VAPID_SUBJECT"] ?? "",
    });
    checks.push(
      err
        ? mk(
            "Servidor",
            "vapid",
            "Aviso no celular (chaves VAPID)",
            "fail",
            `Chaves inválidas: ${err}.`,
            "Gere um par novo com `node scripts/gen-vapid.mjs`, defina as duas variáveis e faça um novo deploy (quem já ativou o aviso precisa ativar de novo).",
          )
        : mk(
            "Servidor",
            "vapid",
            "Aviso no celular (chaves VAPID)",
            "ok",
            "Chaves válidas e combinam entre si.",
          ),
    );
    checks.push(
      subjectLooksPlaceholder(env["VAPID_SUBJECT"])
        ? mk(
            "Servidor",
            "vapid-subject",
            "Contato do aviso (VAPID_SUBJECT)",
            "warn",
            "Ausente ou com valor de exemplo. O iPhone pode recusar o aviso.",
            "Defina VAPID_SUBJECT com o seu e-mail real, no formato mailto:voce@seudominio.com.br.",
          )
        : mk("Servidor", "vapid-subject", "Contato do aviso (VAPID_SUBJECT)", "ok", "Definido."),
    );
  }

  // ---- Segurança
  checks.push(
    has("RECOVERY_PEPPER")
      ? mk(
          "Segurança",
          "pepper",
          "Segredo dos códigos de recuperação",
          "ok",
          "RECOVERY_PEPPER definido.",
        )
      : mk(
          "Segurança",
          "pepper",
          "Segredo dos códigos de recuperação",
          "warn",
          "Sem RECOVERY_PEPPER: usa a chave de serviço do Supabase (trocar essa chave invalidaria os códigos já emitidos).",
          "Defina RECOVERY_PEPPER com um texto longo e aleatório (opcional, recomendado).",
        ),
  );

  // Cadastro público de usuários (deveria estar desligado).
  const base = env["SUPABASE_URL"]?.replace(/\/+$/, "");
  const anon = env["SUPABASE_PUBLISHABLE_KEY"];
  if (base && anon) {
    try {
      const res = await fetchImpl(`${base}/auth/v1/settings`, {
        headers: { apikey: anon },
        signal: AbortSignal.timeout(5000),
      });
      const j = (await res.json()) as { disable_signup?: boolean };
      checks.push(
        j.disable_signup === true
          ? mk(
              "Segurança",
              "signup",
              "Cadastro público de usuários",
              "ok",
              "Desligado: ninguém cria conta sozinho.",
            )
          : mk(
              "Segurança",
              "signup",
              "Cadastro público de usuários",
              "warn",
              "Está ligado: qualquer pessoa pode criar uma conta no Supabase (ela não vira administradora, mas convém desligar).",
              'No Supabase: Authentication > Sign In / Providers > Email > desligue "Allow new users to sign up".',
            ),
      );
    } catch {
      checks.push(
        mk(
          "Segurança",
          "signup",
          "Cadastro público de usuários",
          "warn",
          "Não foi possível consultar a configuração do Supabase.",
          "Confira manualmente em Authentication > Sign In / Providers > Email.",
        ),
      );
    }
  } else {
    checks.push(
      mk(
        "Segurança",
        "signup",
        "Cadastro público de usuários",
        "warn",
        "Sem SUPABASE_PUBLISHABLE_KEY no servidor, não dá para conferir.",
        "Confira manualmente em Authentication > Sign In / Providers > Email.",
      ),
    );
  }

  // ---- Uso
  const tryCount = async (fn: () => PromiseLike<{ count: number | null; error: unknown }>) => {
    try {
      const r = await fn();
      return r.error ? null : (r.count ?? 0);
    } catch {
      return null;
    }
  };
  const pix = await tryCount(() =>
    db
      .from("admin_settings")
      .select("admin_id", { count: "exact", head: true })
      .not("pix_key", "is", null),
  );
  checks.push(
    pix === null
      ? mk("Uso", "pix", "Chave Pix", "warn", "Não foi possível verificar.")
      : pix > 0
        ? mk("Uso", "pix", "Chave Pix", "ok", `${pix} organizador(es) com Pix cadastrado.`)
        : mk(
            "Uso",
            "pix",
            "Chave Pix",
            "warn",
            "Nenhum organizador cadastrou a chave Pix: os participantes não verão o pagamento.",
            "Cadastre em Ajustes e faça o teste de R$ 1,00.",
          ),
  );

  try {
    const [{ data: admins }, { data: links }, { data: ests }] = await Promise.all([
      db.from("admins").select("user_id, is_super"),
      db.from("admin_establishments").select("admin_id"),
      db.from("establishments").select("id"),
    ]);
    const linked = new Set((links ?? []).map((l) => l.admin_id));
    const stranded = (admins ?? []).filter((a) => !a.is_super && !linked.has(a.user_id)).length;
    const supers = (admins ?? []).filter((a) => a.is_super).length;
    checks.push(
      supers === 0
        ? mk(
            "Uso",
            "supers",
            "Super administrador",
            "fail",
            "Nenhum super administrador: ninguém consegue criar estabelecimentos nem liberar acessos.",
            "No SQL Editor: UPDATE public.admins SET is_super = true WHERE user_id = '<id do usuário>';",
          )
        : mk(
            "Uso",
            "supers",
            "Super administrador",
            "ok",
            `${supers} super administrador(es), ${(ests ?? []).length} estabelecimento(s).`,
          ),
    );
    if (stranded > 0)
      checks.push(
        mk(
          "Uso",
          "stranded",
          "Administradores sem estabelecimento",
          "warn",
          `${stranded} administrador(es) comum(ns) sem nenhum estabelecimento liberado: eles entram no painel e não veem nada.`,
          "Em Estabelecimentos, libere o acesso pelo e-mail.",
        ),
      );
  } catch {
    checks.push(mk("Uso", "supers", "Administradores", "warn", "Não foi possível verificar."));
  }

  const subs = await tryCount(() =>
    db.from("push_subscriptions").select("id", { count: "exact", head: true }),
  );
  if (subs !== null)
    checks.push(mk("Uso", "subs", "Aparelhos com aviso ativado", "ok", `${subs} aparelho(s).`));

  return checks;
}
