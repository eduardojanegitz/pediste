import { motion, useReducedMotion } from "motion/react";

/** Marca Pediste — o "?" pulsa de leve (desligado com movimento reduzido). */
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
      className={`font-display inline-flex items-baseline leading-none tracking-wide ${className}`}
    >
      <span aria-hidden className="text-foreground">
        Pedi
      </span>
      <span aria-hidden className="text-primary">
        ste
      </span>
      <motion.span
        aria-hidden
        className="inline-block origin-bottom text-secondary"
        {...(animate && !reduce ? { animate: { scale: [1, 1.18, 1], rotate: [0, -6, 0] } } : {})}
        transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 2.4, ease: "easeInOut" }}
      >
        ?
      </motion.span>
    </span>
  );
}
