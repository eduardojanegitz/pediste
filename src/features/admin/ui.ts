// Classes compartilhadas do painel (mais sóbrias que a jornada do participante: operações rápidas).
export const btn =
  "pop-press inline-flex min-h-10 items-center gap-2 rounded-full border-2 border-foreground px-4 py-2 text-sm font-bold shadow-pop disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
export const btnPrimary = `${btn} bg-primary text-primary-foreground`;
export const btnPlain = `${btn} bg-card text-foreground`;
export const btnDanger = `${btn} bg-destructive text-destructive-foreground`;
/** Botão escuro (ação que encerra algo, ex.: "Encerrar agora"). Nunca misture com btnPlain/btnPrimary: duas cores de fundo/texto na mesma classe deixam o texto invisível. */
export const btnDark = `${btn} bg-foreground text-background`;
export const iconBtn =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-foreground bg-card disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const field =
  "w-full rounded-2xl border-2 border-foreground bg-card px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive";
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Algo deu errado.");
