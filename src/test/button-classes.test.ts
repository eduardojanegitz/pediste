import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

/**
 * btnPlain/btnPrimary/btnDanger já definem fundo e cor do texto. Acrescentar `bg-*` ou `text-<cor>`
 * por cima deixa duas classes de cor para o mesmo atributo, sem vencedor garantido: o botão pode ficar
 * com texto invisível (aconteceu com "Encerrar agora"). Use uma variante própria (ex.: btnDark).
 */
describe("classes de botão", () => {
  // Só cores: `bg-*` e `text-<cor>` (tamanhos como text-lg ou alinhamentos não conflitam).
  const BAD =
    /\$\{(btnPlain|btnPrimary|btnDanger)\}[^`]*\b(?:bg-[a-z]|text-(?:foreground|background|primary|secondary|accent|muted|destructive|card|popover|white|black))/;

  it("nenhum botão mistura variante pronta com cores soltas", () => {
    const offenders = files(join(process.cwd(), "src"))
      .filter((f) => !f.includes(join("src", "test")))
      .filter((f) => BAD.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("o detector pega o padrão que quebrou", () => {
    expect(BAD.test("className={`${btnPlain} bg-foreground text-background`}")).toBe(true);
    expect(BAD.test("className={`${btnPrimary} mt-4`}")).toBe(false);
    expect(BAD.test("className={`${btnPrimary} w-full text-lg`}")).toBe(false);
    expect(BAD.test("className={reminded.has(p.id) ? btnPlain : btnPrimary}")).toBe(false);
  });
});
