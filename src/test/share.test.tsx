import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isLocalAddress,
  normalizePublicUrl,
  whatsappLink,
  whatsappMessage,
} from "@/features/admin/share";
import type { RoundState } from "@/lib/orders.functions";
import { qrMatrix, qrSvgPath } from "@/lib/qr";

const copyText = vi.fn(async (_: string) => {});
vi.mock("@/lib/export", () => ({ copyText: (t: string) => copyText(t) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { ShareDialog } from "@/features/admin/ShareDialog";

describe("QR Code", () => {
  const url = "https://pediste.lovable.app";
  const m = qrMatrix(url);

  it("tamanho segue a versão (4v + 17) e cresce com o texto", () => {
    expect((m.length - 17) % 4).toBe(0);
    expect(qrMatrix("A").length).toBe(21); // versão 1
    expect(qrMatrix("x".repeat(100)).length).toBeGreaterThan(qrMatrix("x".repeat(10)).length);
    expect(m.every((row) => row.length === m.length)).toBe(true);
  });

  it("tem os três localizadores nos cantos e o padrão de sincronismo", () => {
    const n = m.length;
    const finder = (cx: number, cy: number) => {
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          expect(m[cy + dy]![cx + dx]).toBe(d !== 2); // borda escura, anel claro, miolo escuro
        }
    };
    finder(3, 3);
    finder(n - 4, 3);
    finder(3, n - 4);
    for (let i = 8; i < n - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
    expect(m[n - 8]![8]).toBe(true); // módulo escuro fixo
  });

  it("é determinístico e aceita acentos e emoji", () => {
    expect(qrMatrix(url)).toEqual(m);
    expect(() => qrMatrix("Almoço ☕ açaí")).not.toThrow();
  });

  it("recusa texto grande demais em vez de gerar QR inválido", () => {
    expect(() => qrMatrix("x".repeat(400))).toThrow();
  });

  it("caminho SVG: zona de silêncio de 4 módulos", () => {
    const { size, d } = qrSvgPath(m);
    expect(size).toBe(m.length + 8);
    expect(d.startsWith("M")).toBe(true);
    // nenhum módulo escuro dentro da zona de silêncio
    expect(/M[0-3] |M\d+ [0-3]h/.test(d)).toBe(false);
  });
});

describe("endereço e mensagem", () => {
  it("normaliza o endereço público", () => {
    expect(normalizePublicUrl("meusite.com.br")).toBe("https://meusite.com.br");
    expect(normalizePublicUrl("  https://pediste.lovable.app/admin?x=1#a ")).toBe(
      "https://pediste.lovable.app",
    );
    expect(normalizePublicUrl("http://localhost:8081/algo")).toBe("http://localhost:8081");
  });
  it("recusa o que não é endereço web", () => {
    expect(normalizePublicUrl("")).toBeNull();
    expect(normalizePublicUrl("javascript:alert(1)")).toBeNull();
    expect(normalizePublicUrl("ftp://site.com")).toBeNull();
    expect(normalizePublicUrl("so uma frase")).toBeNull();
    expect(normalizePublicUrl("semponto")).toBeNull();
  });
  it("detecta endereço local", () => {
    expect(isLocalAddress("http://localhost:8081")).toBe(true);
    expect(isLocalAddress("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalAddress("https://pediste.lovable.app")).toBe(false);
  });
  it("mensagem com prazo, e aviso quando ainda vai abrir", () => {
    const open = whatsappMessage({
      name: "Almoço",
      link: "https://x.com.br",
      state: "open",
      opensAt: null,
      closesAt: "2026-11-06T15:30:00Z",
    });
    expect(open).toContain("*Almoço* — pedidos abertos!");
    expect(open).toContain("Faça seu pedido: https://x.com.br");
    expect(open).toContain("Pedidos até");
    expect(open).not.toContain("Abre");
    const waiting = whatsappMessage({
      name: "Almoço",
      link: "https://x.com.br",
      state: "waiting",
      opensAt: "2026-11-06T13:00:00Z",
      closesAt: null,
    });
    expect(waiting).toContain("pedidos em breve!");
    expect(waiting).toContain("Abre");
    expect(waiting).not.toContain("Pedidos até");
  });
  it("link do WhatsApp codifica a mensagem", () => {
    const l = whatsappLink("oi & tchau\nlinha 2");
    expect(l.startsWith("https://wa.me/?text=")).toBe(true);
    expect(l).toContain(encodeURIComponent("oi & tchau\nlinha 2"));
    expect(l).not.toContain(" ");
  });
});

describe("janela Compartilhar", () => {
  const round = {
    name: "Almoço",
    state: "open" as RoundState,
    opens_at: null,
    closes_at: "2026-11-06T15:30:00Z",
  };
  const setup = (over: Partial<typeof round> = {}) =>
    render(<ShareDialog open onOpenChange={() => {}} round={{ ...round, ...over }} />);

  beforeEach(() => {
    copyText.mockClear();
    localStorage.clear();
  });

  it("já vem com o endereço atual, o QR e a mensagem pronta", async () => {
    setup();
    const origin = window.location.origin;
    expect((screen.getByLabelText("Endereço do site") as HTMLInputElement).value).toBe(origin);
    expect(screen.getByRole("img", { name: `QR Code para ${origin}` })).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Mensagem para o WhatsApp") as HTMLTextAreaElement).value,
      ).toContain(`Faça seu pedido: ${origin}`),
    );
  });

  it("trocar o endereço atualiza QR e mensagem, e fica salvo", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Endereço do site"), {
      target: { value: "pediste.com.br" },
    });
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "QR Code para https://pediste.com.br" })).toBeTruthy(),
    );
    expect(
      (screen.getByLabelText("Mensagem para o WhatsApp") as HTMLTextAreaElement).value,
    ).toContain("https://pediste.com.br");
    expect(localStorage.getItem("pedeai:public-url")).toBe("https://pediste.com.br");
  });

  it("endereço inválido mostra erro e desliga as ações", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Endereço do site"), { target: { value: "sem ponto" } });
    expect(screen.getByRole("alert").textContent).toContain("Endereço inválido");
    expect((screen.getByRole("button", { name: /Baixar PNG/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("link", { name: /Abrir no WhatsApp/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: /Abrir no WhatsApp/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("depois de editar a mensagem à mão, ela não é sobrescrita", async () => {
    setup();
    const msg = screen.getByLabelText("Mensagem para o WhatsApp") as HTMLTextAreaElement;
    await waitFor(() => expect(msg.value).not.toBe(""));
    fireEvent.change(msg, { target: { value: "Minha mensagem" } });
    fireEvent.change(screen.getByLabelText("Endereço do site"), {
      target: { value: "outro.com.br" },
    });
    await act(async () => {});
    expect(msg.value).toBe("Minha mensagem");
  });

  it("copia o link e a mensagem; o botão do WhatsApp aponta para o wa.me com a mensagem", async () => {
    setup();
    const msg = screen.getByLabelText("Mensagem para o WhatsApp") as HTMLTextAreaElement;
    await waitFor(() => expect(msg.value).not.toBe(""));
    fireEvent.click(screen.getByRole("button", { name: /Copiar$/ }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(window.location.origin));
    fireEvent.click(screen.getByRole("button", { name: /Copiar mensagem/ }));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith(msg.value));
    const a = screen.getByRole("link", { name: /Abrir no WhatsApp/ });
    expect(a.getAttribute("href")).toBe(whatsappLink(msg.value));
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("avisa quando o endereço só funciona neste computador", () => {
    setup(); // jsdom roda em localhost
    expect(screen.getByText(/só funciona neste computador/)).toBeTruthy();
  });

  it("rodada encerrada: avisa que o link não aceita mais pedidos", () => {
    setup({ state: "closed" });
    expect(screen.getByRole("status").textContent).toContain("já encerrou");
  });

  it("imprimir cartaz chama a impressão e o cartaz existe só com a janela aberta", () => {
    window.print = vi.fn();
    setup();
    expect(document.querySelector(".comanda-print-root .poster")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Imprimir cartaz/ }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
