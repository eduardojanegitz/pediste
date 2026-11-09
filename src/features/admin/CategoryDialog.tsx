import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { stepTitle } from "@/features/order/logic";
import { saveCategory, type CatalogCategory } from "@/lib/catalog.functions";
import { categoryInputSchema } from "@/lib/category-rules";
import { btnPlain, btnPrimary, errMsg, field } from "./ui";

type Errors = Partial<Record<"name" | "description" | "min_select" | "max_select", string>>;

/** Criar/editar categoria: nome, descrição, limites de seleção, quantidade por opção e disponibilidade. */
export function CategoryDialog({
  category,
  establishmentId,
  onClose,
  onSaved,
}: {
  category: CatalogCategory | "new" | null;
  /** Estabelecimento onde a categoria nova será criada (ignorado ao editar). */
  establishmentId?: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = category && category !== "new" ? category : null;
  const save = useServerFn(saveCategory);
  const [name, setName] = useState(c?.name ?? "");
  const [description, setDescription] = useState(c?.description ?? "");
  const [min, setMin] = useState(String(c?.min_select ?? 1));
  const [max, setMax] = useState(String(c?.max_select ?? 1));
  const [allowQty, setAllowQty] = useState(c?.allow_quantity ?? false);
  const [active, setActive] = useState(c?.is_active ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const input = {
    ...(c ? { id: c.id } : {}),
    name,
    description: description || null,
    min_select: min === "" ? NaN : Number(min),
    max_select: max === "" ? NaN : Number(max),
    allow_quantity: allowQty,
    is_active: active,
  };
  const parsed = categoryInputSchema.safeParse(input);
  const preview = parsed.success ? stepTitle({ ...parsed.data, id: "x", position: 0 }) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        next[key] ??= Number.isNaN(input[key as "min_select"])
          ? "Informe um número"
          : issue.message;
      }
      setErrors(next);
      return;
    }
    setSaving(true);
    try {
      await save({
        data: c || !establishmentId ? parsed.data : { ...parsed.data, establishmentId },
      });
      toast.success(c ? "Categoria atualizada" : "Categoria criada");
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const err = (k: keyof Errors) =>
    errors[k] && (
      <p id={`c-${k}-err`} role="alert" className="mt-1 text-sm font-semibold text-destructive">
        {errors[k]}
      </p>
    );

  return (
    <Dialog open={category !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-2 border-foreground bg-background shadow-pop-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-4xl font-normal">
            {c ? "Editar categoria" : "Nova categoria"}
          </DialogTitle>
          <DialogDescription>
            Cada categoria vira uma etapa do pedido, na ordem da lista.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="c-name" className="mb-1 block text-sm font-bold">
              Nome
            </label>
            <input
              id="c-name"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "c-name-err" : undefined}
              className={field}
              placeholder="Ex.: Acompanhamentos"
            />
            {err("name")}
          </div>
          <div>
            <label htmlFor="c-desc" className="mb-1 block text-sm font-bold">
              Descrição (opcional)
            </label>
            <input
              id="c-desc"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={field}
              placeholder="Aparece abaixo do título da etapa"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="c-min" className="mb-1 block text-sm font-bold">
                Mínimo de escolhas
              </label>
              <input
                id="c-min"
                type="number"
                inputMode="numeric"
                min={0}
                max={50}
                value={min}
                onChange={(e) => setMin(e.target.value)}
                aria-invalid={!!errors.min_select}
                aria-describedby={errors.min_select ? "c-min_select-err" : undefined}
                className={field}
              />
              {err("min_select")}
            </div>
            <div>
              <label htmlFor="c-max" className="mb-1 block text-sm font-bold">
                Máximo de escolhas
              </label>
              <input
                id="c-max"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={max}
                onChange={(e) => setMax(e.target.value)}
                aria-invalid={!!errors.max_select}
                aria-describedby={errors.max_select ? "c-max_select-err" : undefined}
                className={field}
              />
              {err("max_select")}
            </div>
          </div>
          <p className="-mt-2 text-sm text-muted-foreground">
            O limite conta <strong>opções diferentes</strong>. Mínimo 0 deixa a etapa opcional.
          </p>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-foreground bg-card p-3">
            <input
              type="checkbox"
              checked={allowQty}
              onChange={(e) => setAllowQty(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
            />
            <span className="text-sm">
              <strong className="block">Permitir mais de 1 unidade da mesma opção</strong>
              <span className="text-muted-foreground">
                Desligado: cada opção vale 1 unidade (recomendado).
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-foreground bg-card p-3">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
            />
            <span className="text-sm">
              <strong className="block">Categoria ativa</strong>
              <span className="text-muted-foreground">
                Desativada, ela some do cardápio sem apagar os produtos.
              </span>
            </span>
          </label>

          <p
            aria-live="polite"
            className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground"
          >
            {preview ? (
              <>Participantes verão: “{preview}”</>
            ) : (
              "Corrija os campos para ver como fica."
            )}
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={btnPlain}>
              Cancelar
            </button>
            <button disabled={saving} className={btnPrimary}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
