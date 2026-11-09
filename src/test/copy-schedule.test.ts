import { describe, expect, it } from "vitest";
import { addDaysLocal, copySchedule } from "@/lib/schedule";

// Brasília = UTC-3. 2026-11-09 10:00 em Brasília = 13:00Z.
const NOW = Date.parse("2026-11-09T13:00:00Z");
const iso = (local: string) => new Date(`${local}:00-03:00`).toISOString();

describe("addDaysLocal", () => {
  it("atravessa mês e ano", () => {
    expect(addDaysLocal("2026-11-30T11:30", 1)).toBe("2026-12-01T11:30");
    expect(addDaysLocal("2026-12-31T08:00", 1)).toBe("2027-01-01T08:00");
    expect(addDaysLocal("2026-11-09T08:00", -9)).toBe("2026-10-31T08:00");
  });
});

describe("copySchedule", () => {
  it("sem horários: campos vazios", () => {
    expect(copySchedule({ opens_at: null, closes_at: null }, NOW)).toEqual({
      opens: "",
      closes: "",
    });
  });

  it("encerramento ainda não passou hoje: usa hoje e mantém a duração", () => {
    const r = { opens_at: iso("2026-10-30T08:00"), closes_at: iso("2026-10-30T11:30") };
    expect(copySchedule(r, NOW)).toEqual({ opens: "2026-11-09T08:00", closes: "2026-11-09T11:30" });
  });

  it("horário de hoje já passou: vai para amanhã", () => {
    const r = { opens_at: iso("2026-10-30T07:00"), closes_at: iso("2026-10-30T09:30") };
    expect(copySchedule(r, NOW)).toEqual({ opens: "2026-11-10T07:00", closes: "2026-11-10T09:30" });
  });

  it("só encerramento", () => {
    expect(copySchedule({ opens_at: null, closes_at: iso("2026-10-01T12:00") }, NOW)).toEqual({
      opens: "",
      closes: "2026-11-09T12:00",
    });
  });

  it("só abertura usa a abertura como referência", () => {
    expect(copySchedule({ opens_at: iso("2026-10-01T18:00"), closes_at: null }, NOW)).toEqual({
      opens: "2026-11-09T18:00",
      closes: "",
    });
  });

  it("abertura na véspera do encerramento mantém a diferença de dias", () => {
    const r = { opens_at: iso("2026-10-29T18:00"), closes_at: iso("2026-10-30T11:00") };
    expect(copySchedule(r, NOW)).toEqual({ opens: "2026-11-08T18:00", closes: "2026-11-09T11:00" });
  });

  it("usa a data de Brasília, não a do UTC (23h de Brasília já é o dia seguinte em UTC)", () => {
    const lateNow = Date.parse("2026-11-10T01:30:00Z"); // 22:30 de 09/11 em Brasília
    const r = { opens_at: null, closes_at: iso("2026-10-30T23:00") };
    expect(copySchedule(r, lateNow).closes).toBe("2026-11-09T23:00");
  });
});
