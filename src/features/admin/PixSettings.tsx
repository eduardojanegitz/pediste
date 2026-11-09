import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Copy, QrCode as QrIcon, ShieldCheck, Trash2 } from "lucide-react";
import { QrCode } from "@/components/QrCode";
import { copyToClipboard } from "@/lib/clipboard";
import { formatSaoPaulo } from "@/lib/format";
import { clearPixSettings, savePixSettings, type PixSettings } from "@/lib/pix.functions";
import {
  maskPixKey,
  normalizePixKey,
  pixPayload,
  pixText,
  PIX_KEY_LABEL,
  type PixKeyType,
} from "@/lib/pix";
import { ConfirmDialog } from "./ConfirmDialog";
import { btnPlain, btnPrimary, errMsg, field } from "./ui";

const KEY_PLACEHOLDER: Record<PixKeyType, string> = {
  cpf: "000.000.000-00",
  cnpj: "00.000.000/0000-00",
  email: "voce@exemplo.com.br",
  phone: "(15) 99999-9999",
  random: "123e4567-e12b-12d1-a456-426655440000",
};

export function PixSettingsForm({
  settings,
  audit,
}: {
  settings: PixSettings | null;
  audit: { changedAt: string; oldKey: string | null; newKey: string | null }[];
}) {
  const qc = useQueryClient();
  const save = useServerFn(savePixSettings);
  const clear = useServerFn(clearPixSettings);
  const [type, setType] = useState<PixKeyType>(settings?.type ?? "cpf");
  const [key, setKey] = useState(settings?.key ?? "");
  const [name, setName] = useState(settings?.name ?? "");
  const [city, setCity] = useState(settings?.city ?? "");
  const [errors, setErrors] = useState<{
    key?: string | undefined;
    name?: string | undefined;
    city?: string | undefined;
  }>({});
  const [busy, setBusy] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [test, setTest] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["pix-settings"] });
  const typed = normalizePixKey(type, key);
  const keyChanged =
    settings !== null && !(typed.ok && typed.key === settings.key && type === settings.type);

  const validate = () => {
    const next: typeof errors = {};
    const k = normalizePixKey(type, key);
    if (!k.ok) next.key = k.error;
    if (!pixText(name, 25)) next.name = "Informe o nome do recebedor (como aparece no banco).";
    if (!pixText(city, 15)) next.city = "Informe a cidade do recebedor.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const doSave = async () => {
    setConfirmSave(false);
    setBusy(true);
    try {
      const r = await save({ data: { type, key, name, city } });
      setKey(r.key);
      setName(r.name);
      setCity(r.city);
      await refresh();
      toast.success("Pix salvo");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    // Trocar uma chave que já recebe pagamentos pede confirmação: é o ponto mais sensível.
    if (settings && keyChanged) setConfirmSave(true);
    else void doSave();
  };

  const doClear = async () => {
    setConfirmClear(false);
    setBusy(true);
    try {
      await clear();
      setKey("");
      setName("");
      setCity("");
      await refresh();
      toast.success("Pix removido");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const testPayload = useMemo(() => {
    if (!test || !settings) return null;
    try {
      return pixPayload({
        key: settings.key,
        name: settings.name,
        city: settings.city,
        amountCents: 100,
      });
    } catch {
      return null;
    }
  }, [test, settings]);

  return (
    <section aria-label="Pix" className="pop-card space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-4xl">
          <ShieldCheck className="h-7 w-7" aria-hidden /> Receber por Pix
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Cada organizador cadastra a própria chave. Depois de confirmar o pedido, o participante vê
          o valor, o QR Code e o código Pix "copia e cola" da rodada que você abriu. O Pediste não
          confirma o pagamento sozinho: você marca quem já pagou na aba Pedidos.
        </p>
      </div>

      {settings && (
        <p className="rounded-2xl border-2 border-foreground bg-secondary px-4 py-2 text-sm font-bold text-secondary-foreground">
          Pix ativo: {PIX_KEY_LABEL[settings.type]} {maskPixKey(settings.type, settings.key)} ·{" "}
          {settings.name} · {settings.city}
        </p>
      )}

      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div>
          <label htmlFor="pix-type" className="text-sm font-bold">
            Tipo da chave
          </label>
          <select
            id="pix-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as PixKeyType);
              setErrors((x) => ({ ...x, key: undefined }));
            }}
            className={`${field} mt-1`}
          >
            {(Object.keys(PIX_KEY_LABEL) as PixKeyType[]).map((t) => (
              <option key={t} value={t}>
                {PIX_KEY_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pix-key" className="text-sm font-bold">
            Chave Pix
          </label>
          <input
            id="pix-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={KEY_PLACEHOLDER[type]}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!errors.key}
            aria-describedby={errors.key ? "pix-key-err" : undefined}
            className={`${field} mt-1`}
          />
          {errors.key && (
            <p id="pix-key-err" role="alert" className="mt-1 text-sm font-bold text-destructive">
              {errors.key}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="pix-name" className="text-sm font-bold">
            Nome do recebedor
          </label>
          <input
            id="pix-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como aparece no seu banco"
            autoComplete="off"
            aria-invalid={!!errors.name}
            className={`${field} mt-1`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Vai no código sem acento, em maiúsculas e com até 25 letras.
          </p>
          {errors.name && (
            <p role="alert" className="mt-1 text-sm font-bold text-destructive">
              {errors.name}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="pix-city" className="text-sm font-bold">
            Cidade do recebedor
          </label>
          <input
            id="pix-city"
            value={city}
            maxLength={40}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Ex.: Sorocaba"
            autoComplete="off"
            aria-invalid={!!errors.city}
            className={`${field} mt-1`}
          />
          <p className="mt-1 text-xs text-muted-foreground">Até 15 letras no código.</p>
          {errors.city && (
            <p role="alert" className="mt-1 text-sm font-bold text-destructive">
              {errors.city}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" className={btnPrimary} disabled={busy}>
            Salvar Pix
          </button>
          {settings && (
            <>
              <button type="button" className={btnPlain} onClick={() => setTest((t) => !t)}>
                <QrIcon className="h-4 w-4" aria-hidden />{" "}
                {test ? "Esconder teste" : "Testar com R$ 1,00"}
              </button>
              <button
                type="button"
                className={btnPlain}
                disabled={busy}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remover Pix
              </button>
            </>
          )}
        </div>
      </form>

      {testPayload && (
        <div className="grid gap-4 rounded-2xl border-2 border-foreground p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <QrCode
            text={testPayload}
            label="QR Code Pix de teste de R$ 1,00"
            className="h-44 w-44 rounded-xl border-2 border-foreground"
          />
          <div className="min-w-0">
            <p className="text-sm font-bold">Confira antes de usar</p>
            <p className="text-sm text-muted-foreground">
              Aponte o app do seu banco para este QR. Deve aparecer <strong>o seu nome</strong> e{" "}
              <strong>R$ 1,00</strong>. É só para conferir: não precisa pagar.
            </p>
            <button
              type="button"
              className={`${btnPlain} mt-3`}
              onClick={() =>
                void copyToClipboard(testPayload).then(
                  () => toast.success("Código copiado"),
                  () => toast.error("Não foi possível copiar."),
                )
              }
            >
              <Copy className="h-4 w-4" aria-hidden /> Copiar código de teste
            </button>
          </div>
        </div>
      )}

      {audit.length > 0 && (
        <div>
          <h3 className="text-2xl">Últimas trocas de chave</h3>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {audit.map((a, i) => (
              <li key={i}>
                {formatSaoPaulo(a.changedAt)}: {a.oldKey ?? "nenhuma"} → {a.newKey ?? "removida"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title="Trocar a chave Pix?"
        description="Os pagamentos das rodadas abertas por você passam a ir para a nova chave. Confira se ela é sua. A troca fica registrada."
        confirmLabel="Trocar chave"
        onConfirm={() => void doSave()}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Remover o Pix?"
        description="Os participantes deixam de ver o QR Code e o código de pagamento. Pagamentos já marcados continuam marcados."
        confirmLabel="Remover"
        onConfirm={() => void doClear()}
      />
    </section>
  );
}
