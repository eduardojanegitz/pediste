import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActiveRound, MyOrder } from "@/lib/orders.functions";
import type { Menu } from "@/features/order/types";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/orders.functions", () => ({ cancelOrder: vi.fn() }));
vi.mock("@/features/order/PixPayment", () => ({ PixPayment: () => null }));
vi.mock("@/features/order/OrderStatus", () => ({ OrderStatus: () => null }));
vi.mock("@/features/order/RecoveryDialog", () => ({ RecoveryDialog: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { ConfirmedOrder } from "@/features/order/ConfirmedOrder";

const round: ActiveRound = {
  id: "r1",
  name: "Almoço",
  status: "open",
  opened_at: "2026-11-09T10:00:00Z",
  closed_at: null,
  opens_at: null,
  closes_at: null,
  state: "open",
  server_now: "2026-11-09T10:00:00Z",
};

// O produto custa R$ 10,00 hoje, mas o pedido foi feito quando custava R$ 8,00.
const menu: Menu = {
  categories: [
    {
      id: "c1",
      name: "Pratos",
      description: null,
      position: 0,
      min_select: 1,
      max_select: 1,
      allow_quantity: true,
      is_active: true,
    },
  ],
  products: [
    {
      id: "p1",
      name: "Frango",
      description: null,
      category_id: "c1",
      image_path: null,
      image_url: null,
      position: 0,
      is_active: true,
      price_cents: 1000,
    },
  ],
};

const me = (unit: number | null): MyOrder => ({
  participant: { id: "u1", display_name: "João" },
  has_phone: true,
  status: "confirmed",
  version: 1,
  items: [
    { product_id: "p1", quantity: 2, product_name: "Frango", note: null, unit_price_cents: unit },
  ],
});

const wrap = (order: MyOrder) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConfirmedOrder
        round={round}
        token={"t".repeat(40)}
        me={order}
        menu={menu}
        canEdit
        justUpdated={false}
        onEdit={() => {}}
      />
    </QueryClientProvider>,
  );

describe("pedido confirmado: preço guardado", () => {
  it("mostra o preço do momento do pedido, não o atual do cardápio", () => {
    wrap(me(800));
    // 2 x R$ 8,00 na linha e no total; o preço atual (R$ 20,00) não aparece
    expect(screen.getAllByText(/R\$\s16,00/)).toHaveLength(2);
    expect(screen.queryByText(/R\$\s20,00/)).toBeNull();
  });

  it("item sem preço guardado não mostra valor nem total", () => {
    wrap(me(null));
    expect(screen.queryByText(/R\$/)).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
  });
});
