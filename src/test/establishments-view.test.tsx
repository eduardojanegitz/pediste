import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EstablishmentsView } from "@/features/admin/EstablishmentsView";
import type { EstablishmentAdminRow } from "@/lib/establishments-admin.functions";

const invalidate = vi.fn(async () => {});
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));

const list = vi.fn();
const create = vi.fn();
const rename = vi.fn();
const add = vi.fn();
const remove = vi.fn();
vi.mock("@/lib/establishments-admin.functions", () => ({
  listEstablishmentsAdmin: () => list(),
  createEstablishment: (a: unknown) => create(a),
  renameEstablishment: (a: unknown) => rename(a),
  addEstablishmentAdmin: (a: unknown) => add(a),
  removeEstablishmentAdmin: (a: unknown) => remove(a),
}));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toast.success(m), error: (m: string) => toast.error(m) },
}));

const ROWS: EstablishmentAdminRow[] = [
  {
    id: "e1",
    name: "Padrão",
    slug: "padrao",
    isDefault: true,
    members: [{ adminId: "a1", email: "dona@exemplo.com", isSuper: true }],
  },
  {
    id: "e2",
    name: "Padaria do Zé",
    slug: "padaria-do-ze",
    isDefault: false,
    members: [],
  },
];

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EstablishmentsView />
    </QueryClientProvider>,
  );

describe("EstablishmentsView", () => {
  beforeEach(() => {
    for (const f of [list, create, rename, add, remove, invalidate, toast.success, toast.error])
      f.mockReset();
    list.mockResolvedValue(ROWS);
    create.mockResolvedValue({ id: "e3", slug: "x" });
    rename.mockResolvedValue({ ok: true });
    add.mockResolvedValue({ ok: true });
    remove.mockResolvedValue({ ok: true });
  });

  it("lista os estabelecimentos com endereço e quem acessa", async () => {
    wrap();
    expect(await screen.findByText("Padaria do Zé")).toBeInTheDocument();
    expect(screen.getByText("dona@exemplo.com")).toBeInTheDocument();
    expect(screen.getByText("super")).toBeInTheDocument();
    expect(screen.getByText("Padrão", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("/e/padaria-do-ze")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nenhum administrador vinculado. Os super administradores sempre veem todos.",
      ),
    ).toBeInTheDocument();
  });

  it("cria com o apelido gerado do nome e recarrega o painel", async () => {
    wrap();
    await screen.findByText("Padaria do Zé");
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Café da Esquina" } });
    expect((screen.getByLabelText("Apelido do endereço") as HTMLInputElement).value).toBe(
      "cafe-da-esquina",
    );
    fireEvent.click(screen.getByRole("button", { name: /Criar estabelecimento/ }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        data: { name: "Café da Esquina", slug: "cafe-da-esquina" },
      }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Estabelecimento criado");
    await waitFor(() => expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe(""));
  });

  it("apelido inválido bloqueia a criação", async () => {
    wrap();
    await screen.findByText("Padaria do Zé");
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Loja" } });
    fireEvent.change(screen.getByLabelText("Apelido do endereço"), {
      target: { value: "Com Espaço" },
    });
    expect(screen.getByRole("button", { name: /Criar estabelecimento/ })).toBeDisabled();
  });

  it("mostra o erro do servidor (apelido repetido) e não limpa o formulário", async () => {
    create.mockRejectedValue(new Error("Já existe um estabelecimento com este apelido."));
    wrap();
    await screen.findByText("Padaria do Zé");
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Padaria do Zé" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar estabelecimento/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Já existe um estabelecimento com este apelido."),
    );
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Padaria do Zé");
  });

  it("libera um administrador pelo e-mail", async () => {
    wrap();
    const card = (await screen.findByText("Padaria do Zé")).closest("li")!;
    fireEvent.change(within(card).getByLabelText("Liberar um administrador (e-mail)"), {
      target: { value: "nova@exemplo.com" },
    });
    fireEvent.click(within(card).getByRole("button", { name: /Liberar/ }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        data: { establishmentId: "e2", email: "nova@exemplo.com" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Acesso liberado");
  });

  it("e-mail sem conta mostra a orientação do servidor", async () => {
    add.mockRejectedValue(
      new Error("Não há usuário com este e-mail. Crie a conta em Authentication."),
    );
    wrap();
    const card = (await screen.findByText("Padaria do Zé")).closest("li")!;
    fireEvent.change(within(card).getByLabelText("Liberar um administrador (e-mail)"), {
      target: { value: "x@y.com" },
    });
    fireEvent.click(within(card).getByRole("button", { name: /Liberar/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não há usuário")),
    );
  });

  it("remover o acesso pede confirmação antes", async () => {
    wrap();
    fireEvent.click(
      await screen.findByRole("button", { name: "Remover acesso de dona@exemplo.com" }),
    );
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Remover acesso" }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ data: { establishmentId: "e1", adminId: "a1" } }),
    );
    expect(toast.success).toHaveBeenCalledWith("Acesso removido");
  });

  it("renomeia sem mexer no apelido", async () => {
    wrap();
    const card = (await screen.findByText("Padaria do Zé")).closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: "Renomear" }));
    fireEvent.change(within(card).getByLabelText("Novo nome"), {
      target: { value: "Padaria Nova" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(rename).toHaveBeenCalledWith({ data: { id: "e2", name: "Padaria Nova" } }),
    );
  });

  it("erro ao carregar oferece tentar de novo", async () => {
    list.mockRejectedValueOnce(new Error("x"));
    wrap();
    expect(
      await screen.findByText("Não foi possível carregar os estabelecimentos."),
    ).toBeInTheDocument();
    list.mockResolvedValue(ROWS);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Padaria do Zé")).toBeInTheDocument();
  });
});
