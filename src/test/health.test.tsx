import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HealthView } from "@/features/admin/HealthView";
import {
  subjectLooksPlaceholder,
  summarizeHealth,
  type HealthCheck,
  type HealthReport,
} from "@/lib/health";
import { PROBES, runHealthChecks } from "@/lib/health.server";
import { bytesToB64u, vapidSelfTest } from "@/lib/webpush.server";

const getHealth = vi.fn();
vi.mock("@/lib/health.functions", () => ({ getSystemHealth: () => getHealth() }));

describe("regras puras", () => {
  const c = (status: HealthCheck["status"]): HealthCheck => ({
    id: status,
    group: "Uso",
    label: status,
    status,
    detail: "",
  });
  it("resume e escolhe o pior estado", () => {
    expect(summarizeHealth([c("ok"), c("ok")])).toMatchObject({
      ok: 2,
      warn: 0,
      fail: 0,
      overall: "ok",
    });
    expect(summarizeHealth([c("ok"), c("warn")]).overall).toBe("warn");
    expect(summarizeHealth([c("warn"), c("fail"), c("ok")])).toMatchObject({
      overall: "fail",
      fail: 1,
    });
    expect(summarizeHealth([]).overall).toBe("ok");
  });
  it("reconhece contato do VAPID de exemplo ou inválido", () => {
    expect(subjectLooksPlaceholder(undefined)).toBe(true);
    expect(subjectLooksPlaceholder("")).toBe(true);
    expect(subjectLooksPlaceholder("mailto:seu-email@exemplo.com")).toBe(true);
    expect(subjectLooksPlaceholder("mailto:admin@pedeai.local")).toBe(true);
    expect(subjectLooksPlaceholder("joao@empresa.com.br")).toBe(true); // sem mailto:
    expect(subjectLooksPlaceholder("mailto:ti@empresa.com.br")).toBe(false);
    expect(subjectLooksPlaceholder("https://empresa.com.br/contato")).toBe(false);
  });
});

async function newKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: bytesToB64u(raw), privateKey: jwk.d as string };
}

describe("vapidSelfTest", () => {
  it("aceita o par certo e recusa chaves de pares diferentes ou lixo", async () => {
    const a = await newKeys();
    const b = await newKeys();
    expect(await vapidSelfTest({ ...a, subject: "mailto:a@b.com" })).toBeNull();
    expect(
      await vapidSelfTest({ publicKey: a.publicKey, privateKey: b.privateKey, subject: "x" }),
    ).toMatch(/não combina/);
    expect(
      await vapidSelfTest({ publicKey: "abc", privateKey: a.privateKey, subject: "x" }),
    ).toMatch(/formato/);
    expect(
      await vapidSelfTest({ publicKey: a.publicKey, privateKey: "%%%", subject: "x" }),
    ).toMatch(/inválido|formato/);
  });
});

/** Banco falso: tabelas/colunas "ausentes" respondem com erro; o resto responde vazio. */
function fakeDb(opts: {
  missing?: string[]; // ids das sondas que falham (tabela.coluna ou nome da função)
  admins?: { user_id: string; is_super: boolean }[];
  links?: { admin_id: string }[];
  pixCount?: number;
}) {
  const missing = new Set(opts.missing ?? []);
  const tableData: Record<string, unknown[]> = {
    admins: opts.admins ?? [{ user_id: "a1", is_super: true }],
    admin_establishments: opts.links ?? [{ admin_id: "a1" }],
    establishments: [{ id: "e1" }],
  };
  const thenable = (table: string, column?: string) => {
    const rows = tableData[table] ?? [];
    const result = (): { data: unknown[]; error: unknown; count: number } => {
      const key = column ? `${table}.${column}` : table;
      const bad = missing.has(key) || missing.has(table);
      return {
        data: rows,
        error: bad ? { message: "missing" } : null,
        count: table === "admin_settings" ? (opts.pixCount ?? 0) : rows.length,
      };
    };
    const q: Record<string, unknown> = {
      limit: () => Promise.resolve(result()),
      not: () => Promise.resolve(result()),
      then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
    };
    return q;
  };
  return {
    from: (table: string) => ({
      select: (column?: string) => thenable(table, column?.includes(",") ? undefined : column),
    }),
    rpc: (fn: string) =>
      Promise.resolve({ error: missing.has(fn) ? { message: "missing" } : null }),
  } as never;
}

const byId = (checks: HealthCheck[], id: string) => checks.find((c) => c.id === id)!;
const okEnv = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "k",
  SUPABASE_PUBLISHABLE_KEY: "p",
  RECOVERY_PEPPER: "pimenta",
};
const signupFetch = (disable: boolean) =>
  (async () =>
    new Response(JSON.stringify({ disable_signup: disable }), {
      status: 200,
    })) as unknown as typeof fetch;

describe("runHealthChecks", () => {
  it("tudo certo: nenhuma falha e nenhum segredo nas mensagens", async () => {
    const keys = await newKeys();
    const checks = await runHealthChecks({
      db: fakeDb({ pixCount: 1 }),
      env: {
        ...okEnv,
        ...{
          VAPID_PUBLIC_KEY: keys.publicKey,
          VAPID_PRIVATE_KEY: keys.privateKey,
          VAPID_SUBJECT: "mailto:ti@empresa.com.br",
        },
      },
      fetchImpl: signupFetch(true),
    });
    expect(summarizeHealth(checks)).toMatchObject({ fail: 0, warn: 0, overall: "ok" });
    expect(checks.filter((c) => c.group === "Banco de dados")).toHaveLength(PROBES.length);
    const text = JSON.stringify(checks);
    expect(text).not.toContain(keys.privateKey);
    expect(text).not.toContain("pimenta");
  });

  it("migração ausente vira falha com o nome do arquivo", async () => {
    const checks = await runHealthChecks({
      db: fakeDb({ missing: ["order_items.unit_price_cents", "find_user_id_by_email"] }),
      env: okEnv,
      fetchImpl: signupFetch(true),
    });
    const price = byId(checks, "m-price");
    expect(price.status).toBe("fail");
    expect(price.fix).toContain("20261109000400_order_item_price.sql");
    expect(byId(checks, "m-find").status).toBe("fail");
    expect(byId(checks, "m-notes").status).toBe("ok");
  });

  it("VAPID: ausente = atenção; metade = falha; par errado = falha; contato de exemplo = atenção", async () => {
    const a = await newKeys();
    const b = await newKeys();
    const run = (env: Record<string, string>) =>
      runHealthChecks({ db: fakeDb({}), env: { ...okEnv, ...env }, fetchImpl: signupFetch(true) });
    expect(byId(await run({}), "vapid").status).toBe("warn");
    expect(byId(await run({ VAPID_PUBLIC_KEY: a.publicKey }), "vapid").status).toBe("fail");
    expect(
      byId(await run({ VAPID_PUBLIC_KEY: a.publicKey, VAPID_PRIVATE_KEY: b.privateKey }), "vapid")
        .status,
    ).toBe("fail");
    const good = await run({
      VAPID_PUBLIC_KEY: a.publicKey,
      VAPID_PRIVATE_KEY: a.privateKey,
      VAPID_SUBJECT: "mailto:seu-email@exemplo.com",
    });
    expect(byId(good, "vapid").status).toBe("ok");
    expect(byId(good, "vapid-subject").status).toBe("warn");
  });

  it("segurança: cadastro público ligado ou consulta falhando = atenção; sem pepper = atenção", async () => {
    const env = { ...okEnv, RECOVERY_PEPPER: "" };
    const on = await runHealthChecks({ db: fakeDb({}), env, fetchImpl: signupFetch(false) });
    expect(byId(on, "signup").status).toBe("warn");
    expect(byId(on, "pepper").status).toBe("warn");
    const boom = await runHealthChecks({
      db: fakeDb({}),
      env: okEnv,
      fetchImpl: (async () => {
        throw new Error("rede");
      }) as unknown as typeof fetch,
    });
    expect(byId(boom, "signup").status).toBe("warn");
    const off = await runHealthChecks({ db: fakeDb({}), env: okEnv, fetchImpl: signupFetch(true) });
    expect(byId(off, "signup").status).toBe("ok");
  });

  it("uso: sem Pix = atenção; sem super = falha; admin comum sem estabelecimento = atenção", async () => {
    const checks = await runHealthChecks({
      db: fakeDb({
        pixCount: 0,
        admins: [
          { user_id: "a1", is_super: false },
          { user_id: "a2", is_super: false },
        ],
        links: [{ admin_id: "a1" }],
      }),
      env: okEnv,
      fetchImpl: signupFetch(true),
    });
    expect(byId(checks, "pix").status).toBe("warn");
    expect(byId(checks, "supers").status).toBe("fail");
    expect(byId(checks, "stranded").detail).toContain("1 administrador");
  });
});

const REPORT: HealthReport = {
  generatedAt: "2026-11-09T15:00:00Z",
  checks: [
    {
      id: "a",
      group: "Banco de dados",
      label: "Preço guardado no pedido",
      status: "fail",
      detail: "Não encontrada no banco.",
      fix: "Aplique a migração X.",
    },
    {
      id: "b",
      group: "Servidor",
      label: "Chaves VAPID",
      status: "ok",
      detail: "Chaves válidas.",
      fix: "não deve aparecer",
    },
    {
      id: "c",
      group: "Segurança",
      label: "Cadastro público",
      status: "warn",
      detail: "Está ligado.",
      fix: "Desligue.",
    },
  ],
};

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HealthView />
    </QueryClientProvider>,
  );

describe("HealthView", () => {
  beforeEach(() => getHealth.mockReset());

  it("mostra o resumo, os grupos e só orienta o que não está ok", async () => {
    getHealth.mockResolvedValue(REPORT);
    wrap();
    expect(await screen.findByText("Há itens que precisam de correção.")).toBeInTheDocument();
    expect(screen.getByText(/1 ok · 1 atenção · 1 falha/)).toBeInTheDocument();
    expect(screen.getByText("Banco de dados")).toBeInTheDocument();
    expect(screen.getByText("Preço guardado no pedido")).toBeInTheDocument();
    expect(screen.getByText(/Aplique a migração X/)).toBeInTheDocument();
    expect(screen.getByText(/Desligue\./)).toBeInTheDocument();
    expect(screen.queryByText(/não deve aparecer/)).toBeNull();
    expect(screen.queryByText("Uso")).toBeNull(); // grupo sem itens some
  });

  it("tudo ok mostra a mensagem positiva", async () => {
    getHealth.mockResolvedValue({ ...REPORT, checks: [REPORT.checks[1]!] });
    wrap();
    expect(await screen.findByText("Tudo certo com a configuração.")).toBeInTheDocument();
  });

  it("erro oferece tentar de novo e 'verificar de novo' consulta outra vez", async () => {
    getHealth.mockRejectedValueOnce(new Error("x"));
    wrap();
    expect(await screen.findByText("Não foi possível verificar agora")).toBeInTheDocument();
    getHealth.mockResolvedValue(REPORT);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Há itens que precisam de correção.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Verificar de novo/ }));
    await vi.waitFor(() => expect(getHealth).toHaveBeenCalledTimes(3));
  });
});
