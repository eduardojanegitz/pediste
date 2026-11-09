import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EstablishmentProvider,
  EstablishmentSwitcher,
} from "@/features/admin/EstablishmentProvider";
import { pickEstablishment, useEstablishment } from "@/features/admin/establishment-context";
import type { AdminEstablishment } from "@/lib/auth.functions";
import {
  assertEstablishment,
  canAccessEstablishment,
  FORBIDDEN_ESTABLISHMENT,
  slugify,
  SLUG_RE,
  type AdminScope,
} from "@/lib/scope";
import {
  assertCategoriesAccess,
  assertCategoryAccess,
  assertOrderAccess,
  assertProductAccess,
  assertProductsAccess,
  assertRoundAccess,
} from "@/lib/scope.server";

const scope = (ids: string[], isSuper = false): AdminScope => ({
  adminId: "a",
  isSuper,
  establishmentIds: ids,
});

describe("escopo: regras puras", () => {
  it("acessa só os estabelecimentos listados", () => {
    expect(canAccessEstablishment(scope(["e1"]), "e1")).toBe(true);
    expect(canAccessEstablishment(scope(["e1"]), "e2")).toBe(false);
    expect(canAccessEstablishment(scope([]), "e1")).toBe(false);
  });
  it("recusa com mensagem Forbidden", () => {
    expect(() => assertEstablishment(scope(["e1"]), "e2")).toThrow(FORBIDDEN_ESTABLISHMENT);
    expect(() => assertEstablishment(scope(["e1"]), "e1")).not.toThrow();
  });
  it("slugify gera apelidos válidos", () => {
    expect(slugify("Padaria do Zé!")).toBe("padaria-do-ze");
    expect(slugify("  Café & Cia  ")).toBe("cafe-cia");
    expect(slugify("???")).toBe("estabelecimento");
    expect(slugify("a".repeat(80))).toHaveLength(40);
    for (const n of ["Padaria do Zé!", "Café & Cia", "123", "A  B"]) {
      expect(SLUG_RE.test(slugify(n))).toBe(true);
    }
  });
});

/** Banco falso: devolve a linha configurada por tabela, ignorando filtros (o que importa aqui é a checagem). */
function fakeDb(tables: Record<string, unknown>) {
  const chain = (rows: unknown) => {
    const arr = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      in: () => Promise.resolve({ data: arr }),
      maybeSingle: () => Promise.resolve({ data: arr[0] ?? null }),
    };
    return q;
  };
  return { from: (t: string) => chain(tables[t]) } as never;
}

describe("escopo: ajudantes do servidor", () => {
  it("rodada de outro estabelecimento é recusada; a do próprio passa", async () => {
    const db = fakeDb({ rounds: { establishment_id: "e2" } });
    await expect(assertRoundAccess(db, scope(["e1"]), "r")).rejects.toThrow("Forbidden");
    await expect(assertRoundAccess(db, scope(["e2"]), "r")).resolves.toBe("e2");
  });
  it("rodada inexistente é 'não encontrado' (não vaza se existe)", async () => {
    await expect(assertRoundAccess(fakeDb({}), scope(["e1"]), "r")).rejects.toThrow(
      "Não encontrado",
    );
  });
  it("categoria e produto seguem o estabelecimento da categoria", async () => {
    const cat = fakeDb({ categories: { establishment_id: "e2" } });
    await expect(assertCategoryAccess(cat, scope(["e1"]), "c")).rejects.toThrow("Forbidden");
    await expect(assertCategoryAccess(cat, scope(["e2"]), "c")).resolves.toBe("e2");
    const prod = fakeDb({ products: { categories: { establishment_id: "e2" } } });
    await expect(assertProductAccess(prod, scope(["e1"]), "p")).rejects.toThrow("Forbidden");
    await expect(assertProductAccess(prod, scope(["e2"]), "p")).resolves.toBe("e2");
    // produto sem categoria não tem dono: ninguém mexe por aqui
    const orphan = fakeDb({ products: { categories: null } });
    await expect(assertProductAccess(orphan, scope(["e1"]), "p")).rejects.toThrow("Não encontrado");
  });
  it("reordenar: todos os ids precisam existir e ser acessíveis", async () => {
    const rows = [
      { id: "1", establishment_id: "e1" },
      { id: "2", establishment_id: "e2" },
    ];
    const db = fakeDb({ categories: rows });
    await expect(assertCategoriesAccess(db, scope(["e1"]), ["1", "2"])).rejects.toThrow(
      "Forbidden",
    );
    await expect(
      assertCategoriesAccess(db, scope(["e1", "e2"]), ["1", "2"]),
    ).resolves.toBeUndefined();
    await expect(assertCategoriesAccess(db, scope(["e1", "e2"]), ["1", "2", "3"])).rejects.toThrow(
      "Não encontrado",
    );
    const prods = fakeDb({
      products: [
        { id: "1", categories: { establishment_id: "e1" } },
        { id: "2", categories: null },
      ],
    });
    await expect(assertProductsAccess(prods, scope(["e1"]), ["1", "2"])).rejects.toThrow(
      "Não encontrado",
    );
  });
  it("pedido segue a rodada dele", async () => {
    const db = fakeDb({ orders: { round_id: "r" }, rounds: { establishment_id: "e2" } });
    await expect(assertOrderAccess(db, scope(["e1"]), "o")).rejects.toThrow("Forbidden");
    await expect(assertOrderAccess(db, scope(["e2"]), "o")).resolves.toBe("e2");
  });
});

const E: AdminEstablishment[] = [
  { id: "e1", name: "Padrão", slug: "padrao", isDefault: true },
  { id: "e2", name: "Padaria", slug: "padaria", isDefault: false },
];

describe("estabelecimento escolhido no painel", () => {
  beforeEach(() => localStorage.clear());

  it("usa o salvo se ainda é do administrador, senão o padrão, senão o primeiro", () => {
    expect(pickEstablishment(E, "e2")?.id).toBe("e2");
    expect(pickEstablishment(E, "removido")?.id).toBe("e1");
    expect(pickEstablishment([E[1]!], null)?.id).toBe("e2");
    expect(pickEstablishment([], null)).toBeNull();
  });

  function Probe() {
    const { current } = useEstablishment();
    return <p data-testid="cur">{current.name}</p>;
  }
  const wrap = (list: AdminEstablishment[]) =>
    render(
      <EstablishmentProvider establishments={list} isSuper={false}>
        <EstablishmentSwitcher />
        <Probe />
      </EstablishmentProvider>,
    );

  it("com um só estabelecimento mostra o nome, sem seletor", () => {
    wrap([E[0]!]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("cur")).toHaveTextContent("Padrão");
  });

  it("com vários, o seletor troca e lembra a escolha", () => {
    wrap(E);
    expect(screen.getByTestId("cur")).toHaveTextContent("Padrão");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "e2" } });
    expect(screen.getByTestId("cur")).toHaveTextContent("Padaria");
    expect(localStorage.getItem("pedeai:establishment")).toBe("e2");
  });

  it("sem nenhum estabelecimento liberado, explica em vez de quebrar", () => {
    wrap([]);
    expect(screen.getByRole("alert")).toHaveTextContent(/Nenhum estabelecimento liberado/);
  });
});
