import { motion, useReducedMotion } from "motion/react";
import { LogoMark } from "./LogoMark";

/** Marca Pediste: símbolo (P com "?") + nome. O símbolo pulsa de leve (desligado com movimento reduzido). */
export function Logo({
  className = "text-6xl",
  animate = true,
}: {
  className?: string;
  animate?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      role="img"
      aria-label="Pediste"
      className={`font-display inline-flex items-center gap-[0.18em] leading-none tracking-wide ${className}`}
    >
      <motion.span
        aria-hidden
        className="inline-flex"
        {...(animate && !reduce ? { animate: { scale: [1, 1.1, 1], rotate: [0, -6, 0] } } : {})}
        transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 2.4, ease: "easeInOut" }}
      >
        <LogoMark />
      </motion.span>
      <span aria-hidden>
        <span className="text-foreground">Pedi</span>
        <span className="text-primary">ste</span>
      </span>
    </span>
  );
}
