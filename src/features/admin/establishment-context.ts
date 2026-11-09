import { createContext, useContext } from "react";
import type { AdminEstablishment } from "@/lib/auth.functions";

const STORAGE_KEY = "pedeai:establishment";

/** Estabelecimento escolhido: o salvo (se ainda for do administrador), senão o padrão, senão o primeiro. */
export function pickEstablishment(
  list: AdminEstablishment[],
  storedId: string | null,
): AdminEstablishment | null {
  return list.find((e) => e.id === storedId) ?? list.find((e) => e.isDefault) ?? list[0] ?? null;
}

export function readStoredEstablishment(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredEstablishment(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* vale só nesta sessão */
  }
}

export type EstablishmentContextValue = {
  establishments: AdminEstablishment[];
  current: AdminEstablishment;
  setCurrentId: (id: string) => void;
  isSuper: boolean;
};

export const EstablishmentContext = createContext<EstablishmentContextValue | null>(null);

/** Estabelecimento escolhido no painel. Só funciona dentro do `EstablishmentProvider`. */
export function useEstablishment(): EstablishmentContextValue {
  const v = useContext(EstablishmentContext);
  if (!v) throw new Error("useEstablishment fora do EstablishmentProvider");
  return v;
}
