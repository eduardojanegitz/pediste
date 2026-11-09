/** Quem é o administrador e a quais estabelecimentos ele tem acesso (calculado no servidor). */
export type AdminScope = {
  adminId: string;
  /** Super administrador: vê e gerencia todos os estabelecimentos e vincula pessoas. */
  isSuper: boolean;
  /** Estabelecimentos acessíveis (para o super, todos). */
  establishmentIds: string[];
};

export const canAccessEstablishment = (s: AdminScope, establishmentId: string) =>
  s.establishmentIds.includes(establishmentId);

export const FORBIDDEN_ESTABLISHMENT = "Forbidden: sem acesso a este estabelecimento.";

export function assertEstablishment(s: AdminScope, establishmentId: string): void {
  if (!canAccessEstablishment(s, establishmentId)) throw new Error(FORBIDDEN_ESTABLISHMENT);
}

/** Apelido do endereço: minúsculas, números e hífens (ex.: "padaria-do-ze"). */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "estabelecimento"
  );
}
