import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type TargetAndTransition,
  type Transition,
} from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { BagBadge } from "@/components/brand/BagBadge";
import { LogoMark } from "@/components/brand/LogoMark";
import { PixInSuccess } from "./PixInSuccess";
import { btnPlain, btnPrimary } from "./ui";
import {
  TIMELINE,
  UPDATE_AUTO_CLOSE_MS,
  useSceneTimeline,
  type Scene,
  type Variant,
} from "./successTimeline";

export type SuccessItem = { name: string; quantity: number };

const BRAND = [
  "bg-primary",
  "bg-secondary",
  "bg-accent",
  "bg-primary",
  "bg-secondary",
  "bg-foreground",
];
const LETTERS = ["P", "e", "d", "i", "s", "t", "e"] as const;
const PARTICLES = 26;

type Particle = {
  x: number;
  y: number;
  size: number;
  color: string;
  shape: "dot" | "square" | "ring";
  rotate: number;
  jitter: number;
};

/** Partículas determinísticas por montagem; o raio acompanha a largura da tela (celulares pequenos). */
function makeParticles(): Particle[] {
  const w = typeof window === "undefined" ? 420 : Math.min(window.innerWidth, 520);
  const k = w / 420;
  return Array.from({ length: PARTICLES }, (_, i) => {
    const a = (i / PARTICLES) * Math.PI * 2 + (Math.sin(i * 12.9898) % 1) * 0.25;
    const r = (95 + ((i * 37) % 70)) * k;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r * 0.85,
      size: 6 + ((i * 7) % 8),
      color: BRAND[i % BRAND.length]!,
      shape: i % 5 === 0 ? "ring" : i % 3 === 0 ? "square" : "dot",
      rotate: (i % 2 ? 1 : -1) * (90 + ((i * 29) % 180)),
      jitter: ((i * 13) % 10) / 100,
    };
  });
}

function ParticleView({ p, scene }: { p: Particle; scene: Scene }) {
  const burst = scene === "burst";
  const converge = scene === "logo";
  const animate: TargetAndTransition = burst
    ? { x: p.x, y: p.y, opacity: [0, 1, 1], scale: [0, 1.15, 1], rotate: p.rotate }
    : converge
      ? { x: 0, y: 0, opacity: [1, 0.9, 0], scale: 0.2, rotate: 0 }
      : { x: 0, y: 0, opacity: 0, scale: 0 };
  const transition: Transition = burst
    ? { duration: 0.75, ease: [0.16, 1, 0.3, 1], delay: p.jitter }
    : converge
      ? { duration: 0.7, ease: [0.5, 0, 0.9, 0.5], delay: p.jitter }
      : { duration: 0 };
  const shape =
    p.shape === "ring"
      ? "rounded-full border-2 border-foreground bg-transparent"
      : p.shape === "square"
        ? `rounded-[3px] ${p.color}`
        : `rounded-full ${p.color}`;
  return (
    <motion.span
      aria-hidden
      className={`absolute left-1/2 top-1/2 ${shape}`}
      style={{ width: p.size, height: p.size, marginLeft: -p.size / 2, marginTop: -p.size / 2 }}
      initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
      animate={animate}
      transition={transition}
    />
  );
}

/**
 * Conclusão do pedido (marca Pediste). Sequência: sacola desliza → explosão de partículas →
 * partículas convergem e formam a marca → mensagem + resumo + ações.
 * Só é montada DEPOIS de o servidor confirmar a gravação. "updated" é a versão reduzida (sem explosão).
 * Com movimento reduzido mostra direto o estado final, sem deslocamentos.
 */
export function OrderSuccess({
  variant,
  items,
  onView,
  onEdit,
  token,
  roundId,
  forceScene,
  reduceMotion,
}: {
  variant: Variant;
  items: SuccessItem[];
  onView: () => void;
  onEdit?: (() => void) | undefined;
  /** Com estes dois, a mensagem final mostra o Pix a pagar (quando houver). */
  token?: string | undefined;
  roundId?: string | undefined;
  /** Fixa uma cena (verificação visual). */
  forceScene?: Scene | undefined;
  /** Sobrepõe a preferência do sistema (testes). */
  reduceMotion?: boolean | undefined;
}) {
  const system = useReducedMotion() ?? false;
  const reduce = reduceMotion ?? system;
  const [skipped, setSkipped] = useState(false);
  // Enquanto não se sabe se há Pix a pagar (ou se há), a atualização não fecha sozinha.
  const [payHold, setPayHold] = useState(!!token && !!roundId);
  const scene = useSceneTimeline(variant, { reduce, skipped, force: forceScene });
  const particles = useMemo(makeParticles, []);
  const primary = useRef<HTMLButtonElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const updated = variant === "updated";
  const final = scene === "final";
  const atLogo = scene === "logo" || scene === "final";

  const title = updated ? "Seu pedido foi atualizado!" : "Seu pedido foi confirmado!";
  const count = items.reduce((n, i) => n + i.quantity, 0);
  const names = items
    .slice(0, 5)
    .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name));
  const extra = items.length - names.length;

  // Teclado/leitor de tela: foco no botão "Pular" e depois no principal; Esc fecha.
  useEffect(() => {
    if (final) primary.current?.focus();
    else skip.current?.focus();
  }, [final]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onView();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onView]);

  // Atualização: fecha sozinha depois de mostrar a mensagem (o pedido continua visível na tela seguinte).
  useEffect(() => {
    if (!updated || !final || forceScene || payHold) return;
    const wait = reduce
      ? UPDATE_AUTO_CLOSE_MS
      : Math.max(1200, UPDATE_AUTO_CLOSE_MS - TIMELINE.updated.final);
    const t = setTimeout(onView, wait);
    return () => clearTimeout(t);
  }, [updated, final, reduce, onView, forceScene, payHold]);

  const bagAnimate: TargetAndTransition =
    scene === "cart"
      ? { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }
      : scene === "burst"
        ? { x: 0, y: 0, scale: [1, 1.3, 0], rotate: 0, opacity: [1, 1, 0] }
        : { x: 0, y: 0, scale: 0, rotate: 0, opacity: 0 };
  const bagTransition: Transition =
    scene === "cart"
      ? { type: "spring", stiffness: 110, damping: 13, mass: 0.9 }
      : scene === "burst"
        ? { duration: 0.42, ease: "easeIn" }
        : { duration: 0.15 };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background px-5 py-8"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Anuncia o resultado imediatamente, sem esperar a animação */}
      <p role="status" className="sr-only">
        {title}
      </p>

      {!final && !reduce && (
        <button
          ref={skip}
          type="button"
          onClick={() => setSkipped(true)}
          className="absolute right-4 top-4 min-h-11 rounded-full px-4 text-sm font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Pular animação
        </button>
      )}

      {/* Formas da marca (as mesmas das telas de estado) surgem junto com o logo */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-secondary"
        initial={false}
        animate={{ scale: atLogo ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 14 }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-16 h-56 w-56 rounded-[3rem] bg-accent"
        initial={false}
        animate={{ scale: atLogo ? 1 : 0, rotate: atLogo ? 12 : -30 }}
        transition={
          reduce ? { duration: 0 } : { type: "spring", stiffness: 100, damping: 12, delay: 0.08 }
        }
      />

      <div className="relative z-10 flex max-h-full w-full max-w-md flex-col items-center overflow-y-auto overflow-x-hidden">
        {/* Palco: sacola, explosão e logo ocupam o mesmo centro */}
        <div className="relative h-56 w-full sm:h-64">
          {!reduce && (
            <>
              <motion.span
                aria-hidden
                className="absolute left-1/2 top-1/2 -ml-14 -mt-14 h-28 w-28 rounded-full border-2 border-primary"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={
                  scene === "burst" ? { scale: [0.4, 3.2], opacity: [0.7, 0] } : { opacity: 0 }
                }
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
              {particles.map((p, i) => (
                <ParticleView key={i} p={p} scene={scene} />
              ))}
              <motion.div
                aria-hidden
                className="absolute left-1/2 top-1/2 -ml-14 -mt-14"
                initial={{ x: -110, y: 230, scale: 0.5, rotate: -14, opacity: 0 }}
                animate={bagAnimate}
                transition={bagTransition}
              >
                <BagBadge size={112} className="shadow-pop-lg" />
              </motion.div>
            </>
          )}

          {/* Marca: símbolo + letras com mola */}
          <div className="absolute inset-0 grid place-items-center">
            <h1
              aria-hidden
              className="font-display flex items-center text-[5.5rem] leading-none tracking-wide sm:text-[7rem]"
            >
              {/* Símbolo (P com "?") entra primeiro, pulsa e brilha */}
              <span className="relative mr-[0.18em] inline-flex self-center">
                {!reduce && (
                  <motion.span
                    className="absolute left-1/2 top-1/2 -ml-8 -mt-8 h-16 w-16 rounded-full bg-secondary/35"
                    initial={false}
                    animate={
                      atLogo
                        ? { scale: [0.6, 1.9, 0.6], opacity: [0.2, 0.6, 0.2] }
                        : { scale: 0, opacity: 0 }
                    }
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                  />
                )}
                <motion.span
                  className="relative inline-flex"
                  initial={reduce ? false : { opacity: 0, scale: 0, rotate: -35 }}
                  animate={
                    atLogo
                      ? { opacity: 1, scale: 1, rotate: 0 }
                      : { opacity: 0, scale: 0, rotate: -35 }
                  }
                  transition={
                    reduce
                      ? { duration: 0.2 }
                      : { type: "spring", stiffness: 330, damping: 12, delay: 0 }
                  }
                >
                  <LogoMark />
                </motion.span>
              </span>
              {LETTERS.map((l, i) => (
                <motion.span
                  key={`${l}-${i}`}
                  className={i < 4 ? "text-foreground" : "text-primary"}
                  initial={reduce ? false : { opacity: 0, y: 36, scale: 0.5 }}
                  animate={
                    atLogo ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 36, scale: 0.5 }
                  }
                  transition={
                    reduce
                      ? { duration: 0.2 }
                      : { type: "spring", stiffness: 260, damping: 16, delay: 0.25 + i * 0.055 }
                  }
                >
                  {l}
                </motion.span>
              ))}
            </h1>
          </div>
        </div>

        {/* Cenas 6 e 7: mensagem, resumo compacto e ações */}
        <div className="min-h-[15rem] w-full text-center">
          <AnimatePresence>
            {final && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 220, damping: 22 }}
              >
                <p className="flex items-center justify-center gap-2 text-2xl font-bold sm:text-3xl">
                  <span
                    aria-hidden
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-foreground bg-primary text-primary-foreground"
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                  {title}
                </p>

                {items.length > 0 && (
                  <p className="mx-auto mt-4 max-w-sm rounded-2xl border-2 border-foreground bg-card px-4 py-3 text-sm shadow-pop">
                    <span className="font-bold">
                      {count} {count === 1 ? "item" : "itens"}
                    </span>
                    <span className="text-muted-foreground">
                      {" · "}
                      {names.join(", ")}
                      {extra > 0 ? ` e mais ${extra}` : ""}
                    </span>
                  </p>
                )}

                {token && roundId && (
                  <div className="mx-auto mt-4 max-w-sm">
                    <PixInSuccess token={token} roundId={roundId} onSettled={setPayHold} />
                  </div>
                )}

                <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row">
                  <button
                    ref={primary}
                    type="button"
                    onClick={onView}
                    className={`${btnPrimary} sm:min-w-44`}
                  >
                    Ver meu pedido
                  </button>
                  {onEdit && !updated && (
                    <button type="button" onClick={onEdit} className={btnPlain}>
                      <Pencil className="h-4 w-4" aria-hidden /> Fazer alterações
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
