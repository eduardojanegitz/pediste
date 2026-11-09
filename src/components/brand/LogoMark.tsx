/**
 * Símbolo do Pediste: um "P" sólido com o "?" vazado dentro. É o mesmo desenho do ícone do app
 * (`public/favicon.svg`), em SVG inline para acompanhar o tamanho da fonte (`em`) do logo.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      className={`inline-block h-[0.95em] w-[0.95em] shrink-0 ${className}`}
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M7.5 4H17a8 8 0 0 1 0 17h-3V28H7.5Z"
        fill="#FFF4D6"
        stroke="#FFF4D6"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M14.9 9.7a2.8 2.8 0 1 1 4.5 2.2c-1 .8-1.6 1.3-1.6 2.5"
        fill="none"
        className="stroke-primary"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17.8" cy="18" r="1.5" className="fill-primary" />
    </svg>
  );
}
