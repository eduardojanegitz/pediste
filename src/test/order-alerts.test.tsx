import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  describeEvents,
  diffPulse,
  pulseSignature,
  strongestKind,
  titleWithCount,
} from "@/features/admin/order-alerts";
import type { PulseRow } from "@/lib/orders.functions";

const row = (
  id: string,
  version = 1,
  status: PulseRow["status"] = "confirmed",
  name = id.toUpperCase(),
): PulseRow => ({ id, version, status, name });

describe("diffPulse", () => {
  it("primeira leitura é só a linha de base: nada alerta", () => {
    expect(diffPulse(null, [row("a"), row("b")])).toEqual([]);
  });
  it("sem mudança, sem eventos", () => {
    expect(diffPulse([row("a")], [row("a")])).toEqual([]);
  });
  it("pedido novo", () => {
    expect(diffPulse([row("a")], [row("a"), row("b", 1, "confirmed", "Maria")])).toEqual([
      { kind: "new", orderId: "b", name: "Maria" },
    ]);
  });
  it("pedido que nasce já cancelado não alerta", () => {
    expect(diffPulse([], [row("a", 1, "cancelled")])).toEqual([]);
  });
  it("edição (versão maior)", () => {
    expect(diffPulse([row("a", 1)], [row("a", 2)])).toEqual([
      { kind: "edited", orderId: "a", name: "A" },
    ]);
  });
  it("cancelamento", () => {
    expect(diffPulse([row("a", 1)], [row("a", 1, "cancelled")])).toEqual([
      { kind: "cancelled", orderId: "a", name: "A" },
    ]);
  });
  it("cancelou e pediu de novo conta como pedido novo", () => {
    expect(diffPulse([row("a", 1, "cancelled")], [row("a", 2, "confirmed")])).toEqual([
      { kind: "new", orderId: "a", name: "A" },
    ]);
  });
  it("sumir da lista não alerta", () => {
    expect(diffPulse([row("a"), row("b")], [row("a")])).toEqual([]);
  });
  it("lote misto", () => {
    const ev = diffPulse(
      [row("a", 1), row("b", 1)],
      [row("a", 2), row("b", 1, "cancelled"), row("c")],
    );
    expect(ev.map((e) => e.kind).sort()).toEqual(["cancelled", "edited", "new"]);
  });
});

describe("textos e prioridade", () => {
  it("o som mais importante vence", () => {
    const e = (kind: "new" | "edited" | "cancelled") => ({ kind, orderId: "x", name: "X" });
    expect(strongestKind([])).toBeNull();
    expect(strongestKind([e("cancelled"), e("edited")])).toBe("edited");
    expect(strongestKind([e("cancelled"), e("new"), e("edited")])).toBe("new");
  });
  it("descreve em português", () => {
    expect(describeEvents([{ kind: "new", orderId: "1", name: "Maria" }])).toBe(
      "Maria fez um pedido",
    );
    expect(
      describeEvents([
        { kind: "new", orderId: "1", name: "A" },
        { kind: "new", orderId: "2", name: "B" },
        { kind: "cancelled", orderId: "3", name: "João" },
      ]),
    ).toBe("2 novos pedidos · João cancelou o pedido");
    expect(describeEvents([])).toBe("");
  });
  it("título e assinatura", () => {
    expect(titleWithCount("Pedidos — Pediste", 0)).toBe("Pedidos — Pediste");
    expect(titleWithCount("Pedidos — Pediste", 3)).toBe("(3) Pedidos — Pediste");
    expect(pulseSignature([row("a", 1)])).not.toBe(pulseSignature([row("a", 2)]));
    expect(pulseSignature([row("a", 1)])).not.toBe(pulseSignature([row("a", 1, "cancelled")]));
  });
});

// ---------- Hook completo ----------

const play = vi.fn(() => true);
const unlock = vi.fn(async () => true);
let ready = false;
vi.mock("@/features/admin/chime", () => ({
  playChime: (...a: unknown[]) => (play as (...x: unknown[]) => boolean)(...a),
  unlockSound: () => unlock(),
  soundReady: () => ready,
  soundSupported: () => true,
}));
const pulseFn = vi.fn(async (_: unknown): Promise<PulseRow[]> => []);
vi.mock("@/lib/orders.functions", () => ({
  getOrdersPulse: (arg: unknown) => pulseFn(arg),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { AlertsBar } from "@/features/admin/AlertsBar";
import { useOrderAlerts } from "@/features/admin/useOrderAlerts";

const ROUND = "11111111-1111-4111-8111-111111111111";

function setup(active = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useOrderAlerts({ roundId: ROUND, active }), { wrapper });
  const push = async (rows: PulseRow[]) => {
    // Espera a primeira leitura (linha de base) chegar antes de simular a mudança.
    await waitFor(() => expect(client.getQueryData(["orders-pulse", ROUND])).toBeDefined());
    await act(async () => {
      client.setQueryData(["orders-pulse", ROUND], rows);
    });
  };
  return { client, invalidate, hook, push };
}

describe("useOrderAlerts", () => {
  beforeEach(() => {
    play.mockClear();
    unlock.mockClear();
    pulseFn.mockReset();
    pulseFn.mockResolvedValue([row("a")]);
    ready = false;
    localStorage.clear();
    document.title = "Pedidos — Pediste";
  });

  it("a primeira leitura não toca nem conta", async () => {
    const { hook } = setup();
    await waitFor(() => expect(pulseFn).toHaveBeenCalled());
    await act(async () => {});
    expect(play).not.toHaveBeenCalled();
    expect(hook.result.current.unseen).toBe(0);
  });

  it("com alertas ligados, pedido novo toca, destaca, conta e atualiza a lista", async () => {
    const { hook, push, invalidate } = setup();
    await waitFor(() => expect(pulseFn).toHaveBeenCalled());
    await act(async () => {});
    await act(async () => {
      await hook.result.current.setEnabled(true);
    });
    play.mockClear(); // descarta o som de confirmação ao ligar
    await push([row("a"), row("b", 1, "confirmed", "Maria")]);
    await waitFor(() => expect(play).toHaveBeenCalledWith("new", 0.7));
    expect(hook.result.current.unseen).toBe(1);
    expect([...hook.result.current.newIds]).toEqual(["b"]);
    expect(document.title).toBe("(1) Pedidos — Pediste");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["round-orders", ROUND] });
  });

  it("com alertas desligados, conta e destaca mas fica em silêncio", async () => {
    const { hook, push } = setup();
    await waitFor(() => expect(pulseFn).toHaveBeenCalled());
    await act(async () => {});
    await push([row("a"), row("b")]);
    await waitFor(() => expect(hook.result.current.unseen).toBe(1));
    expect(play).not.toHaveBeenCalled();
  });

  it("edição toca o som de edição; cancelamento não destaca", async () => {
    const { hook, push } = setup();
    await waitFor(() => expect(pulseFn).toHaveBeenCalled());
    await act(async () => {});
    await act(async () => {
      await hook.result.current.setEnabled(true);
    });
    play.mockClear();
    await push([row("a", 2)]);
    await waitFor(() => expect(play).toHaveBeenCalledWith("edited", 0.7));
    play.mockClear();
    await push([row("a", 2, "cancelled")]);
    await waitFor(() => expect(play).toHaveBeenCalledWith("cancelled", 0.7));
    expect([...hook.result.current.newIds]).toEqual(["a"]); // do evento de edição
  });

  it("marcar como vistos zera destaques e contagem; focar a aba zera a contagem", async () => {
    const { hook, push } = setup();
    await waitFor(() => expect(pulseFn).toHaveBeenCalled());
    await act(async () => {});
    await push([row("a"), row("b")]);
    await waitFor(() => expect(hook.result.current.unseen).toBe(1));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(hook.result.current.unseen).toBe(0);
    expect(hook.result.current.newIds.size).toBe(1);
    act(() => hook.result.current.markSeen());
    expect(hook.result.current.newIds.size).toBe(0);
  });

  it("ligar libera o som, guarda a escolha e desligar também", async () => {
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.setEnabled(true);
    });
    expect(unlock).toHaveBeenCalled();
    expect(hook.result.current.enabled).toBe(true);
    expect(JSON.parse(localStorage.getItem("pedeai:order-alerts")!).enabled).toBe(true);
    await act(async () => {
      await hook.result.current.setEnabled(false);
    });
    expect(hook.result.current.enabled).toBe(false);
  });

  it("se o navegador não liberar o som, continua desligado", async () => {
    unlock.mockResolvedValueOnce(false);
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.setEnabled(true);
    });
    expect(hook.result.current.enabled).toBe(false);
  });

  it("depois de recarregar, alerta salvo mas som bloqueado pede um clique", async () => {
    localStorage.setItem("pedeai:order-alerts", JSON.stringify({ enabled: true, volume: 0.4 }));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    expect(hook.result.current.blocked).toBe(true);
    expect(hook.result.current.volume).toBe(0.4);
    await act(async () => {
      await hook.result.current.unlock();
    });
    expect(hook.result.current.blocked).toBe(false);
  });

  it("rodada encerrada não consulta o servidor", async () => {
    setup(false);
    await act(async () => {});
    expect(pulseFn).not.toHaveBeenCalled();
  });
});

describe("AlertsBar", () => {
  const base = {
    supported: true,
    enabled: false,
    volume: 0.7,
    setVolume: vi.fn(),
    setEnabled: vi.fn(async () => {}),
    unlock: vi.fn(async () => {}),
    test: vi.fn(async () => {}),
    blocked: false,
    unseen: 0,
    newIds: new Set<string>(),
    markSeen: vi.fn(),
    offline: false,
  };

  it("botão liga e testa o som", () => {
    render(<AlertsBar alerts={base} />);
    fireEvent.click(screen.getByRole("button", { name: /Ativar alertas sonoros/ }));
    expect(base.setEnabled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Testar som" }));
    expect(base.test).toHaveBeenCalledWith("new");
  });
  it("mostra aviso de som bloqueado e de falta de conexão", () => {
    render(<AlertsBar alerts={{ ...base, enabled: true, blocked: true, offline: true }} />);
    expect(screen.getByText(/bloqueou o som/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Liberar som" }));
    expect(base.unlock).toHaveBeenCalled();
    expect(screen.getByText(/Sem conexão/)).toBeTruthy();
  });
  it("sem suporte a áudio, explica em vez de mostrar controles", () => {
    render(<AlertsBar alerts={{ ...base, supported: false }} />);
    expect(screen.getByText(/não toca alertas sonoros/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /alertas/i })).toBeNull();
  });
});
