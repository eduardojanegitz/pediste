import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportView } from "@/features/admin/ReportView";
import {
  byPerson,
  byRound,
  chargeMessage,
  presets,
  spDayStartIso,
  spNextDayStartIso,
  summarizeReport,
  validPeriod,
  type ReportRow,
} from "@/lib/report";

const row = (o: Partial<ReportRow>): ReportRow => ({
  orderId: "o",
  roundId: "r1",
  roundName: "Almoço",
  participantId: "p1",
  name: "João Pereira",
  phoneE164: "+5515999998888",
  createdAt: "2026-11-05T15:00:00Z",
  paidAt: null,
  valueCents: 1000,
  ...o,
});

const ROWS: ReportRow[] = [
  row({ orderId: "1", valueCents: 2250, paidAt: "2026-11-05T16:00:00Z" }),
  row({
    orderId: "2",
    roundId: "r2",
    roundName: "Jantar",
    createdAt: "2026-11-07T20:00:00Z",
    valueCents: 3000,
  }),
  row({
    orderId: "3",
    participantId: "p2",
    name: "Ana",
    phoneE164: null,
    valueCents: 1500,
    paidAt: "2026-11-05T16:00:00Z",
  }),
  row({ orderId: "4", participantId: "p3", name: "Beto", valueCents: null }),
];

describe("report: agregações", () => {
  it("por pessoa: quem deve mais primeiro, pago x em aberto", () => {
    const p = byPerson(ROWS);
    expect(p.map((x) => x.name)).toEqual(["João Pereira", "Ana", "Beto"]);
    expect(p[0]).toMatchObject({ orders: 2, totalCents: 5250, paidCents: 2250, dueCents: 3000 });
    expect(p[1]).toMatchObject({ totalCents: 1500, dueCents: 0 });
    expect(p[2]).toMatchObject({ orders: 1, totalCents: 0, dueCents: 0 });
  });
  it("por rodada: mais recente primeiro, com contagem de pessoas", () => {
    const r = byRound(ROWS);
    expect(r.map((x) => x.name)).toEqual(["Jantar", "Almoço"]);
    expect(r[1]).toMatchObject({
      orders: 3,
      people: 3,
      totalCents: 3750,
      paidCents: 3750,
      dueCents: 0,
    });
    expect(r[0]).toMatchObject({ people: 1, dueCents: 3000 });
  });
  it("resumo: ticket médio só considera pedidos com preço", () => {
    const s = summarizeReport(ROWS);
    expect(s).toMatchObject({
      orders: 4,
      people: 3,
      rounds: 2,
      totalCents: 6750,
      paidCents: 3750,
      dueCents: 3000,
    });
    expect(s.avgTicketCents).toBe(2250);
    expect(summarizeReport([row({ valueCents: null })]).avgTicketCents).toBeNull();
    expect(summarizeReport([]).totalCents).toBe(0);
  });
});

describe("report: período", () => {
  it("limites do dia em Brasília (UTC-3)", () => {
    expect(spDayStartIso("2026-11-05")).toBe("2026-11-05T03:00:00.000Z");
    expect(spNextDayStartIso("2026-11-30")).toBe("2026-12-01T03:00:00.000Z");
    expect(spNextDayStartIso("2026-12-31")).toBe("2027-01-01T03:00:00.000Z");
  });
  it("valida datas, ordem e tamanho máximo", () => {
    expect(validPeriod({ from: "2026-11-01", to: "2026-11-30" })).toBeNull();
    expect(validPeriod({ from: "2026-11-30", to: "2026-11-01" })).toMatch(/depois/);
    expect(validPeriod({ from: "x", to: "2026-11-01" })).toMatch(/inválidas/);
    expect(validPeriod({ from: "2026-02-31", to: "2026-03-01" })).toMatch(/inválidas/);
    expect(validPeriod({ from: "2024-01-01", to: "2026-11-01" })).toMatch(/13 meses/);
  });
  it("atalhos: este mês, mês passado, 30 dias (inclusive virada de ano)", () => {
    const p = presets("2026-11-09");
    expect(p[0]!.period).toEqual({ from: "2026-11-01", to: "2026-11-09" });
    expect(p[1]!.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(p[2]!.period).toEqual({ from: "2026-10-11", to: "2026-11-09" });
    expect(presets("2027-01-05")[1]!.period).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("mensagem de cobrança", () => {
    const m = chargeMessage({
      name: "João Pereira",
      dueCents: 3000,
      period: { from: "2026-11-01", to: "2026-11-30" },
      money: (c) => `R$ ${c / 100}`,
    });
    expect(m).toContain("Oi, João!");
    expect(m).toContain("01/11/2026 a 30/11/2026");
    expect(m).toContain("*R$ 30*");
  });
});

const getReport = vi.fn();
vi.mock("@/lib/report.functions", () => ({ getReport: (a: unknown) => getReport(a) }));
vi.mock("@/lib/report-export", () => ({ exportReportExcel: vi.fn(), exportReportPdf: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportView />
    </QueryClientProvider>,
  );

describe("ReportView", () => {
  beforeEach(() => {
    getReport.mockReset();
    vi.stubGlobal("open", vi.fn());
  });

  it("mostra resumo, por pessoa e abre o WhatsApp só de quem deve", async () => {
    getReport.mockResolvedValue({ rows: ROWS, truncated: false });
    wrap();
    expect(await screen.findByText("Por pessoa")).toBeInTheDocument();
    expect(screen.getByText("Por rodada")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Cobrar/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Cobrar/ }));
    const url = (window.open as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain("https://wa.me/5515999998888?text=");
    expect(screen.getAllByText("Em dia", { selector: "span" })).toHaveLength(2);
  });

  it("período sem pedidos", async () => {
    getReport.mockResolvedValue({ rows: [], truncated: false });
    wrap();
    expect(await screen.findByText("Nenhum pedido neste período")).toBeInTheDocument();
  });

  it("período inválido não consulta o servidor", async () => {
    getReport.mockResolvedValue({ rows: [], truncated: false });
    wrap();
    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2999-01-01" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/depois da inicial/);
    expect(getReport).toHaveBeenCalledTimes(1);
  });
});
