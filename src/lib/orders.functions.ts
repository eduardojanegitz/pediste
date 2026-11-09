import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-middleware";
import { mapOrderError, RATE_LIMITED_MESSAGE, type OrderErrorCode } from "@/lib/order-errors";
import { pickLastOrder, type LastOrder } from "@/lib/last-order";
import { cleanNote, NOTE_MAX } from "@/lib/order-note";
import { orderProgress, type OrderProgress } from "@/lib/order-status";
import { formatPhone } from "@/lib/phone";
import { pixPayload, maskPixKey, type PixKeyType } from "@/lib/pix";
import { generateRecoveryCode, normalizeRecoveryCode } from "@/lib/recovery-code";
import { scheduleSchema } from "@/lib/schedule";
import { assertEstablishment } from "@/lib/scope";
import { assertOrderAccess, assertRoundAccess } from "@/lib/scope.server";

// Todas as gravações e leituras de dados privados (participantes/pedidos) passam
// por aqui, com o client administrativo apenas no servidor.
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function hashToken(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type RoundState = "waiting" | "open" | "closed";
export type Round = {
  id: string;
  name: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  opens_at: string | null;
  closes_at: string | null;
  /** Estado efetivo calculado no servidor: aguardando abertura, aberta ou encerrada (manual ou por horário). */
  state: RoundState;
};
/** Rodada como o painel a vê: com o instante da última comanda impressa. */
export type AdminRound = Round & {
  /** Até quando (instante dos dados) a comanda já foi impressa; null = nunca. */
  last_printed_at: string | null;
};
/** Rodada atual + horário do servidor (para o cliente exibir contagem regressiva sem confiar no relógio local). */
export type ActiveRound = Round & { server_now: string };

const tokenSchema = z.string().min(32).max(128);
/** Endereço público opcional: sem apelido = estabelecimento padrão. Aceita chamada sem argumento. */
const publicSlugSchema = z
  .object({ slug: z.string().max(40).optional() })
  .optional()
  .transform((v) => v ?? {});

// Mesma regra de public.round_state(), com o relógio do servidor (usada só para listagens do admin).
function roundState(
  r: { status: string; opens_at: string | null; closes_at: string | null },
  now = Date.now(),
): RoundState {
  if (r.status !== "open") return "closed";
  if (r.opens_at && now < Date.parse(r.opens_at)) return "waiting";
  if (r.closes_at && now >= Date.parse(r.closes_at)) return "closed";
  return "open";
}

// ---------- Rodadas ----------

/** Rodada atual (status 'open') com o estado calculado pelo relógio do banco. `null` = nenhuma rodada. */
export const getActiveRound = createServerFn({ method: "GET" })
  .validator((d: unknown) => publicSlugSchema.parse(d))
  .handler(async ({ data: input }): Promise<ActiveRound | null> => {
    const db = await admin();
    const { resolveEstablishment } = await import("@/lib/establishment.server");
    const est = await resolveEstablishment(db, input.slug);
    if (!est) return null;
    const { data, error } = await db.rpc("get_active_round_for", { p_establishment: est.id });
    if (error) {
      console.error(error);
      throw new Error("Não foi possível carregar a rodada.");
    }
    const r = data?.[0];
    return r
      ? ({
          ...r,
          status: r.status as Round["status"],
          state: r.state as RoundState,
        } satisfies ActiveRound)
      : null;
  });

export const listRounds = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ establishmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data: input, context }): Promise<AdminRound[]> => {
    assertEstablishment(context, input.establishmentId);
    const db = await admin();
    const { data, error } = await db
      .from("rounds")
      .select("*")
      .eq("establishment_id", input.establishmentId)
      .order("opened_at", { ascending: false });
    if (error) throw new Error("Não foi possível carregar as rodadas.");
    const now = Date.now();
    return data.map((r) => ({
      ...r,
      status: r.status as Round["status"],
      state: roundState(r, now),
    }));
  });

/** Fecha de vez as rodadas que já encerraram por horário (continuam 'open' no banco) para liberar outra. */
async function closeExpiredRounds(db: Awaited<ReturnType<typeof admin>>) {
  const now = new Date().toISOString();
  await db
    .from("rounds")
    .update({ status: "closed", closed_at: now })
    .eq("status", "open")
    .lte("closes_at", now);
}

export const openRound = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) =>
    z
      .object({
        establishmentId: z.string().uuid(),
        name: z.string().trim().min(1, "Informe um nome").max(80),
        schedule: scheduleSchema.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    assertEstablishment(context, data.establishmentId);
    const db = await admin();
    await closeExpiredRounds(db);
    const { error } = await db.from("rounds").insert({
      establishment_id: data.establishmentId,
      name: data.name,
      created_by: context.adminId,
      opens_at: data.schedule?.opensAt ?? null,
      closes_at: data.schedule?.closesAt ?? null,
    });
    if (error) {
      if (error.code === "23505")
        throw new Error("Já existe uma rodada aberta. Encerre-a antes de abrir outra.");
      throw new Error("Não foi possível abrir a rodada.");
    }
    return { ok: true };
  });

/** Ajusta abertura/encerramento de uma rodada que ainda não foi encerrada manualmente. */
export const updateRoundSchedule = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), schedule: scheduleSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertRoundAccess(db, context, data.id);
    const { error, count } = await db
      .from("rounds")
      .update(
        { opens_at: data.schedule.opensAt, closes_at: data.schedule.closesAt },
        { count: "exact" },
      )
      .eq("id", data.id)
      .eq("status", "open");
    if (error) throw new Error("Não foi possível salvar os horários.");
    if (!count)
      throw new Error("Esta rodada já foi encerrada. Use “Reabrir” para voltar a receber pedidos.");
    return { ok: true };
  });

/**
 * Reabre uma rodada encerrada (manualmente ou por horário). `closesAt` novo (ou null = sem limite);
 * precisa estar no futuro, senão a rodada reabriria já encerrada.
 */
export const reopenRound = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) =>
    z
      .object({ id: z.string().uuid(), closesAt: z.string().datetime({ offset: true }).nullable() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.closesAt && Date.parse(data.closesAt) <= Date.now()) {
      throw new Error("Escolha um encerramento no futuro para reabrir.");
    }
    const db = await admin();
    await assertRoundAccess(db, context, data.id);
    await closeExpiredRounds(db);
    const { error } = await db
      .from("rounds")
      .update({ status: "open", closed_at: null, closes_at: data.closesAt })
      .eq("id", data.id);
    if (error) {
      if (error.code === "23505")
        throw new Error("Já existe outra rodada aberta. Encerre-a antes de reabrir esta.");
      throw new Error("Não foi possível reabrir a rodada.");
    }
    return { ok: true };
  });

export const closeRound = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertRoundAccess(db, context, data.id);
    const { error } = await db
      .from("rounds")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "open");
    if (error) throw new Error("Não foi possível encerrar a rodada.");
    return { ok: true };
  });

// ---------- Participante ----------

export type MyOrder = {
  participant: { id: string; display_name: string };
  /** O participante já tem celular cadastrado? (participantes antigos não têm) */
  has_phone: boolean;
  status: "confirmed" | "cancelled" | null;
  /** Versão do pedido (0 = ainda não existe). Enviada de volta ao salvar para detectar edição concorrente. */
  version: number;
  items: {
    product_id: string;
    quantity: number;
    product_name: string | null;
    note: string | null;
    /** Preço unitário guardado no pedido (centavos); null = sem preço. */
    unit_price_cents: number | null;
  }[];
};

async function findParticipant(db: Awaited<ReturnType<typeof admin>>, token: string) {
  const { data } = await db
    .from("participants")
    .select("id, display_name, phone_e164")
    .eq("token_hash", await hashToken(token))
    .maybeSingle();
  return data;
}

/** Devolve o participante e o pedido dele na rodada; `participant: null` se o código não for reconhecido. */
export const getMyOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ token: tokenSchema, roundId: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data }): Promise<MyOrder | null> => {
    const db = await admin();
    const found = await findParticipant(db, data.token);
    if (!found) return null;
    // O celular nunca volta para o navegador: só se existe ou não.
    const participant = { id: found.id, display_name: found.display_name };
    const has_phone = found.phone_e164 !== null;
    if (!data.roundId) return { participant, has_phone, status: null, version: 0, items: [] };
    const { data: order } = await db
      .from("orders")
      .select(
        "id, status, version, order_items(product_id, quantity, note, unit_price_cents, products(name))",
      )
      .eq("round_id", data.roundId)
      .eq("participant_id", participant.id)
      .maybeSingle();
    if (!order) return { participant, has_phone, status: null, version: 0, items: [] };
    return {
      participant,
      has_phone,
      status: order.status as "confirmed" | "cancelled",
      version: order.version,
      items: order.order_items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        product_name: i.products?.name ?? null,
        note: i.note ?? null,
        unit_price_cents: i.unit_price_cents,
      })),
    };
  });

/**
 * "O de sempre": o último pedido confirmado do participante em OUTRA rodada (a atual fica de fora,
 * porque nela ele já está montando/editando o pedido). `null` se ainda não tem histórico.
 */
export const getLastOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ token: tokenSchema, roundId: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data }): Promise<LastOrder | null> => {
    const db = await admin();
    const found = await findParticipant(db, data.token);
    if (!found) return null;
    // "O de sempre" vale só dentro do mesmo estabelecimento da rodada atual (sem rodada, o padrão).
    let est: string | undefined;
    if (data.roundId) {
      const { establishmentOfRound } = await import("@/lib/scope.server");
      est = await establishmentOfRound(db, data.roundId).catch(() => undefined);
    }
    if (!est) {
      const { resolveEstablishment } = await import("@/lib/establishment.server");
      est = (await resolveEstablishment(db, undefined))?.id;
    }
    if (!est) return null;
    let q = db
      .from("orders")
      .select(
        "updated_at, rounds!inner(name, establishment_id), order_items(product_id, quantity, note, products(name))",
      )
      .eq("rounds.establishment_id", est)
      .eq("participant_id", found.id)
      .eq("status", "confirmed")
      .order("updated_at", { ascending: false })
      .limit(5);
    if (data.roundId) q = q.neq("round_id", data.roundId);
    const { data: rows, error } = await q;
    if (error) throw new Error("Não foi possível carregar o seu último pedido.");
    return pickLastOrder(rows as unknown as Parameters<typeof pickLastOrder>[0]);
  });

// ---------- Pagamento (Pix) do participante ----------

export type MyPayment =
  | { state: "unavailable"; reason: "no_order" | "no_prices" | "no_pix" }
  | {
      state: "pay";
      totalCents: number;
      /** Código Pix "copia e cola" (também vira QR Code). */
      payload: string;
      receiver: string;
      keyMasked: string;
    }
  | { state: "paid"; totalCents: number; paidAt: string; changedAfter: boolean };

/**
 * Quanto o participante deve e como pagar (Pix do organizador dono da rodada). O valor é calculado
 * aqui, no servidor, pelos preços do banco: nunca vem do navegador. Itens sem preço não são cobrados.
 * A chave só é revelada a quem tem pedido confirmado nesta rodada.
 */
export const getMyPayment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ token: tokenSchema, roundId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<MyPayment> => {
    const db = await admin();
    const found = await findParticipant(db, data.token);
    if (!found) return { state: "unavailable", reason: "no_order" };
    const { data: order } = await db
      .from("orders")
      .select("status, paid_at, updated_at, order_items(quantity, unit_price_cents)")
      .eq("round_id", data.roundId)
      .eq("participant_id", found.id)
      .maybeSingle();
    if (!order || order.status !== "confirmed") return { state: "unavailable", reason: "no_order" };

    let total = 0;
    let priced = false;
    // Preço guardado no pedido: mudar o preço do produto depois não altera o que o participante deve.
    for (const i of order.order_items as unknown as {
      quantity: number;
      unit_price_cents: number | null;
    }[]) {
      const price = i.unit_price_cents;
      if (price != null) {
        total += price * i.quantity;
        priced = true;
      }
    }
    if (!priced || total <= 0) return { state: "unavailable", reason: "no_prices" };

    if (order.paid_at) {
      return {
        state: "paid",
        totalCents: total,
        paidAt: order.paid_at,
        changedAfter: Date.parse(order.updated_at) > Date.parse(order.paid_at),
      };
    }

    // De quem é o Pix: do organizador que abriu a rodada. Rodadas antigas (sem dono) usam o único
    // organizador que configurou Pix; se houver mais de um, não há como saber, então não mostra.
    const { data: round } = await db
      .from("rounds")
      .select("created_by")
      .eq("id", data.roundId)
      .maybeSingle();
    const cols = "pix_key, pix_key_type, pix_name, pix_city";
    let cfg: {
      pix_key: string | null;
      pix_key_type: string | null;
      pix_name: string | null;
      pix_city: string | null;
    } | null = null;
    if (round?.created_by) {
      const { data: own } = await db
        .from("admin_settings")
        .select(cols)
        .eq("admin_id", round.created_by)
        .maybeSingle();
      cfg = own;
    } else {
      const { data: all } = await db
        .from("admin_settings")
        .select(cols)
        .not("pix_key", "is", null)
        .limit(2);
      if (all?.length === 1) cfg = all[0] ?? null;
    }
    if (!cfg?.pix_key || !cfg.pix_key_type || !cfg.pix_name || !cfg.pix_city) {
      return { state: "unavailable", reason: "no_pix" };
    }
    try {
      return {
        state: "pay",
        totalCents: total,
        payload: pixPayload({
          key: cfg.pix_key,
          name: cfg.pix_name,
          city: cfg.pix_city,
          amountCents: total,
        }),
        receiver: cfg.pix_name,
        keyMasked: maskPixKey(cfg.pix_key_type as PixKeyType, cfg.pix_key),
      };
    } catch (e) {
      console.error(e);
      return { state: "unavailable", reason: "no_pix" };
    }
  });

// ---------- Quem ainda não pediu (admin) ----------

export type PendingParticipant = { id: string; name: string; phone: string; phoneE164: string };

/**
 * Participantes com celular que já pediram em outra rodada e não têm pedido confirmado nesta.
 * Só para administradores (o celular não vai ao navegador do participante). `now` = relógio do servidor.
 */
export const getPendingParticipants = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ roundId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ now: string; people: PendingParticipant[] }> => {
    const db = await admin();
    const est = await assertRoundAccess(db, context, data.roundId);
    const [{ data: past, error }, { data: here, error: e2 }] = await Promise.all([
      db
        .from("orders")
        .select(
          "participant_id, participants(display_name, phone_e164), rounds!inner(establishment_id)",
        )
        .eq("status", "confirmed")
        // "Já pediu antes" vale só dentro do mesmo estabelecimento.
        .eq("rounds.establishment_id", est)
        .neq("round_id", data.roundId)
        .limit(2000),
      db
        .from("orders")
        .select("participant_id")
        .eq("status", "confirmed")
        .eq("round_id", data.roundId),
    ]);
    if (error || e2) throw new Error("Não foi possível carregar quem ainda não pediu.");
    const ordered = new Set((here ?? []).map((r) => r.participant_id));
    const seen = new Map<string, PendingParticipant>();
    for (const r of (past ?? []) as unknown as {
      participant_id: string;
      participants: { display_name: string; phone_e164: string | null } | null;
    }[]) {
      const p = r.participants;
      if (!p?.phone_e164 || ordered.has(r.participant_id) || seen.has(r.participant_id)) continue;
      seen.set(r.participant_id, {
        id: r.participant_id,
        name: p.display_name,
        phone: formatPhone(p.phone_e164),
        phoneE164: p.phone_e164,
      });
    }
    const people = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return { now: new Date().toISOString(), people };
  });

// ---------- Status do pedido do participante ----------

export type MyStatus =
  { state: "none" } | { state: OrderProgress; doneAt: string | null; roundName: string };

/** Em que pé está o pedido: recebido, em preparo ou pronto. Só lê o pedido do próprio participante. */
export const getMyStatus = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ token: tokenSchema, roundId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<MyStatus> => {
    const db = await admin();
    const found = await findParticipant(db, data.token);
    if (!found) return { state: "none" };
    const [{ data: order }, { data: roundState }, { data: round }] = await Promise.all([
      db
        .from("orders")
        .select("status, done_at")
        .eq("round_id", data.roundId)
        .eq("participant_id", found.id)
        .maybeSingle(),
      db.rpc("get_round_state", { p_round: data.roundId }),
      db.from("rounds").select("name").eq("id", data.roundId).maybeSingle(),
    ]);
    if (!order || order.status !== "confirmed") return { state: "none" };
    return {
      state: orderProgress({
        roundState: (roundState as RoundState | null) ?? "open",
        doneAt: order.done_at,
      }),
      doneAt: order.done_at,
      roundName: round?.name ?? "",
    };
  });

export const renameParticipant = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ name: z.string().trim().min(1, "Informe seu nome").max(60), token: tokenSchema })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db
      .from("participants")
      .update({ display_name: data.name })
      .eq("token_hash", await hashToken(data.token));
    if (error) throw new Error("Não foi possível alterar o nome.");
    return { ok: true };
  });

async function requireOpenRound(db: Awaited<ReturnType<typeof admin>>, roundId: string) {
  const { data } = await db.rpc("get_round_state", { p_round: roundId });
  if (data === "waiting") throw new Error("O cardápio ainda não abriu para pedidos.");
  if (data !== "open") throw new Error("Os pedidos já foram encerrados.");
}

export type SubmitResult =
  | { ok: true; version: number; orderId: string; replayed: boolean }
  | { ok: false; code: OrderErrorCode; message: string };

/**
 * Cria ou atualiza o pedido (confirmação e edição) em UMA transação no banco (`submit_order`):
 * horário, produtos, limites por categoria e versão são validados lá. Falhas esperadas voltam como
 * `ok: false` com código estável; o sucesso só é devolvido depois de gravado.
 * `requestId` torna o reenvio seguro (mesma chave = mesmo resultado, sem duplicar).
 */
export const submitOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        token: tokenSchema,
        roundId: z.string().uuid(),
        expectedVersion: z.number().int().min(0),
        requestId: z.string().uuid(),
        items: z
          .array(
            z.object({
              product_id: z.string().uuid(),
              quantity: z.number().int().min(1).max(99),
              note: z
                .string()
                .max(NOTE_MAX * 2)
                .nullish()
                .transform((v) => cleanNote(v))
                .refine(
                  (v) => v === null || v.length <= NOTE_MAX,
                  `Use até ${NOTE_MAX} caracteres`,
                ),
            }),
          )
          .min(1, "Escolha ao menos um item")
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<SubmitResult> => {
    const db = await admin();
    const sec = await import("@/lib/participant-security.server");
    if (!(await sec.withinRateLimit(db, "submit", 30, 300))) {
      return { ok: false, code: "RATE_LIMITED", message: RATE_LIMITED_MESSAGE };
    }
    const participant = await findParticipant(db, data.token);
    if (!participant) return { ok: false, ...mapOrderError("PARTICIPANT_NOT_FOUND") };

    const { data: res, error } = await db.rpc("submit_order", {
      p_participant: participant.id,
      p_round: data.roundId,
      p_items: data.items,
      p_expected_version: data.expectedVersion,
      p_request_id: data.requestId,
    });
    if (error) {
      const mapped = mapOrderError(error.message, error.details);
      if (mapped.code === "UNKNOWN") console.error(error);
      return { ok: false, ...mapped };
    }
    const r = res as { order_id: string; version: number; replayed: boolean };
    return { ok: true, version: r.version, orderId: r.order_id, replayed: r.replayed };
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ token: tokenSchema, roundId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const participant = await findParticipant(db, data.token);
    if (!participant) throw new Error("Participante não reconhecido. Recarregue a página.");
    await requireOpenRound(db, data.roundId);
    const { error } = await db
      .from("orders")
      .update({ status: "cancelled" })
      .eq("round_id", data.roundId)
      .eq("participant_id", participant.id);
    if (error) throw new Error("Não foi possível cancelar o pedido.");
    return { ok: true };
  });

// ---------- Admin: pedidos ----------

export type RoundOrderItem = {
  product_id: string;
  product: string;
  category: string | null;
  category_position: number;
  price_cents: number | null;
  quantity: number;
  /** Observação do participante ("sem cebola"). */
  note: string | null;
};

export type RoundOrder = {
  order_id: string;
  participant_id: string;
  participant: string;
  /** Celular formatado (só o painel vê; serve para contato e para conferir quem pede a redefinição do código). */
  phone: string | null;
  created_at: string;
  updated_at: string;
  /** Pedido alterado depois da confirmação inicial. */
  edited: boolean;
  /** Quando o organizador marcou como pago (null = pendente). */
  paid_at: string | null;
  /** Quando o estabelecimento marcou como concluído na comanda ao vivo (null/ausente = pendente). */
  done_at?: string | null;
  items: RoundOrderItem[];
};

export const getRoundOrders = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ roundId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertRoundAccess(db, context, data.roundId);
    const { data: rows, error } = await db
      .from("orders")
      .select(
        "id, created_at, updated_at, version, paid_at, done_at, participant_id, participants(display_name, phone_e164), order_items(quantity, note, product_id, unit_price_cents, products(name, categories(name, position)))",
      )
      .eq("round_id", data.roundId)
      .eq("status", "confirmed")
      .order("created_at");
    if (error) throw new Error("Não foi possível carregar os pedidos.");
    type Row = {
      id: string;
      created_at: string;
      updated_at: string;
      version: number;
      paid_at: string | null;
      done_at: string | null;
      participant_id: string;
      participants: { display_name: string; phone_e164: string | null } | null;
      order_items: {
        quantity: number;
        note: string | null;
        product_id: string;
        unit_price_cents: number | null;
        products: {
          name: string;
          categories: { name: string; position: number } | null;
        } | null;
      }[];
    };
    const orders: RoundOrder[] = (rows as unknown as Row[]).map((o) => ({
      order_id: o.id,
      participant_id: o.participant_id,
      participant: o.participants?.display_name ?? "—",
      phone: o.participants?.phone_e164 ? formatPhone(o.participants.phone_e164) : null,
      created_at: o.created_at,
      updated_at: o.updated_at,
      edited: o.version > 1,
      paid_at: o.paid_at,
      done_at: o.done_at,
      items: o.order_items
        .map((i) => ({
          product_id: i.product_id,
          product: i.products?.name ?? "Item removido",
          category: i.products?.categories?.name ?? null,
          category_position: i.products?.categories?.position ?? 9999,
          price_cents: i.unit_price_cents,
          quantity: i.quantity,
          note: i.note ?? null,
        }))
        .sort(
          (a, b) =>
            a.category_position - b.category_position ||
            a.product.localeCompare(b.product, "pt-BR"),
        ),
    }));
    return orders;
  });

/**
 * Registra que a comanda foi impressa com os dados até `printedAt` (o instante dos pedidos que
 * estavam na folha, não o do clique): qualquer pedido alterado depois disso aparece como "alterado".
 * Nunca volta no tempo.
 */
export const markRoundPrinted = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) =>
    z.object({ roundId: z.string().uuid(), printedAt: z.string().datetime() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertRoundAccess(db, context, data.roundId);
    const at = new Date(Math.min(Date.parse(data.printedAt), Date.now())).toISOString();
    const { error } = await db
      .from("rounds")
      .update({ last_printed_at: at })
      .eq("id", data.roundId)
      .or(`last_printed_at.is.null,last_printed_at.lt.${at}`);
    if (error) throw new Error("Não foi possível registrar a impressão.");
    return { ok: true, printedAt: at };
  });

/** Marca (ou desmarca) um pedido como pago. Só o organizador faz isso; não altera o pedido em si. */
export const setOrderPaid = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ orderId: z.string().uuid(), paid: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertOrderAccess(db, context, data.orderId);
    const { data: row, error } = await db
      .from("orders")
      .update({
        paid_at: data.paid ? new Date().toISOString() : null,
        paid_by: data.paid ? context.adminId : null,
      })
      .eq("id", data.orderId)
      .eq("status", "confirmed")
      .select("paid_at")
      .maybeSingle();
    if (error) throw new Error("Não foi possível atualizar o pagamento.");
    if (!row) throw new Error("Pedido não encontrado ou cancelado.");
    return { ok: true, paidAt: row.paid_at };
  });

/** Linha mínima de cada pedido da rodada, para detectar novidades sem baixar o conteúdo todo. */
export type PulseRow = {
  id: string;
  version: number;
  status: "confirmed" | "cancelled";
  name: string;
};

/**
 * "Pulso" da rodada: id, versão, situação e nome de cada pedido (incluindo cancelados).
 * Bem mais leve que `getRoundOrders`; o painel consulta a cada poucos segundos para tocar o alerta
 * e só então recarrega a lista completa.
 */
export const getOrdersPulse = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ roundId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PulseRow[]> => {
    const db = await admin();
    await assertRoundAccess(db, context, data.roundId);
    const { data: rows, error } = await db
      .from("orders")
      .select("id, version, status, participants(display_name)")
      .eq("round_id", data.roundId)
      .order("created_at")
      .limit(1000);
    if (error) throw new Error("Não foi possível consultar os pedidos.");
    return (
      rows as unknown as {
        id: string;
        version: number;
        status: string;
        participants: { display_name: string } | null;
      }[]
    ).map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status === "cancelled" ? "cancelled" : "confirmed",
      name: r.participants?.display_name ?? "Alguém",
    }));
  });

/**
 * Redefine o código de recuperação de um participante (quem perdeu o código e não está mais logado).
 * Devolve o código novo UMA vez, para o organizador repassar. Confira a identidade antes (ex.: pelo celular).
 */
export const resetParticipantCode = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ participantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: p } = await db
      .from("participants")
      .select("id, phone_e164")
      .eq("id", data.participantId)
      .maybeSingle();
    if (!p) throw new Error("Participante não encontrado.");
    // O cadastro do participante é global: só quem tem pedido em um estabelecimento seu pode redefinir.
    if (!context.isSuper) {
      const { count } = await db
        .from("orders")
        .select("id, rounds!inner(establishment_id)", { count: "exact", head: true })
        .eq("participant_id", p.id)
        .in(
          "rounds.establishment_id",
          context.establishmentIds.length
            ? context.establishmentIds
            : ["00000000-0000-0000-0000-000000000000"],
        );
      if (!count)
        throw new Error("Forbidden: este participante não pediu nos seus estabelecimentos.");
    }
    if (!p.phone_e164) {
      throw new Error(
        "Este participante não tem celular cadastrado, então não há como recuperar por código.",
      );
    }
    const sec = await import("@/lib/participant-security.server");
    const code = generateRecoveryCode();
    const { error } = await db
      .from("participants")
      .update({
        recovery_hash: await sec.hashRecoveryCode(normalizeRecoveryCode(code)),
        recovery_attempts: 0,
        locked_until: null,
      })
      .eq("id", p.id);
    if (error) throw new Error("Não foi possível gerar o novo código.");
    return { code };
  });
