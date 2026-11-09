import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Plus, Store, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  addEstablishmentAdmin,
  createEstablishment,
  listEstablishmentsAdmin,
  removeEstablishmentAdmin,
  renameEstablishment,
  type EstablishmentAdminRow,
} from "@/lib/establishments-admin.functions";
import { participantPath, slugify, SLUG_RE } from "@/lib/scope";
import { ConfirmDialog } from "./ConfirmDialog";
import { btnPlain, btnPrimary, errMsg, field } from "./ui";

/** Gestão de estabelecimentos e de quem acessa cada um. Só o super administrador chega aqui. */
export function EstablishmentsView() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["establishments-admin"],
    queryFn: () => listEstablishmentsAdmin(),
  });

  // Depois de mudar algo, recarrega a lista e o seletor do painel (que vem da sessão).
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["establishments-admin"] });
    await router.invalidate();
  };

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{
    est: EstablishmentAdminRow;
    adminId: string;
    email: string | null;
  } | null>(null);

  const effectiveSlug = slugEdited ? slug : slugify(name);
  const slugOk = SLUG_RE.test(effectiveSlug) && effectiveSlug.length <= 40;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await refresh();
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const done = await run(
      () => createEstablishment({ data: { name, slug: effectiveSlug } }),
      "Estabelecimento criado",
    );
    if (done) {
      setName("");
      setSlug("");
      setSlugEdited(false);
    }
  };

  return (
    <div>
      <form onSubmit={create} className="pop-card mb-8 space-y-4 p-5 sm:p-6">
        <h2 className="text-4xl">Novo estabelecimento</h2>
        <p className="text-sm text-muted-foreground">
          Cada estabelecimento tem o seu cardápio, as suas rodadas e o seu endereço para os
          participantes.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="est-name" className="mb-1 block text-sm font-bold">
              Nome
            </label>
            <input
              id="est-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Ex.: Padaria do Zé"
              className={field}
            />
          </div>
          <div>
            <label htmlFor="est-slug" className="mb-1 block text-sm font-bold">
              Apelido do endereço
            </label>
            <input
              id="est-slug"
              value={effectiveSlug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase());
                setSlugEdited(true);
              }}
              maxLength={40}
              aria-invalid={effectiveSlug !== "" && !slugOk}
              className={field}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Endereço dos participantes: <strong>/e/{effectiveSlug || "apelido"}</strong>. O apelido
          não muda depois (os links compartilhados dependem dele): use letras minúsculas, números e
          hífens.
        </p>
        <button disabled={busy || !name.trim() || !slugOk} className={btnPrimary}>
          <Plus className="h-4 w-4" aria-hidden /> Criar estabelecimento
        </button>
      </form>

      <h2 className="mb-3 text-3xl">Estabelecimentos</h2>
      {q.isLoading && <div className="h-32 animate-pulse rounded-3xl bg-muted" />}
      {q.isError && (
        <div role="alert" className="pop-card p-6 text-center">
          <p className="font-bold">Não foi possível carregar os estabelecimentos.</p>
          <button className={`${btnPrimary} mt-3`} onClick={() => void q.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}
      <ul className="space-y-4">
        {q.data?.map((est) => (
          <EstablishmentCard
            key={est.id}
            est={est}
            busy={busy}
            onRename={(newName) =>
              run(
                () => renameEstablishment({ data: { id: est.id, name: newName } }),
                "Nome alterado",
              )
            }
            onAdd={(email) =>
              run(
                () => addEstablishmentAdmin({ data: { establishmentId: est.id, email } }),
                "Acesso liberado",
              )
            }
            onRemove={(m) => setRemoving({ est, adminId: m.adminId, email: m.email })}
          />
        ))}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remover o acesso de ${removing?.email ?? "este administrador"}?`}
        description={`Ele deixa de ver “${removing?.est.name ?? ""}” no painel. A conta continua existindo e os dados do estabelecimento não são apagados.`}
        confirmLabel="Remover acesso"
        onConfirm={() => {
          const r = removing;
          setRemoving(null);
          if (r)
            void run(
              () =>
                removeEstablishmentAdmin({
                  data: { establishmentId: r.est.id, adminId: r.adminId },
                }),
              "Acesso removido",
            );
        }}
      />
    </div>
  );
}

function EstablishmentCard({
  est,
  busy,
  onRename,
  onAdd,
  onRemove,
}: {
  est: EstablishmentAdminRow;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onAdd: (email: string) => Promise<boolean>;
  onRemove: (m: EstablishmentAdminRow["members"][number]) => void;
}) {
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(est.name);
  const path = participantPath(est) || "/";

  return (
    <li className="pop-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {editing ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await onRename(newName)) setEditing(false);
              }}
            >
              <label htmlFor={`rn-${est.id}`} className="sr-only">
                Novo nome
              </label>
              <input
                id={`rn-${est.id}`}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                className={field}
              />
              <button disabled={busy || !newName.trim()} className={btnPrimary}>
                Salvar
              </button>
              <button type="button" className={btnPlain} onClick={() => setEditing(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <h3 className="flex flex-wrap items-center gap-2 text-3xl">
              <Store className="h-5 w-5" aria-hidden /> {est.name}
              {est.isDefault && (
                <span className="rounded-full border-2 border-foreground bg-accent px-3 py-0.5 text-xs font-bold text-accent-foreground">
                  Padrão
                </span>
              )}
            </h3>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Endereço dos participantes: <strong>{path}</strong>
          </p>
        </div>
        {!editing && (
          <button className={btnPlain} onClick={() => setEditing(true)}>
            Renomear
          </button>
        )}
      </div>

      <h4 className="mt-4 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        Quem acessa
      </h4>
      {est.members.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Nenhum administrador vinculado. Os super administradores sempre veem todos.
        </p>
      ) : (
        <ul className="mt-1 divide-y-2 divide-foreground/10">
          {est.members.map((m) => (
            <li key={m.adminId} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate font-semibold">
                {m.email ?? "Conta sem e-mail"}
                {m.isSuper && (
                  <span className="ml-2 rounded-full border-2 border-foreground px-2 py-0.5 text-xs font-bold">
                    super
                  </span>
                )}
              </span>
              <button
                type="button"
                className={btnPlain}
                aria-label={`Remover acesso de ${m.email ?? "conta sem e-mail"}`}
                onClick={() => onRemove(m)}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onAdd(email)) setEmail("");
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={`ad-${est.id}`} className="mb-1 block text-sm font-bold">
            Liberar um administrador (e-mail)
          </label>
          <input
            id={`ad-${est.id}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@exemplo.com"
            maxLength={254}
            className={field}
          />
        </div>
        <button disabled={busy || !email.trim()} className={btnPrimary}>
          <UserPlus className="h-4 w-4" aria-hidden /> Liberar
        </button>
      </form>
      <p className="mt-1 text-xs text-muted-foreground">
        A conta precisa já existir no Supabase (Authentication &gt; Users). O app não cria contas
        nem guarda senhas.
      </p>
    </li>
  );
}
