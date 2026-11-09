import { formatBRL, formatSaoPaulo } from "@/lib/format";
import type { RoundOrder } from "@/lib/orders.functions";
import { consolidate, groupByCategory, NO_CATEGORY, summarize } from "./orders-logic";
import { orderTotal, type ChangeKind, type ComandaMode, type PaperSize } from "./comanda";
import "./comanda.css";
import "./print-root.css";

type Props = {
  roundName: string;
  /** Instante em que a folha foi gerada (ISO). */
  generatedAt: string;
  orders: RoundOrder[];
  mode: ComandaMode;
  paper: PaperSize;
  showPhone: boolean;
  showPrices: boolean;
  /** Pedidos alterados desde a última impressão (para avisar na folha). */
  changed: Map<string, ChangeKind>;
  lastPrintedAt: string | null;
};

const KIND_LABEL: Record<ChangeKind, string> = { new: "novo", edited: "editado" };

/**
 * A folha da comanda. Usada na prévia da tela e, idêntica, no papel (ver comanda.css).
 * - "kitchen": consolidado por categoria e produto, para quem prepara/atende (estabelecimento).
 * - "people": um ticket por pessoa, na ordem dos pedidos.
 */
export function ComandaSheet(p: Props) {
  const stats = summarize(p.orders);
  const priced = p.showPrices && stats.totalCents != null;
  return (
    <div className="comanda" data-paper={p.paper}>
      <p className="comanda__brand">PEDISTE · COMANDA</p>
      <h1 className="comanda__title">{p.roundName}</h1>
      <p className="comanda__meta">
        {formatSaoPaulo(p.generatedAt)} · {stats.orders} pedido{stats.orders === 1 ? "" : "s"} ·{" "}
        {stats.items} ite{stats.items === 1 ? "m" : "ns"}
      </p>

      {p.mode === "kitchen" ? (
        <Kitchen {...p} priced={priced} />
      ) : (
        <People {...p} priced={priced} />
      )}

      <p className="comanda__foot">Gerado por Pediste</p>
    </div>
  );
}

function Kitchen({ orders, changed, lastPrintedAt, priced }: Props & { priced: boolean }) {
  const cats = consolidate(orders);
  const changedList = orders.filter((o) => changed.has(o.order_id));
  return (
    <>
      <hr className="comanda__rule" />
      {changedList.length > 0 && lastPrintedAt && (
        <div className="comanda__changed" role="note">
          Mudou desde a última impressão ({formatSaoPaulo(lastPrintedAt)}):
          <p className="comanda__people-list" style={{ textTransform: "none", fontWeight: 600 }}>
            {changedList
              .map((o) => `${o.participant} (${KIND_LABEL[changed.get(o.order_id)!]})`)
              .join(", ")}
          </p>
        </div>
      )}
      {cats.map((c) => (
        <section key={c.category ?? NO_CATEGORY} aria-label={c.category ?? "Sem categoria"}>
          <h2 className="comanda__cat">
            {c.category ?? "Sem categoria"} · {c.quantity}
          </h2>
          <ul>
            {c.products.map((pr) => (
              <li key={pr.product_id} className="comanda__line">
                <span className="comanda__qty">{pr.quantity}x</span>
                <span className="comanda__name">{pr.product}</span>
                <span className="comanda__price">
                  {priced && pr.revenue ? formatBRL(pr.revenue) : ""}
                </span>
                {pr.notes.map((n, k) => (
                  <span key={k} className="comanda__note">
                    ↳ {n.text} ({n.person})
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {priced && (
        <p className="comanda__total">
          <span>TOTAL</span>
          <span>{formatBRL(summarize(orders).totalCents ?? 0)}</span>
        </p>
      )}
    </>
  );
}

function People({ orders, paper, showPhone, priced, changed }: Props & { priced: boolean }) {
  return (
    <>
      <hr className="comanda__rule" />
      <div className="comanda__tickets">
        {orders.map((o, idx) => {
          const total = orderTotal(o);
          const change = changed.get(o.order_id);
          return (
            <article key={o.order_id} className="comanda__ticket" aria-label={o.participant}>
              <h2 className="comanda__title" style={{ fontSize: "calc(var(--c-fs) * 1.35)" }}>
                {o.participant}
              </h2>
              <p className="comanda__meta">
                Pedido {idx + 1} de {orders.length}
                {showPhone && o.phone ? ` · ${o.phone}` : ""}
              </p>
              {change && (
                <p className="comanda__changed">
                  {change === "new" ? "Pedido novo" : "Alterado"} após a última impressão
                </p>
              )}
              {groupByCategory(o.items).map((g) => (
                <section key={g.category ?? NO_CATEGORY}>
                  <h3 className="comanda__cat">{g.category ?? "Sem categoria"}</h3>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it.product_id} className="comanda__line">
                        <span className="comanda__qty">{it.quantity}x</span>
                        <span className="comanda__name">{it.product}</span>
                        <span className="comanda__price">
                          {priced && it.price_cents ? formatBRL(it.price_cents * it.quantity) : ""}
                        </span>
                        {it.note && <span className="comanda__note">↳ {it.note}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {priced && total != null && (
                <p className="comanda__total">
                  <span>TOTAL</span>
                  <span>{formatBRL(total)}</span>
                </p>
              )}
              {paper !== "a4" && <hr className="comanda__rule" />}
            </article>
          );
        })}
      </div>
    </>
  );
}
