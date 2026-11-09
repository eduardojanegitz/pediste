import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin-middleware";
import { SLUG_RE, slugify } from "@/lib/scope";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type EstablishmentMember = { adminId: string; email: string | null; isSuper: boolean };
export type EstablishmentAdminRow = {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  members: EstablishmentMember[];
};

const nameSchema = z.string().trim().min(1, "Informe um nome").max(80, "Use até 80 caracteres");
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(40, "Use até 40 caracteres")
  .regex(SLUG_RE, "Use só letras minúsculas, números e hífens (ex.: padaria-do-ze)");

/** Todos os estabelecimentos com quem tem acesso a cada um. Só o super administrador. */
export const listEstablishmentsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<EstablishmentAdminRow[]> => {
    const db = await admin();
    const [{ data: ests, error }, { data: links, error: e2 }, { data: admins, error: e3 }] =
      await Promise.all([
        db
          .from("establishments")
          .select("id, name, slug, is_default")
          .order("is_default", { ascending: false })
          .order("name"),
        db.from("admin_establishments").select("admin_id, establishment_id"),
        db.from("admins").select("user_id, is_super"),
      ]);
    if (error || e2 || e3) throw new Error("Não foi possível carregar os estabelecimentos.");
    const superOf = new Map((admins ?? []).map((a) => [a.user_id, a.is_super]));
    const ids = [...new Set((links ?? []).map((l) => l.admin_id))];
    const emails = new Map<string, string | null>();
    await Promise.all(
      ids.map(async (id) => {
        const { data } = await db.auth.admin.getUserById(id);
        emails.set(id, data.user?.email ?? null);
      }),
    );
    return (ests ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      isDefault: e.is_default,
      members: (links ?? [])
        .filter((l) => l.establishment_id === e.id)
        .map((l) => ({
          adminId: l.admin_id,
          email: emails.get(l.admin_id) ?? null,
          isSuper: superOf.get(l.admin_id) ?? false,
        }))
        .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
    }));
  });

export const createEstablishment = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator((d: unknown) => z.object({ name: nameSchema, slug: slugSchema.optional() }).parse(d))
  .handler(async ({ data }): Promise<{ id: string; slug: string }> => {
    const db = await admin();
    const slug = data.slug ?? slugify(data.name);
    const { data: row, error } = await db
      .from("establishments")
      .insert({ name: data.name, slug })
      .select("id, slug")
      .single();
    if (error || !row) {
      if (error?.code === "23505")
        throw new Error("Já existe um estabelecimento com este apelido.");
      console.error(error);
      throw new Error("Não foi possível criar o estabelecimento.");
    }
    return row;
  });

/** Só o nome muda: o apelido faz parte dos links já compartilhados e não é alterado. */
export const renameEstablishment = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), name: nameSchema }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { error, count } = await db
      .from("establishments")
      .update({ name: data.name }, { count: "exact" })
      .eq("id", data.id);
    if (error) throw new Error("Não foi possível renomear.");
    if (!count) throw new Error("Estabelecimento não encontrado.");
    return { ok: true };
  });

/**
 * Libera um administrador em um estabelecimento pelo e-mail. A conta precisa já existir no Supabase
 * (Authentication > Users): o app não cria contas nem lida com senhas. Quem ainda não era
 * administrador passa a ser (comum, não super); quem já era mantém o papel.
 */
export const addEstablishmentAdmin = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator((d: unknown) =>
    z
      .object({
        establishmentId: z.string().uuid(),
        email: z.string().trim().toLowerCase().email("E-mail inválido").max(254),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: est } = await db
      .from("establishments")
      .select("id")
      .eq("id", data.establishmentId)
      .maybeSingle();
    if (!est) throw new Error("Estabelecimento não encontrado.");
    const { data: userId } = await db.rpc("find_user_id_by_email", { p_email: data.email });
    if (!userId) {
      throw new Error(
        "Não há usuário com este e-mail. Crie a conta em Authentication > Users no Supabase e tente de novo.",
      );
    }
    const a = await db
      .from("admins")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    const b = await db
      .from("admin_establishments")
      .upsert(
        { admin_id: userId, establishment_id: data.establishmentId },
        { onConflict: "admin_id,establishment_id", ignoreDuplicates: true },
      );
    if (a.error || b.error) {
      console.error(a.error ?? b.error);
      throw new Error("Não foi possível liberar o acesso.");
    }
    return { ok: true, adminId: userId };
  });

export const removeEstablishmentAdmin = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator((d: unknown) =>
    z.object({ establishmentId: z.string().uuid(), adminId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db
      .from("admin_establishments")
      .delete()
      .eq("establishment_id", data.establishmentId)
      .eq("admin_id", data.adminId);
    if (error) throw new Error("Não foi possível remover o acesso.");
    return { ok: true };
  });
