import { useMemo, useState, type ReactNode } from "react";
import { Store } from "lucide-react";
import type { AdminEstablishment } from "@/lib/auth.functions";
import {
  EstablishmentContext,
  pickEstablishment,
  readStoredEstablishment,
  writeStoredEstablishment,
  useEstablishment,
} from "./establishment-context";
import { field } from "./ui";

/** Guarda qual estabelecimento está aberto no painel (lembrado neste navegador). */
export function EstablishmentProvider({
  establishments,
  isSuper,
  children,
}: {
  establishments: AdminEstablishment[];
  isSuper: boolean;
  children: ReactNode;
}) {
  const [storedId, setStoredId] = useState<string | null>(() => readStoredEstablishment());
  const current = pickEstablishment(establishments, storedId);
  const value = useMemo(
    () =>
      current
        ? {
            establishments,
            current,
            isSuper,
            setCurrentId: (id: string) => {
              writeStoredEstablishment(id);
              setStoredId(id);
            },
          }
        : null,
    [establishments, current, isSuper],
  );

  if (!value) {
    return (
      <div role="alert" className="pop-card p-8 text-center">
        <h2 className="text-3xl">Nenhum estabelecimento liberado</h2>
        <p className="mt-2 text-muted-foreground">
          Sua conta ainda não está vinculada a nenhum estabelecimento. Peça a um administrador para
          liberar o seu acesso.
        </p>
      </div>
    );
  }
  return <EstablishmentContext.Provider value={value}>{children}</EstablishmentContext.Provider>;
}

/** Nome do estabelecimento atual; com mais de um, vira um seletor. */
export function EstablishmentSwitcher() {
  const { establishments, current, setCurrentId } = useEstablishment();
  if (establishments.length < 2) {
    return (
      <p className="mb-4 flex items-center gap-2 text-sm font-bold text-muted-foreground">
        <Store className="h-4 w-4" aria-hidden /> {current.name}
      </p>
    );
  }
  return (
    <div className="mb-4 max-w-sm">
      <label htmlFor="est-switch" className="mb-1 flex items-center gap-2 text-sm font-bold">
        <Store className="h-4 w-4" aria-hidden /> Estabelecimento
      </label>
      <select
        id="est-switch"
        value={current.id}
        onChange={(e) => setCurrentId(e.target.value)}
        className={field}
      >
        {establishments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  );
}
