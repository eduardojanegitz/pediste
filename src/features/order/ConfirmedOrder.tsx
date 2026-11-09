import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, KeyRound, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Logo } from "@/components/brand/Logo";
import { formatBRL, formatSaoPauloTime } from "@/lib/format";
import { cancelOrder, type ActiveRound, type MyOrder } from "@/lib/orders.functions";
import { buildSteps, selectedLines, totalCents, type Cart } from "./logic";
import { OrderStatus } from "./OrderStatus";
import { PixPayment } from "./PixPayment";
import { RecoveryDialog } from "./RecoveryDialog";
import { clearDraft } from "./storage";
import type { Menu } from "./types";
import { btnPlain, btnPrimary, errMsg } from "./ui";

/** Pedido já confirmado: resumo por categoria, com editar/cancelar enquanto a rodada aceitar pedidos. */
export function ConfirmedOrder({
  round,
  token,
  me,
  menu,
  canEdit,
  justUpdated,
  onEdit,
}: {
  round: ActiveRound;
  token: string;
  me: MyOrder;
  menu: Menu;
  canEdit: boolean;
  justUpdated: boolean;
  onEdit: () => void;
}) {
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const cancel = useServerFn(cancelOrder);
  const [askCancel, setAskCancel] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);

  const steps = buildSteps(menu.categories, menu.products);
  const cart: Cart = Object.fromEntries(me.items.map((i) => [i.product_id, i.quantity]));
  const noteOf = new Map(me.items.map((i) => [i.product_id, i.note]));
  const known = new Set(menu.products.map((p) => p.id));
  const gone = me.items.filter((i) => !known.has(i.product_id));
  // Valores do pedido já confirmado: o preço guardado nele (não muda se o produto for reajustado).
  const priceOf = new Map(me.items.map((i) => [i.product_id, i.unit_price_cents]));
  const total = me.items.some((i) => i.unit_price_cents != null)
    ? me.items.reduce((s, i) => s + (i.unit_price_cents ?? 0) * i.quantity, 0)
    : null;

  const doCancel = async () => {
    setBusy(true);
    try {
      await cancel({ data: { token, roundId: round.id } });
      clearDraft(round.id, me.participant.id);
      toast.success("Pedido cancelado");
      await qc.invalidateQueries({ queryKey: ["my-order"] });
      void qc.invalidateQueries({ queryKey: ["my-payment"] });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      setAskCancel(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-8">
      <div className="text-center">
        <Logo className="text-5xl" animate={false} />
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="pop-card mt-5 bg-accent p-6 text-accent-foreground"
      >
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {round.name}
        </p>
        <h1 className="mt-1 text-5xl">
          {justUpdated ? "Pedido atualizado" : "Pedido confirmado"}, {me.participant.display_name}!
        </h1>
      </motion.div>

      {gone.length > 0 && (
        <div
          role="alert"
          className="mt-4 flex gap-3 rounded-2xl border-2 border-foreground bg-card p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <p className="text-sm font-medium">
            Não está mais disponível:{" "}
            <strong>{gone.map((g) => g.product_name ?? "Item removido").join(", ")}</strong>.
            {canEdit ? " Edite seu pedido para escolher outra opção." : ""}
          </p>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {steps.map((step) => {
          const lines = selectedLines(cart, step);
          if (lines.length === 0) return null;
          return (
            <section
              key={step.category.id}
              aria-label={step.category.name}
              className="pop-card p-4"
            >
              <h2 className="text-3xl">{step.category.name}</h2>
              <ul className="mt-2 space-y-1.5">
                {lines.map(({ product, quantity }) => (
                  <li key={product.id} className="flex items-center justify-between gap-3">
                    <span className="font-semibold">
                      {quantity > 1 && <span className="mr-1 text-primary">{quantity}×</span>}
                      {product.name}
                      {noteOf.get(product.id) && (
                        <span className="block text-sm font-medium text-muted-foreground">
                          Obs.: {noteOf.get(product.id)}
                        </span>
                      )}
                    </span>
                    {priceOf.get(product.id) != null && (
                      <span className="text-sm text-muted-foreground">
                        {formatBRL((priceOf.get(product.id) ?? 0) * quantity)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {total != null && (
          <p className="flex items-center justify-between rounded-2xl border-2 border-foreground bg-secondary px-4 py-3 text-lg font-bold text-secondary-foreground">
            <span>Total</span>
            <span>{formatBRL(total)}</span>
          </p>
        )}
      </div>

      <OrderStatus token={token} roundId={round.id} />

      <PixPayment token={token} roundId={round.id} />

      {canEdit ? (
        <>
          <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" aria-hidden />
            Você pode editar ou cancelar
            {round.closes_at
              ? ` até ${formatSaoPauloTime(round.closes_at)}`
              : " até o fim da rodada"}
            .
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={onEdit}>
              <Pencil className="h-4 w-4" aria-hidden /> Editar pedido
            </button>
            <button disabled={busy} className={btnPlain} onClick={() => setAskCancel(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Cancelar pedido
            </button>
          </div>
        </>
      ) : (
        <p className="mt-5 flex items-center gap-2 rounded-2xl border-2 border-foreground bg-card px-4 py-3 text-sm font-medium">
          <Clock className="h-4 w-4 shrink-0" aria-hidden /> Os pedidos foram encerrados, então este
          pedido não pode mais ser alterado.
        </p>
      )}

      <button
        onClick={() => setRecovery(true)}
        className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <KeyRound className="h-4 w-4" aria-hidden />{" "}
        {me.has_phone ? "Gerar novo código de recuperação" : "Acessar em outro aparelho"}
      </button>

      <RecoveryDialog
        open={recovery}
        onOpenChange={setRecovery}
        token={token}
        name={me.participant.display_name}
        hasPhone={me.has_phone}
      />
      <AlertDialog open={askCancel} onOpenChange={setAskCancel}>
        <AlertDialogContent className="rounded-3xl border-2 border-foreground bg-background">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-3xl font-normal">
              Cancelar seu pedido?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Você poderá fazer um novo pedido enquanto as vendas estiverem abertas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doCancel()}>Cancelar pedido</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
