import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-middleware";
import { categoryInputSchema } from "@/lib/category-rules";
import { assertEstablishment } from "@/lib/scope";
import {
  assertCategoriesAccess,
  assertCategoryAccess,
  assertProductAccess,
  assertProductsAccess,
} from "@/lib/scope.server";

const BUCKET = "product-images";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type CatalogCategory = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  min_select: number;
  max_select: number;
  /** Permite mais de 1 unidade da mesma opção (o limite continua contando opções diferentes). */
  allow_quantity: boolean;
  is_active: boolean;
};
export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  image_path: string | null;
  image_url: string | null;
  position: number;
  is_active: boolean;
  /** Preço em centavos; null = sem preço. */
  price_cents: number | null;
};
export type MenuCategory = CatalogCategory;
export type MenuProduct = CatalogProduct;

/** Estabelecimento padrão (o participante só enxerga ele até o C3b). */
async function defaultEstablishmentId() {
  const db = await admin();
  const { data } = await db
    .from("establishments")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();
  if (!data) throw new Error("Não foi possível carregar o cardápio.");
  return data.id;
}

async function loadCatalog(onlyActive: boolean, establishmentId: string) {
  const db = await admin();
  let catQ = db
    .from("categories")
    .select("id, name, description, position, min_select, max_select, allow_quantity, is_active")
    .eq("establishment_id", establishmentId)
    .order("position")
    .order("created_at");
  let prodQ = db
    .from("products")
    .select("id, name, description, category_id, image_path, position, is_active, price_cents")
    .order("position")
    .order("created_at");
  if (onlyActive) {
    catQ = catQ.eq("is_active", true);
    prodQ = prodQ.eq("is_active", true);
  }
  const [cats, prods] = await Promise.all([catQ, prodQ]);
  if (cats.error || prods.error) {
    console.error(cats.error ?? prods.error);
    throw new Error("Não foi possível carregar o cardápio.");
  }
  const categories: CatalogCategory[] = cats.data;
  const visibleCats = new Set(categories.map((c) => c.id));
  // Só produtos de categorias deste estabelecimento (no painel, inclusive os de categoria inativa).
  const rows = prods.data.filter((p) => p.category_id && visibleCats.has(p.category_id));
  const paths = rows.map((p) => p.image_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 24);
    data?.forEach((d) => d.path && d.signedUrl && urls.set(d.path, d.signedUrl));
  }
  const products: CatalogProduct[] = rows.map((p) => ({
    ...p,
    image_url: p.image_path ? (urls.get(p.image_path) ?? null) : null,
  }));
  return { categories, products };
}

/** Cardápio dos participantes: só categorias e produtos ativos. Público. */
export const getMenu = createServerFn({ method: "GET" }).handler(async () =>
  loadCatalog(true, await defaultEstablishmentId()),
);

/** Catálogo completo (inclui inativos) para o painel. Somente administradores. */
export const getCatalog = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ establishmentId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => {
    assertEstablishment(context, data.establishmentId);
    return loadCatalog(false, data.establishmentId);
  });

export const saveCategory = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => ({
    ...categoryInputSchema.parse(d),
    establishmentId: z.object({ establishmentId: z.string().uuid().optional() }).parse(d)
      .establishmentId,
  }))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const row = {
      name: data.name,
      description: data.description,
      min_select: data.min_select,
      max_select: data.max_select,
      allow_quantity: data.allow_quantity,
      is_active: data.is_active,
    };
    if (data.id) {
      await assertCategoryAccess(db, context, data.id);
      const { error } = await db.from("categories").update(row).eq("id", data.id);
      if (error) throw new Error("Não foi possível salvar a categoria.");
    } else {
      if (!data.establishmentId) throw new Error("Escolha o estabelecimento.");
      assertEstablishment(context, data.establishmentId);
      const { data: last } = await db
        .from("categories")
        .select("position")
        .eq("establishment_id", data.establishmentId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await db.from("categories").insert({
        ...row,
        establishment_id: data.establishmentId,
        position: (last?.position ?? -1) + 1,
      });
      if (error) throw new Error("Não foi possível criar a categoria.");
    }
    return { ok: true };
  });

/** Grava a nova ordem: `ids` na sequência desejada (posição = índice). */
export const reorderCategories = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertCategoriesAccess(db, context, data.ids);
    const results = await Promise.all(
      data.ids.map((id, position) => db.from("categories").update({ position }).eq("id", id)),
    );
    if (results.some((r) => r.error)) throw new Error("Não foi possível reordenar as categorias.");
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertCategoryAccess(db, context, data.id);
    const { error } = await db.from("categories").delete().eq("id", data.id);
    if (error) {
      if (error.code === "23503")
        throw new Error("Esta categoria ainda tem produtos. Mova ou exclua-os primeiro.");
      throw new Error("Não foi possível excluir a categoria.");
    }
    return { ok: true };
  });

export const createImageUpload = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) =>
    z.object({ contentType: z.enum(["image/webp", "image/jpeg"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const ext = data.contentType === "image/webp" ? "webp" : "jpg";
    const path = `products/${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error("Não foi possível preparar o envio da foto.");
    return { path, token: signed.token };
  });

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Informe um nome").max(80),
  description: z.string().trim().max(500).nullable(),
  // Produto sem categoria não aparece no cardápio: a categoria passa a ser obrigatória.
  category_id: z.string().uuid("Escolha uma categoria"),
  image_path: z
    .string()
    .regex(/^products\/[\w-]+\.(webp|jpg)$/)
    .nullable(),
  price_cents: z.number().int().min(0).max(9_999_999).nullable(),
  is_active: z.boolean(),
});

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => productSchema.parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    // A categoria de destino (e o produto, se já existe) precisam ser de estabelecimentos do administrador.
    await assertCategoryAccess(db, context, data.category_id);
    if (data.id) await assertProductAccess(db, context, data.id);
    const row = {
      name: data.name,
      description: data.description || null,
      category_id: data.category_id,
      image_path: data.image_path,
      price_cents: data.price_cents,
      is_active: data.is_active,
    };
    if (data.id) {
      const { data: old } = await db
        .from("products")
        .select("image_path")
        .eq("id", data.id)
        .single();
      const { error } = await db.from("products").update(row).eq("id", data.id);
      if (error) throw new Error("Não foi possível salvar o produto.");
      if (old?.image_path && old.image_path !== data.image_path) {
        await db.storage.from(BUCKET).remove([old.image_path]);
      }
    } else {
      const { data: last } = await db
        .from("products")
        .select("position")
        .eq("category_id", data.category_id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await db
        .from("products")
        .insert({ ...row, position: (last?.position ?? -1) + 1 });
      if (error) throw new Error("Não foi possível criar o produto.");
    }
    return { ok: true };
  });

/** Liga/desliga a disponibilidade rapidamente (produto some do cardápio, sem apagar). */
export const setProductActive = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertProductAccess(db, context, data.id);
    const { error } = await db
      .from("products")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error("Não foi possível alterar a disponibilidade.");
    return { ok: true };
  });

export const setCategoryActive = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertCategoryAccess(db, context, data.id);
    const { error } = await db
      .from("categories")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error("Não foi possível alterar a categoria.");
    return { ok: true };
  });

export const reorderProducts = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertProductsAccess(db, context, data.ids);
    const results = await Promise.all(
      data.ids.map((id, position) => db.from("products").update({ position }).eq("id", id)),
    );
    if (results.some((r) => r.error)) throw new Error("Não foi possível reordenar os produtos.");
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await assertProductAccess(db, context, data.id);
    const { data: old } = await db.from("products").select("image_path").eq("id", data.id).single();
    const { error } = await db.from("products").delete().eq("id", data.id);
    if (error) {
      if (error.code === "23503")
        throw new Error(
          "Este produto já aparece em pedidos e não pode ser excluído. Desative-o para tirá-lo do cardápio.",
        );
      throw new Error("Não foi possível excluir o produto.");
    }
    if (old?.image_path) await db.storage.from(BUCKET).remove([old.image_path]);
    return { ok: true };
  });
