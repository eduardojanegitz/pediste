import { formatBRL } from "@/lib/format";
import {
  byPerson,
  byRound,
  formatDateBR,
  summarizeReport,
  type Period,
  type ReportRow,
} from "@/lib/report";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const name = (p: Period) => `relatorio-${p.from}-a-${p.to}`;

export async function exportReportExcel(rows: ReportRow[], period: Period) {
  const XLSX = await import("xlsx");
  const people = byPerson(rows).map((p) => ({
    Participante: p.name,
    Pedidos: p.orders,
    "Total (R$)": p.totalCents / 100,
    "Pago (R$)": p.paidCents / 100,
    "Em aberto (R$)": p.dueCents / 100,
  }));
  const rounds = byRound(rows).map((r) => ({
    Rodada: r.name,
    Data: day(r.firstAt),
    Pessoas: r.people,
    Pedidos: r.orders,
    "Total (R$)": r.totalCents / 100,
    "Recebido (R$)": r.paidCents / 100,
    "A receber (R$)": r.dueCents / 100,
  }));
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(people);
  ws1["!cols"] = [{ wch: 28 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Por pessoa");
  const ws2 = XLSX.utils.json_to_sheet(rounds);
  ws2["!cols"] = [
    { wch: 28 },
    { wch: 12 },
    { wch: 9 },
    { wch: 9 },
    { wch: 13 },
    { wch: 14 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Por rodada");
  XLSX.writeFile(wb, `${name(period)}.xlsx`);
}

export async function exportReportPdf(rows: ReportRow[], period: Period) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const s = summarizeReport(rows);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFillColor(255, 90, 54);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 80, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("Relatório", 40, 48);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${formatDateBR(period.from)} a ${formatDateBR(period.to)}`, 40, 66);
  doc.setTextColor(28, 28, 28);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(
    `${s.orders} pedido(s) · total ${formatBRL(s.totalCents)} · recebido ${formatBRL(s.paidCents)} · a receber ${formatBRL(s.dueCents)}`,
    40,
    108,
  );
  doc.setFontSize(13);
  doc.text("Por pessoa", 40, 138);
  autoTable(doc, {
    startY: 146,
    head: [["Participante", "Pedidos", "Total", "Pago", "Em aberto"]],
    body: byPerson(rows).map((p) => [
      p.name,
      String(p.orders),
      formatBRL(p.totalCents),
      formatBRL(p.paidCents),
      formatBRL(p.dueCents),
    ]),
    headStyles: { fillColor: [255, 90, 54] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
    },
    margin: { left: 40, right: 40 },
  });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28;
  doc.setFontSize(13);
  doc.text("Por rodada", 40, y);
  autoTable(doc, {
    startY: y + 8,
    head: [["Rodada", "Data", "Pessoas", "Total", "Recebido", "A receber"]],
    body: byRound(rows).map((r) => [
      r.name,
      day(r.firstAt),
      String(r.people),
      formatBRL(r.totalCents),
      formatBRL(r.paidCents),
      formatBRL(r.dueCents),
    ]),
    headStyles: { fillColor: [43, 89, 255] },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
    margin: { left: 40, right: 40 },
  });
  doc.save(`${name(period)}.pdf`);
}
