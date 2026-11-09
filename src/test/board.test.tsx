import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  boardPulse,
  boardToRoundOrders,
  isBoardToken,
  shortName,
  type BoardOrder,
  type SharedBoardResult,
} from "@/lib/board";
import type { BoardLink } from "@/lib/board.functions";

const getSharedBoard = vi.fn(async (_: unknown): Promise<SharedBoardResult> => ({
  status: "invalid",
}));
const createBoardLink = vi.fn(async (_: unknown) => ({
  id: "l1",
  token: "T".repeat(43),
  expiresAt: "2026-11-07T15:00:00.000Z",
}));
const listBoardLinks = vi.fn(async (_: unknown): Promise<BoardLink[]> => []);
const revokeBoardLink = vi.fn(async (_: unknown) => ({ ok: true }));
type DoneResult =
  | { ok: true; doneAt: string | null }
  | { ok: false; status: "invalid" | "expired" | "revoked" | "rate_limited" | "not_found" };
const setBoardOrderDone = vi.fn(async (_: unknown): Promise<DoneResult> => ({
  ok: true,
  doneAt: "2026-11-06T13:30:00.000Z",
}));
const toastError = vi.fn();
const copy = vi.fn(async (_: string) => {});
const playChime = vi.fn(() => true);
const unlockSound = vi.fn(async () => true);

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/board.functions", () => ({
  getSharedBoard: (a: unknown) => getSharedBoard(a),
  createBoardLink: (a: unknown) => createBoardLink(a),
  listBoardLinks: (a: unknown) => listBoardLinks(a),
  revokeBoardLink: (a: unknown) => revokeBoardLink(a),
  setBoardOrderDone: (a: unknown) => setBoardOrderDone(a),
}));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: (t: string) => copy(t) }));
vi.mock("@/features/admin/chime", () => ({
  playChime: (...a: unknown[]) => (playChime as (...x: unknown[]) => boolean)(...a),
  unlockSound: () => unlockSound(),
  soundReady: () => true,
  soundSupported: () => true,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: (m: string) => toastError(m), success: vi.fn() }),
}));

import { BoardLinkDialog } from "@/features/admin/BoardLinkDialog";
import { BoardPage } from "@/features/board/BoardPage";

describe("lógica do link do estabelecimento", () => {
  it("nome curto: primeiro nome + inicial do sobrenome", () => {
    expect(shortName("João da Silva Pereira")).toBe("João P.");
    expect(shortName("  maria   aparecida ")).toBe("maria A.");
    expect(shortName("Zé")).toBe("Zé");
    expect(shortName("")).toBe("Cliente");
    expect(shortName("Ana ébano")).toBe("Ana É.");
  });

  const o = (id: string, status: "confirmed" | "cancelled", version = 1): BoardOrder => ({
    id,
    name: id.toUpperCase(),
    version,
    status,
    created_at: "2026-11-06T12:00:00Z",
    updated_at: "2026-11-06T12:10:00Z",
    done_at: null,
    items:
      status === "cancelled"
        ? []
        : [
            {
              product_id: "p",
              product: "Frango",
              category: "Prato",
              category_position: 0,
              quantity: 1,
              note: "sem cebola",
            },
          ],
  });

  it("reconhece o formato do token e trata link cortado como inválido", () => {
    expect(isBoardToken("A".repeat(43))).toBe(true);
    expect(isBoardToken("aB3_-".repeat(9))).toBe(true);
    expect(isBoardToken("abc")).toBe(false); // cortado ao colar no WhatsApp
    expect(isBoardToken("A".repeat(39))).toBe(false);
    expect(isBoardToken("A".repeat(65))).toBe(false);
    expect(isBoardToken("$".repeat(43))).toBe(false);
    expect(isBoardToken(`${"A".repeat(42)} `)).toBe(false);
    expect(isBoardToken("")).toBe(false);
  });

  it("converte só pedidos confirmados, sem celular, preço nem pagamento", () => {
    const r = boardToRoundOrders([o("a", "confirmed", 2), o("b", "cancelled")]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ participant: "A", phone: null, paid_at: null, edited: true });
    expect(r[0]!.items[0]!.price_cents).toBeNull();
  });

  it("pulso inclui cancelados (para o alerta de cancelamento)", () => {
    expect(boardPulse([o("a", "confirmed"), o("b", "cancelled")]).map((p) => p.status)).toEqual([
      "confirmed",
      "cancelled",
    ]);
  });
});

const TOKEN = "T".repeat(43);
const board = (
  orders: BoardOrder[],
  over: Partial<{ state: "open" | "closed" | "waiting" }> = {},
): SharedBoardResult => ({
  status: "ok",
  board: {
    roundName: "Almoço",
    state: over.state ?? "open",
    closesAt: "2026-11-06T15:30:00Z",
    now: "2026-11-06T13:00:00Z",
    orders,
  },
});
const order = (
  id: string,
  name: string,
  items: BoardOrder["items"],
  version = 1,
  done_at: string | null = null,
  updated_at = "2026-11-06T12:00:00Z",
): BoardOrder => ({
  id,
  name,
  version,
  status: "confirmed",
  created_at: "2026-11-06T12:00:00Z",
  updated_at,
  done_at,
  items,
});
const item = (product: string, qty = 1, note: string | null = null, category = "Prato") => ({
  product_id: product,
  product,
  category,
  category_position: category === "Prato" ? 0 : 1,
  quantity: qty,
  note,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BoardPage token={TOKEN} />
    </QueryClientProvider>,
  );
  return client;
}

describe("página pública da comanda", () => {
  beforeEach(() => {
    getSharedBoard.mockReset();
    playChime.mockClear();
    unlockSound.mockClear();
    window.print = vi.fn();
  });

  it("mostra totais por produto, observações e quem pediu (nome curto)", async () => {
    getSharedBoard.mockResolvedValue(
      board([
        order("1", "João S.", [item("Frango", 1, "sem cebola"), item("Arroz", 1, null, "Acomp.")]),
        order("2", "Maria", [item("Frango"), item("Arroz", 1, null, "Acomp.")]),
      ]),
    );
    renderPage();
    expect(await screen.findByRole("heading", { name: "Almoço" })).toBeTruthy();
    const prato = screen.getByRole("region", { name: "Prato" });
    expect(within(prato).getByText("2")).toBeTruthy(); // 2 frangos
    expect(within(prato).getByText(/sem cebola/)).toBeTruthy();
    expect(within(prato).getByText(/\(João S\.\)/)).toBeTruthy();
    expect(screen.getByText("Recebendo pedidos")).toBeTruthy();
    expect(getSharedBoard).toHaveBeenCalledWith({ data: { token: TOKEN } });
  });

  it("alterna para 'Por pessoa'", async () => {
    getSharedBoard.mockResolvedValue(
      board([order("1", "João S.", [item("Frango", 1, "sem cebola")])]),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Almoço" });
    fireEvent.click(screen.getByRole("button", { name: "Por pessoa" }));
    const card = screen.getByRole("listitem", { name: "João S." });
    expect(within(card).getByText(/Obs\.: sem cebola/)).toBeTruthy();
  });

  it("nunca exibe celular, preço ou pagamento", async () => {
    getSharedBoard.mockResolvedValue(board([order("1", "João S.", [item("Frango")])]));
    renderPage();
    await screen.findByRole("heading", { name: "Almoço" });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/R\$/);
    expect(text).not.toMatch(/\(\d{2}\)\s?\d/);
    expect(text.toLowerCase()).not.toContain("pago");
    expect(text.toLowerCase()).not.toContain("pix");
  });

  it("sem pedidos: mensagem amigável", async () => {
    getSharedBoard.mockResolvedValue(board([]));
    renderPage();
    expect(await screen.findByText("Nenhum pedido ainda")).toBeTruthy();
  });

  it.each([
    ["invalid", "Link inválido"],
    ["expired", "Link expirado"],
    ["revoked", "Link revogado"],
    ["rate_limited", "Muitas consultas"],
  ] as const)("link %s mostra '%s'", async (status, title) => {
    getSharedBoard.mockResolvedValue({ status });
    renderPage();
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Almoço" })).toBeNull();
  });

  it("pedido novo na atualização: destaca e toca o alerta (se ligado)", async () => {
    getSharedBoard.mockResolvedValue(board([order("1", "João S.", [item("Frango")])]));
    const client = renderPage();
    await screen.findByRole("heading", { name: "Almoço" });
    fireEvent.click(screen.getByRole("button", { name: /Ativar alerta sonoro/ }));
    await waitFor(() => expect(unlockSound).toHaveBeenCalled());
    playChime.mockClear(); // descarta o som de confirmação ao ligar
    await act(async () => {
      client.setQueryData(
        ["board", TOKEN],
        board([order("1", "João S.", [item("Frango")]), order("2", "Maria", [item("Lasanha")])]),
      );
    });
    await waitFor(() => expect(playChime).toHaveBeenCalledWith("new", 0.8));
    expect(screen.getByText("1 pedido novo ou alterado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Marcar como vistos/ }));
    expect(screen.queryByText("1 pedido novo ou alterado")).toBeNull();
  });

  it("sem ligar o alerta, destaca mas não toca; primeira leitura não conta", async () => {
    getSharedBoard.mockResolvedValue(board([order("1", "João S.", [item("Frango")])]));
    const client = renderPage();
    await screen.findByRole("heading", { name: "Almoço" });
    expect(screen.queryByText(/novo ou alterado/)).toBeNull();
    await act(async () => {
      client.setQueryData(["board", TOKEN], board([order("1", "João S.", [item("Frango")], 2)]));
    });
    expect(await screen.findByText("1 pedido novo ou alterado")).toBeTruthy();
    expect(playChime).not.toHaveBeenCalled();
  });

  it("imprimir chama a impressão do navegador com a folha da comanda", async () => {
    getSharedBoard.mockResolvedValue(board([order("1", "João S.", [item("Frango")])]));
    renderPage();
    await screen.findByRole("heading", { name: "Almoço" });
    expect(document.querySelector(".comanda-print-root .comanda")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Térmica 58 mm" }));
    fireEvent.click(screen.getByRole("button", { name: /^Imprimir$/ }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".comanda-print-root style")?.textContent).toContain(
      "size: 58mm",
    );
  });
});

describe("janela do organizador", () => {
  const round = { id: "11111111-1111-4111-8111-111111111111", name: "Almoço" };
  const wrap = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <BoardLinkDialog open onOpenChange={() => {}} round={round} />
      </QueryClientProvider>,
    );
  };
  beforeEach(() => {
    createBoardLink.mockClear();
    listBoardLinks.mockReset();
    listBoardLinks.mockResolvedValue([]);
    revokeBoardLink.mockClear();
    copy.mockClear();
    localStorage.clear();
  });

  it("gera o link com o endereço do site e mostra a URL completa uma vez", async () => {
    wrap();
    fireEvent.change(screen.getByLabelText("Endereço do site"), {
      target: { value: "pediste.com.br" },
    });
    fireEvent.change(screen.getByLabelText("Vale por"), { target: { value: "72" } });
    fireEvent.click(screen.getByRole("button", { name: /Gerar link/ }));
    await waitFor(() =>
      expect(createBoardLink).toHaveBeenCalledWith({ data: { roundId: round.id, hours: 72 } }),
    );
    const input = (await screen.findByRole("textbox", {
      name: "Link do estabelecimento",
    })) as HTMLInputElement;
    expect(input.value).toBe(`https://pediste.com.br/comanda/${"T".repeat(43)}`);
    expect(screen.getByText(/ele não aparece de novo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copiar link/ }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(input.value));
    const wa = screen.getByRole("link", { name: /Enviar pelo WhatsApp/ });
    expect(wa.getAttribute("href")).toContain("wa.me");
    expect(decodeURIComponent(wa.getAttribute("href")!)).toContain(input.value);
  });

  it("endereço inválido desliga o botão", () => {
    wrap();
    fireEvent.change(screen.getByLabelText("Endereço do site"), { target: { value: "sem ponto" } });
    expect((screen.getByRole("button", { name: /Gerar link/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("alert").textContent).toContain("Endereço inválido");
  });

  it("lista os links com situação e revoga com confirmação", async () => {
    listBoardLinks.mockResolvedValue([
      {
        id: "a",
        createdAt: "2026-11-06T10:00:00Z",
        expiresAt: "2099-01-01T00:00:00Z",
        revokedAt: null,
      },
      {
        id: "b",
        createdAt: "2026-11-05T10:00:00Z",
        expiresAt: "2026-11-05T12:00:00Z",
        revokedAt: null,
      },
      {
        id: "c",
        createdAt: "2026-11-04T10:00:00Z",
        expiresAt: "2099-01-01T00:00:00Z",
        revokedAt: "2026-11-04T11:00:00Z",
      },
    ]);
    wrap();
    expect(await screen.findByText("Ativo")).toBeTruthy();
    expect(screen.getByText("Expirado")).toBeTruthy();
    expect(screen.getByText("Revogado")).toBeTruthy();
    // só o ativo tem "Revogar"
    expect(screen.getAllByRole("button", { name: /Revogar/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Revogar/ }));
    expect(await screen.findByText("Revogar este link?")).toBeTruthy();
    expect(revokeBoardLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Revogar$/ }));
    await waitFor(() => expect(revokeBoardLink).toHaveBeenCalledWith({ data: { id: "a" } }));
  });

  it("avisa quando o endereço só funciona neste computador", () => {
    wrap(); // jsdom roda em localhost
    expect(screen.getByText(/só funciona neste computador/)).toBeTruthy();
  });
});

describe("concluir pedidos na comanda ao vivo", () => {
  const two = () =>
    board([order("1", "João S.", [item("Frango")]), order("2", "Maria", [item("Lasanha")])]);

  beforeEach(() => {
    getSharedBoard.mockReset();
    setBoardOrderDone.mockReset();
    setBoardOrderDone.mockResolvedValue({ ok: true, doneAt: "2026-11-06T13:30:00.000Z" });
    toastError.mockClear();
  });

  const openPeople = async () => {
    const client = renderPage();
    await screen.findByRole("heading", { name: "Almoço" });
    fireEvent.click(screen.getByRole("button", { name: "Por pessoa" }));
    return client;
  };

  it("mostra 0/2 e um botão por pedido; concluir atualiza na hora e envia ao servidor", async () => {
    getSharedBoard.mockResolvedValue(two());
    await openPeople();
    expect(screen.getByText("Concluídos")).toBeTruthy();
    expect(screen.getByText("/2")).toBeTruthy();
    const joao = screen.getByRole("listitem", { name: "João S." });
    fireEvent.click(within(joao).getByRole("button", { name: /Marcar como concluído/ }));
    await waitFor(() =>
      expect(setBoardOrderDone).toHaveBeenCalledWith({
        data: { token: TOKEN, orderId: "1", done: true },
      }),
    );
    expect(
      await within(joao).findByRole("button", { name: /Concluído às .* desfazer/ }),
    ).toBeTruthy();
    expect(within(joao).getByText("Concluído")).toBeTruthy();
    const maria = screen.getByRole("listitem", { name: "Maria" });
    expect(within(maria).getByRole("button", { name: /Marcar como concluído/ })).toBeTruthy();
  });

  it("desfazer manda done:false", async () => {
    getSharedBoard.mockResolvedValue(
      board([order("1", "João S.", [item("Frango")], 1, "2026-11-06T12:30:00Z")]),
    );
    setBoardOrderDone.mockResolvedValue({ ok: true, doneAt: null });
    await openPeople();
    fireEvent.click(screen.getByRole("button", { name: /desfazer/ }));
    await waitFor(() =>
      expect(setBoardOrderDone).toHaveBeenCalledWith({
        data: { token: TOKEN, orderId: "1", done: false },
      }),
    );
    expect(await screen.findByRole("button", { name: /Marcar como concluído/ })).toBeTruthy();
  });

  it("falha de rede: volta atrás e avisa", async () => {
    getSharedBoard.mockResolvedValue(two());
    setBoardOrderDone.mockRejectedValueOnce(new Error("rede"));
    await openPeople();
    const joao = screen.getByRole("listitem", { name: "João S." });
    fireEvent.click(within(joao).getByRole("button", { name: /Marcar como concluído/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(within(joao).getByRole("button", { name: /Marcar como concluído/ })).toBeTruthy();
  });

  it("link revogado no meio do caminho: mostra a tela de link revogado", async () => {
    getSharedBoard.mockResolvedValue(two());
    setBoardOrderDone.mockResolvedValueOnce({ ok: false, status: "revoked" });
    await openPeople();
    const joao = screen.getByRole("listitem", { name: "João S." });
    fireEvent.click(within(joao).getByRole("button", { name: /Marcar como concluído/ }));
    expect(await screen.findByText("Link revogado")).toBeTruthy();
  });

  it("pedido que sumiu (cancelado): avisa e recarrega a comanda", async () => {
    getSharedBoard.mockResolvedValue(two());
    setBoardOrderDone.mockResolvedValueOnce({ ok: false, status: "not_found" });
    await openPeople();
    const before = getSharedBoard.mock.calls.length;
    fireEvent.click(
      within(screen.getByRole("listitem", { name: "João S." })).getByRole("button", {
        name: /Marcar como concluído/,
      }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(getSharedBoard.mock.calls.length).toBeGreaterThan(before));
  });

  it("'Só pendentes' esconde os concluídos nos totais e por pessoa", async () => {
    getSharedBoard.mockResolvedValue(
      board([
        order("1", "João S.", [item("Frango")], 1, "2026-11-06T12:30:00Z"),
        order("2", "Maria", [item("Lasanha")]),
      ]),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Almoço" });
    const prato = () => screen.getByRole("region", { name: "Prato" });
    expect(within(prato()).getByText("Frango")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Só pendentes"));
    expect(within(prato()).queryByText("Frango")).toBeNull();
    expect(within(prato()).getByText("Lasanha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Por pessoa" }));
    expect(screen.queryByRole("listitem", { name: "João S." })).toBeNull();
    expect(screen.getByRole("listitem", { name: "Maria" })).toBeTruthy();
  });

  it("tudo concluído com o filtro ligado: mensagem de parabéns", async () => {
    getSharedBoard.mockResolvedValue(
      board([order("1", "João S.", [item("Frango")], 1, "2026-11-06T12:30:00Z")]),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Almoço" });
    fireEvent.click(screen.getByLabelText("Só pendentes"));
    expect(screen.getByText("Tudo concluído!")).toBeTruthy();
  });

  it("pedido editado depois de concluído: avisa para conferir", async () => {
    getSharedBoard.mockResolvedValue(
      board([
        order("1", "João S.", [item("Frango")], 2, "2026-11-06T12:30:00Z", "2026-11-06T12:45:00Z"),
      ]),
    );
    await openPeople();
    expect(screen.getByRole("alert").textContent).toContain("mudou depois de concluído");
  });
});

describe("botões claros dentro de caixas coloridas", () => {
  it("btnPlain define a cor do texto (antes herdava o branco da caixa azul e sumia)", async () => {
    const admin = await import("@/features/admin/ui");
    const participant = await import("@/features/order/ui");
    expect(admin.btnPlain).toContain("text-foreground");
    expect(participant.btnPlain).toContain("text-foreground");
  });
});
