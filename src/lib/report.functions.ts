import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-middleware";
import { assertEstablishment } from "@/lib/scope";
import { spDayStartIso, spNextDayStartIso, validPeriod, type ReportRow } from "@/lib/report";

const MAX_ROWS = 5000;

/**
 * Pedidos confirmados do período (datas de Brasília, inclusive), com o valor de cada um calculado
 * aqui pelos preços atuais dos produtos (itens sem preço não contam). Só para administradores.
 */
export const getReport = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) =>
    z
      .object({
        establishmentId: z.string().uuid(),
        from: z.string(),
        to: z.string(),
      })
      .superRefine((p, ctx) => {
        const err = validPeriod(p);
        if (err) ctx.addIssue({ code: "custom", message: err });
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ rows: ReportRow[]; truncated: boolean }> => {
    assertEstablishment(context, data.establishmentId);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await db
      .from("orders")
      .select(
        "id, round_id, participant_id, created_at, paid_at, rounds!inner(name, establishment_id), participants(display_name, phone_e164), order_items(quantity, products(price_cents))",
      )
      .eq("status", "confirmed")
      .eq("rounds.establishment_id", data.establishmentId)
      .gte("created_at", spDayStartIso(data.from))
      .lt("created_at", spNextDayStartIso(data.to))
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS + 1);
    if (error) {
      console.error(error);
      throw new Error("Não foi possível carregar o relatório.");
    }
    type Row = {
      id: string;
      round_id: string;
      participant_id: string;
      created_at: string;
      paid_at: string | null;
      rounds: { name: string } | null;
      participants: { display_name: string; phone_e164: string | null } | null;
      order_items: { quantity: number; products: { price_cents: number | null } | null }[];
    };
    const all = rows as unknown as Row[];
    const out: ReportRow[] = all.slice(0, MAX_ROWS).map((o) => {
      let total = 0;
      let priced = false;
      for (const i of o.order_items) {
        const p = i.products?.price_cents;
        if (p != null) {
          total += p * i.quantity;
          priced = true;
        }
      }
      return {
        orderId: o.id,
        roundId: o.round_id,
        roundName: o.rounds?.name ?? "—",
        participantId: o.participant_id,
        name: o.participants?.display_name ?? "—",
        phoneE164: o.participants?.phone_e164 ?? null,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        valueCents: priced ? total : null,
      };
    });
    return { rows: out, truncated: all.length > MAX_ROWS };
  });
