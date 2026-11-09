import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, TriangleAlert, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CategoryDialog } from "@/features/admin/CategoryDialog";
import {
  pickEstablishment,
  readStoredEstablishment,
  useEstablishment,
} from "@/features/admin/establishment-context";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import { ProductDialog } from "@/features/admin/ProductDialog";
import { moveId } from "@/features/admin/reorder";
import { btnPlain, btnPrimary, errMsg, iconBtn } from "@/features/admin/ui";
import {
  deleteCategory,
  deleteProduct,
  getCatalog,
  reorderCategories,
  reorderProducts,
  setCategoryActive,
  setProductActive,
  type CatalogCategory,
  type CatalogProduct,
} from "@/lib/catalog.functions";
import { ruleSummary } from "@/lib/category-rules";
import { formatBRL } from "@/lib/format";

const catalogQuery = (establishmentId: string) =>
  queryOptions({
    queryKey: ["catalog", establishmentId],
    queryFn: () => getCatalog({ data: { establishmentId } }),
  });

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Cardápio — PedeAí!" },
      {
        name: "description",
        content: "Gerencie categorias, produtos e regras de escolha do cardápio.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => {
    const est = pickEstablishment(context.establishments, readStoredEstablishment());
    return est ? context.queryClient.ensureQueryData(catalogQuery(est.id)) : undefined;
  },
  pendingComponent: AdminSkeleton,
  component: MenuAdminPage,
});

function AdminSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-14 w-64 animate-pulse rounded-2xl bg-muted" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-3xl bg-muted" />
      ))}
    </div>
  );
}

type Pending =
  { kind: "category"; item: CatalogCategory } | { kind: "product"; item: CatalogProduct } | null;

function MenuAdminPage() {
  const { current } = useEstablishment();
  const { data } = useSuspenseQuery(catalogQuery(current.id));
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const refresh = () => qc.invalidateQueries({ queryKey: ["catalog"] });

  const [editCat, setEditCat] = useState<CatalogCategory | "new" | null>(null);
  const [editProd, setEditProd] = useState<{
    product: CatalogProduct | "new";
    categoryId?: string;
  } | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const removeCat = useServerFn(deleteCategory);
  const removeProd = useServerFn(deleteProduct);
  const toggleCat = useServerFn(setCategoryActive);
  const toggleProd = useServerFn(setProductActive);
  const reorderCats = useServerFn(reorderCategories);
  const reorderProds = useServerFn(reorderProducts);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const byCategory = (id: string) => data.products.filter((p) => p.category_id === id);
  const orphans = data.products.filter((p) => !p.category_id);
  const catIds = data.categories.map((c) => c.id);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Painel
          </p>
          <h1 className="text-6xl text-primary">Cardápio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada categoria é uma etapa do pedido, na ordem abaixo.
          </p>
        </div>
        <button className={btnPrimary} onClick={() => setEditCat("new")}>
          <Plus className="h-4 w-4" aria-hidden /> Nova categoria
        </button>
      </header>

      {orphans.length > 0 && (
        <section
          aria-label="Produtos sem categoria"
          className="mb-6 rounded-3xl border-2 border-foreground bg-accent p-4 text-accent-foreground"
        >
          <p className="flex items-start gap-2 font-bold">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            {orphans.length === 1 ? "1 produto está" : `${orphans.length} produtos estão`} sem
            categoria e não aparece(m) no cardápio.
          </p>
          <ul className="mt-3 space-y-2">
            {orphans.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-2xl bg-card px-3 py-2 text-card-foreground"
              >
                <span className="min-w-0 break-words font-semibold">{p.name}</span>
                <button className={btnPlain} onClick={() => setEditProd({ product: p })}>
                  <Pencil className="h-4 w-4" aria-hidden /> Escolher categoria
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.categories.length === 0 ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="pop-card p-10 text-center"
        >
          <h2 className="text-4xl">Comece pela primeira categoria</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            Ex.: “Prato principal” (escolha 1) e “Acompanhamentos” (escolha 2). Depois adicione os
            produtos de cada uma.
          </p>
          <button className={`${btnPrimary} mt-5`} onClick={() => setEditCat("new")}>
            <Plus className="h-4 w-4" aria-hidden /> Nova categoria
          </button>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {data.categories.map((c, ci) => {
            const prods = byCategory(c.id);
            const prodIds = prods.map((p) => p.id);
            const activeCount = prods.filter((p) => p.is_active).length;
            const short = c.is_active && activeCount < c.min_select;
            return (
              <motion.section
                key={c.id}
                aria-label={c.name}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(ci * 0.05, 0.25) }}
                className={`pop-card p-4 sm:p-5 ${c.is_active ? "" : "opacity-75"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-4xl">{c.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-full bg-secondary px-3 py-0.5 font-bold text-secondary-foreground">
                        {ruleSummary(c.min_select, c.max_select)}
                      </span>
                      {c.allow_quantity && (
                        <span className="rounded-full border-2 border-foreground px-2.5 py-0.5 font-semibold">
                          com quantidade
                        </span>
                      )}
                      {!c.is_active && (
                        <span className="rounded-full border-2 border-foreground bg-muted px-2.5 py-0.5 font-semibold">
                          oculta
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                    )}
                    {short && (
                      <p
                        role="status"
                        className="mt-2 flex items-center gap-1.5 text-sm font-bold text-destructive"
                      >
                        <TriangleAlert className="h-4 w-4" aria-hidden />
                        Só há {activeCount} produto(s) disponível(is), mas o mínimo é {c.min_select}
                        : ninguém conseguirá concluir o pedido.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-semibold">
                      <Switch
                        checked={c.is_active}
                        aria-label={`Categoria ${c.name} ativa`}
                        onCheckedChange={(v) =>
                          void run(() => toggleCat({ data: { id: c.id, is_active: v } }))
                        }
                      />
                      Ativa
                    </label>
                    <button
                      className={iconBtn}
                      aria-label={`Subir ${c.name}`}
                      disabled={ci === 0}
                      onClick={() =>
                        void run(() => reorderCats({ data: { ids: moveId(catIds, c.id, -1) } }))
                      }
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      className={iconBtn}
                      aria-label={`Descer ${c.name}`}
                      disabled={ci === data.categories.length - 1}
                      onClick={() =>
                        void run(() => reorderCats({ data: { ids: moveId(catIds, c.id, 1) } }))
                      }
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      className={iconBtn}
                      aria-label={`Editar ${c.name}`}
                      onClick={() => setEditCat(c)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className={iconBtn}
                      aria-label={`Excluir ${c.name}`}
                      onClick={() => setPending({ kind: "category", item: c })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {prods.length === 0 ? (
                  <p className="mt-4 rounded-2xl border-2 border-dashed border-foreground/40 px-4 py-6 text-center text-muted-foreground">
                    Nenhum produto nesta categoria ainda.
                  </p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {prods.map((p, pi) => (
                      <li
                        key={p.id}
                        className={`flex flex-wrap items-center gap-3 rounded-2xl border-2 border-foreground bg-card p-2 pr-3 ${p.is_active ? "" : "opacity-60"}`}
                      >
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            loading="lazy"
                            className="h-14 w-14 shrink-0 rounded-xl border-2 border-foreground object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border-2 border-foreground bg-muted text-muted-foreground"
                          >
                            <ImagePlus className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="break-words font-bold">{p.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {p.price_cents != null ? formatBRL(p.price_cents) : "Sem preço"}
                            {!p.is_active && " · indisponível"}
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-sm font-semibold">
                          <Switch
                            checked={p.is_active}
                            aria-label={`${p.name} disponível`}
                            onCheckedChange={(v) =>
                              void run(() => toggleProd({ data: { id: p.id, is_active: v } }))
                            }
                          />
                          <span className="hidden sm:inline">Disponível</span>
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            className={iconBtn}
                            aria-label={`Subir ${p.name}`}
                            disabled={pi === 0}
                            onClick={() =>
                              void run(() =>
                                reorderProds({ data: { ids: moveId(prodIds, p.id, -1) } }),
                              )
                            }
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            className={iconBtn}
                            aria-label={`Descer ${p.name}`}
                            disabled={pi === prods.length - 1}
                            onClick={() =>
                              void run(() =>
                                reorderProds({ data: { ids: moveId(prodIds, p.id, 1) } }),
                              )
                            }
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            className={iconBtn}
                            aria-label={`Editar ${p.name}`}
                            onClick={() => setEditProd({ product: p })}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            className={iconBtn}
                            aria-label={`Excluir ${p.name}`}
                            onClick={() => setPending({ kind: "product", item: p })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  className={`${btnPlain} mt-4`}
                  onClick={() => setEditProd({ product: "new", categoryId: c.id })}
                >
                  <Plus className="h-4 w-4" aria-hidden /> Novo produto em {c.name}
                </button>
              </motion.section>
            );
          })}
        </div>
      )}

      <CategoryDialog
        key={editCat === "new" ? "new" : (editCat?.id ?? "none")}
        category={editCat}
        establishmentId={current.id}
        onClose={() => setEditCat(null)}
        onSaved={() => {
          setEditCat(null);
          void refresh();
        }}
      />
      <ProductDialog
        key={
          editProd
            ? editProd.product === "new"
              ? `new-${editProd.categoryId}`
              : editProd.product.id
            : "none"
        }
        product={editProd?.product ?? null}
        defaultCategoryId={editProd?.categoryId}
        categories={data.categories}
        onClose={() => setEditProd(null)}
        onSaved={() => {
          setEditProd(null);
          void refresh();
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={
          pending?.kind === "category"
            ? `Excluir “${pending.item.name}”?`
            : `Excluir “${pending?.item.name ?? ""}”?`
        }
        description={
          pending?.kind === "category"
            ? "Só é possível excluir categorias sem produtos. Para só tirar do cardápio, use o botão “Ativa”."
            : "Produtos que já aparecem em pedidos não podem ser excluídos. Para tirá-lo do cardápio, desmarque “Disponível”."
        }
        confirmLabel="Excluir"
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (!p) return;
          void run(
            () =>
              p.kind === "category"
                ? removeCat({ data: { id: p.item.id } })
                : removeProd({ data: { id: p.item.id } }),
            p.kind === "category" ? "Categoria excluída" : "Produto excluído",
          );
        }}
      />
    </div>
  );
}
