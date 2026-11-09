import { useEffect, useState } from "react";

/**
 * Cenas da animação de conclusão (cena 1 = clique e cena 2 = processamento acontecem antes, no dock):
 * cart  → o carrinho/sacola desliza até o centro (cena 3)
 * burst → explosão de partículas (cena 4)
 * logo  → as partículas convergem e a marca Pediste se forma (cena 5)
 * final → mensagem, resumo e ações (cenas 6 e 7)
 */
export type Scene = "cart" | "burst" | "logo" | "final";
export type Variant = "created" | "updated";

/** Instante (ms) em que cada cena começa. Na atualização não há explosão (versão reduzida). */
export const TIMELINE: Record<Variant, Record<Scene, number>> = {
  created: { cart: 0, burst: 1000, logo: 1900, final: 3200 },
  updated: { cart: 0, burst: Number.POSITIVE_INFINITY, logo: 700, final: 1800 },
};

/** Quanto tempo a confirmação de atualização fica na tela antes de fechar sozinha. */
export const UPDATE_AUTO_CLOSE_MS = 3600;

const ORDER: Scene[] = ["cart", "burst", "logo", "final"];

export function sceneAt(variant: Variant, elapsedMs: number): Scene {
  const t = TIMELINE[variant];
  let current: Scene = "cart";
  for (const s of ORDER) if (elapsedMs >= t[s]) current = s;
  return current;
}

/**
 * Avança as cenas por tempo. Com movimento reduzido (ou `skipped`) vai direto à cena final.
 * `force` fixa uma cena (usado em verificação visual).
 */
export function useSceneTimeline(
  variant: Variant,
  opts: { reduce: boolean; skipped: boolean; force?: Scene | undefined },
): Scene {
  const { reduce, skipped, force } = opts;
  const [scene, setScene] = useState<Scene>(force ?? (reduce ? "final" : "cart"));

  useEffect(() => {
    if (force) return setScene(force);
    if (reduce || skipped) return setScene("final");
    const timers = ORDER.filter((s) => s !== "cart" && Number.isFinite(TIMELINE[variant][s])).map(
      (s) => setTimeout(() => setScene(s), TIMELINE[variant][s]),
    );
    return () => timers.forEach(clearTimeout);
  }, [variant, reduce, skipped, force]);

  return scene;
}
