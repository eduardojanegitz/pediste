import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-middleware";
import { isBoardToken, shortName, type BoardOrder, type SharedBoardResult } from "@/lib/board";
import type { RoundState } from "@/lib/orders.functions";
import { assertRoundAccess } from "@/lib/scope.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** 256 bits aleatórios em base64url (43 caracteres). Só o hash vai para o banco. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const MAX_ACTIVE_LINKS = 10;

type Db = Awaited<ReturnType<typeof admin>>;
type LinkLookup =
  { ok: true; roundId: string } | { ok: false; status: "invalid" | "expired" | "revoked" };

/** Token → rodada, se o link existe, não foi revogado e não expirou. */
async function resolveLink(
  db: Db,
  sha256Hex: (t: string) => Promise<string>,
  token: string,
): Promise<LinkLookup> {
  if (!isBoardToken(token)) return { ok: false, status: "invalid" };
  const { data: link } = await db
    .from("board_links")
    .select("round_id, expires_at, revoked_at")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (!link) return { ok: false, status: "invalid" };
  if (link.revoked_at) return { ok: false, status: "revoked" };
  if (Date.parse(link.expires_at) <= Date.now()) return { ok: false, status: "expired" };
  return { ok: true, roundId: link.round_id };
}

export type BoardLink = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

/** Gera um link novo do estabelecimento para a rodada. O token só aparece AGORA (no banco fica o hash). */
export const createBoardLink = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) =>
    z
      .object({
        roundId: z.string().uuid(),
        hours: z.union([z.literal(6), z.literal(24), z.literal(72)]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const sec = await import("@/lib/participant-security.server");
    await assertRoundAccess(db, context, data.roundId);
    const now = new Date();
    const { count } = await db
      .from("board_links")
      .select("id", { count: "exact", head: true })
      .eq("round_id", data.roundId)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString());
    if ((count ?? 0) >= MAX_ACTIVE_LINKS)
      throw new Error(
        "Já existem muitos links ativos nesta rodada. Revogue algum antes de criar outro.",
      );
    const token = newToken();
    const expiresAt = new Date(now.getTime() + data.hours * 3_600_000).toISOString();
    const { data: row, error } = await db
      .from("board_links")
      .insert({
        round_id: data.roundId,
        token_hash: await sec.sha256Hex(token),
        created_by: context.adminId,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error("Não foi possível criar o link.");
    return { id: row.id, token, expiresAt };
  });

export const listBoardLinks = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ roundId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<BoardLink[]> => {
    const db = await admin();
    await assertRoundAccess(db, context, data.roundId);
    const { data: rows, error } = await db
      .from("board_links")
      .select("id, created_at, expires_at, revoked_at")
      .eq("round_id", data.roundId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error("Não foi possível carregar os links.");
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
    }));
  });

/** Revoga na hora: quem estiver com a página aberta recebe "link revogado" na próxima atualização. */
export const revokeBoardLink = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: link } = await db
      .from("board_links")
      .select("round_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!link) throw new Error("Link não encontrado.");
    await assertRoundAccess(db, context, link.round_id);
    const { error } = await db
      .from("board_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("revoked_at", null);
    if (error) throw new Error("Não foi possível revogar o link.");
    return { ok: true };
  });

/**
 * Leitura pública da comanda ao vivo. A autorização é o próprio token (aleatório, com prazo, revogável).
 * Só devolve o que o estabelecimento precisa: itens, quantidades, observações e nome curto.
 * Nunca celular, preço, pagamento ou código do participante.
 */
export const getSharedBoard = createServerFn({ method: "POST" })
  // Formato fora do padrão (ex.: link cortado ao colar) não é erro de servidor: é "link inválido".
  .validator((d: unknown) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }): Promise<SharedBoardResult> => {
    const db = await admin();
    const sec = await import("@/lib/participant-security.server");
    if (!(await sec.withinRateLimit(db, "board", 180, 60))) return { status: "rate_limited" };
    const link = await resolveLink(db, sec.sha256Hex, data.token);
    if (!link.ok) return { status: link.status };

    const [{ data: round }, { data: state }, { data: rows, error }] = await Promise.all([
      db.from("rounds").select("name, closes_at").eq("id", link.roundId).maybeSingle(),
      db.rpc("get_round_state", { p_round: link.roundId }),
      db
        .from("orders")
        .select(
          "id, version, status, created_at, updated_at, done_at, participants(display_name), order_items(quantity, note, product_id, products(name, categories(name, position)))",
        )
        .eq("round_id", link.roundId)
        .order("created_at")
        .limit(1000),
    ]);
    if (error || !round) return { status: "invalid" };

    type Row = {
      id: string;
      version: number;
      status: string;
      created_at: string;
      updated_at: string;
      done_at: string | null;
      participants: { display_name: string } | null;
      order_items: {
        quantity: number;
        note: string | null;
        product_id: string;
        products: { name: string; categories: { name: string; position: number } | null } | null;
      }[];
    };
    const orders: BoardOrder[] = (rows as unknown as Row[]).map((o) => {
      const cancelled = o.status === "cancelled";
      return {
        id: o.id,
        name: shortName(o.participants?.display_name ?? ""),
        version: o.version,
        status: cancelled ? "cancelled" : "confirmed",
        created_at: o.created_at,
        updated_at: o.updated_at,
        done_at: cancelled ? null : o.done_at,
        items: cancelled
          ? []
          : o.order_items
              .map((i) => ({
                product_id: i.product_id,
                product: i.products?.name ?? "Item removido",
                category: i.products?.categories?.name ?? null,
                category_position: i.products?.categories?.position ?? 9999,
                quantity: i.quantity,
                note: i.note ?? null,
              }))
              .sort(
                (a, b) =>
                  a.category_position - b.category_position ||
                  a.product.localeCompare(b.product, "pt-BR"),
              ),
      };
    });
    return {
      status: "ok",
      board: {
        roundName: round.name,
        state: (state as RoundState | null) ?? "closed",
        closesAt: round.closes_at,
        now: new Date().toISOString(),
        orders,
      },
    };
  });

/**
 * Marca (ou desmarca) um pedido como concluído, pela comanda ao vivo. A autorização é o mesmo token do
 * link: só vale para pedidos confirmados da rodada daquele link. Não altera o pedido em si.
 */
export const setBoardOrderDone = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ token: z.string().max(200), orderId: z.string().uuid(), done: z.boolean() })
      .parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; doneAt: string | null }
      | { ok: false; status: "invalid" | "expired" | "revoked" | "rate_limited" | "not_found" }
    > => {
      const db = await admin();
      const sec = await import("@/lib/participant-security.server");
      if (!(await sec.withinRateLimit(db, "board-done", 120, 60)))
        return { ok: false, status: "rate_limited" };
      const link = await resolveLink(db, sec.sha256Hex, data.token);
      if (!link.ok) return { ok: false, status: link.status };
      const { data: row, error } = await db
        .from("orders")
        .update({ done_at: data.done ? new Date().toISOString() : null })
        .eq("id", data.orderId)
        .eq("round_id", link.roundId)
        .eq("status", "confirmed")
        .select("done_at, participant_id")
        .maybeSingle();
      if (error) throw new Error("Não foi possível atualizar o pedido.");
      if (!row) return { ok: false, status: "not_found" };
      if (data.done) {
        const { notifyOrderReady } = await import("@/lib/push-notify.server");
        await notifyOrderReady(db, row.participant_id);
      }
      return { ok: true, doneAt: row.done_at };
    },
  );
