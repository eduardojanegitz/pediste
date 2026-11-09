import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "@/features/admin/ShareDialog";
import { resolveEstablishment } from "@/lib/establishment.server";
import { participantPath } from "@/lib/scope";

const getEstablishment = vi.fn();
const getActiveRound = vi.fn();
const getMenu = vi.fn();
vi.mock("@/lib/establishment.functions", () => ({
  getEstablishment: (a: unknown) => getEstablishment(a),
}));
vi.mock("@/lib/orders.functions", () => ({
  getActiveRound: (a: unknown) => getActiveRound(a),
  getMyOrder: vi.fn(),
}));
vi.mock("@/lib/catalog.functions", () => ({ getMenu: (a: unknown) => getMenu(a) }));
vi.mock("@/lib/participant", () => ({ getToken: () => null }));
vi.mock("@/lib/export", () => ({ copyText: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { ParticipantPage } from "@/features/order/ParticipantPage";

const wrap = (slug?: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ParticipantPage slug={slug} />
    </QueryClientProvider>,
  );

describe("participante por estabelecimento", () => {
  beforeEach(() => {
    getEstablishment.mockReset();
    getActiveRound.mockReset();
    getMenu.mockReset();
  });

  it("apelido que não existe: mostra 'não encontrado' e nem consulta a rodada", async () => {
    getEstablishment.mockResolvedValue(null);
    wrap("nao-existe");
    expect(await screen.findByText("Estabelecimento não encontrado")).toBeInTheDocument();
    expect(getEstablishment).toHaveBeenCalledWith({ data: { slug: "nao-existe" } });
    expect(getActiveRound).not.toHaveBeenCalled();
  });

  it("sem rodada aberta cita o nome do estabelecimento", async () => {
    getEstablishment.mockResolvedValue({
      name: "Padaria do Zé",
      slug: "padaria",
      isDefault: false,
    });
    getActiveRound.mockResolvedValue(null);
    wrap("padaria");
    expect(await screen.findByText(/Nenhuma rodada de Padaria do Zé/)).toBeInTheDocument();
    expect(getActiveRound).toHaveBeenCalledWith({ data: { slug: "padaria" } });
  });

  it("endereço '/' (sem apelido) consulta o estabelecimento padrão", async () => {
    getEstablishment.mockResolvedValue({ name: "Padrão", slug: "padrao", isDefault: true });
    getActiveRound.mockResolvedValue(null);
    wrap();
    await waitFor(() => expect(getActiveRound).toHaveBeenCalledWith({ data: {} }));
    expect(getEstablishment).toHaveBeenCalledWith({ data: {} });
  });
});

describe("caminho e resolução do estabelecimento", () => {
  it("padrão fica em '/', os outros em /e/<apelido>", () => {
    expect(participantPath({ slug: "padrao", isDefault: true })).toBe("");
    expect(participantPath({ slug: "padaria-do-ze", isDefault: false })).toBe("/e/padaria-do-ze");
  });

  function fakeDb(row: unknown) {
    const calls: [string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        calls.push([c, v]);
        return q;
      },
      maybeSingle: () => Promise.resolve({ data: row }),
    };
    return { db: { from: () => q } as never, calls };
  }

  it("sem apelido busca o padrão; com apelido busca por ele", async () => {
    const row = { id: "e1", name: "Padrão", slug: "padrao", is_default: true };
    const a = fakeDb(row);
    expect(await resolveEstablishment(a.db, undefined)).toEqual({
      id: "e1",
      name: "Padrão",
      slug: "padrao",
      isDefault: true,
    });
    expect(a.calls).toEqual([["is_default", true]]);
    const b = fakeDb(row);
    await resolveEstablishment(b.db, "padaria");
    expect(b.calls).toEqual([["slug", "padaria"]]);
  });

  it("apelido inválido nem chega ao banco", async () => {
    const f = fakeDb({ id: "x" });
    for (const bad of ["Com Espaço", "../x", "A", "-a", "a".repeat(41), ""]) {
      expect(await resolveEstablishment(f.db, bad)).toBeNull();
    }
    expect(f.calls).toEqual([]);
  });

  it("apelido desconhecido devolve null", async () => {
    expect(await resolveEstablishment(fakeDb(null).db, "ninguem")).toBeNull();
  });
});

describe("Compartilhar com o endereço do estabelecimento", () => {
  beforeEach(() => localStorage.clear());
  const round = { name: "Almoço", state: "open" as const, opens_at: null, closes_at: null };

  it("estabelecimento padrão usa só o site; os outros acrescentam /e/<apelido>", async () => {
    const origin = window.location.origin;
    const a = render(<ShareDialog open onOpenChange={() => {}} round={round} path="" />);
    expect(screen.getByRole("img", { name: `QR Code para ${origin}` })).toBeTruthy();
    a.unmount();
    render(<ShareDialog open onOpenChange={() => {}} round={round} path="/e/padaria" />);
    expect(screen.getByRole("img", { name: `QR Code para ${origin}/e/padaria` })).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Mensagem para o WhatsApp") as HTMLTextAreaElement).value,
      ).toContain(`${origin}/e/padaria`),
    );
    // o campo de endereço guarda só o site, sem o caminho
    expect((screen.getByLabelText("Endereço do site") as HTMLInputElement).value).toBe(origin);
  });
});
