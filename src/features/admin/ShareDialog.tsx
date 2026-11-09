import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, MessageCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyText } from "@/lib/export";
import type { RoundState } from "@/lib/orders.functions";
import { qrPngBlob } from "@/lib/qr-image";
import { QrCode } from "@/components/QrCode";
import { SharePoster } from "./SharePoster";
import {
  isLocalAddress,
  loadPublicUrl,
  normalizePublicUrl,
  savePublicUrl,
  whatsappLink,
  whatsappMessage,
} from "./share";
import { btnPlain, btnPrimary, field } from "./ui";
import "./print-root.css";

type ShareRound = {
  name: string;
  state: RoundState;
  opens_at: string | null;
  closes_at: string | null;
};

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "rodada";

/** Compartilhar a rodada: link, QR Code (PNG e cartaz A4) e mensagem pronta de WhatsApp. */
export function ShareDialog({
  open,
  onOpenChange,
  round,
  path = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  round: ShareRound;
  /** Caminho do estabelecimento no site ("" = padrão, "/e/<apelido>" nos demais). */
  path?: string;
}) {
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAddress(loadPublicUrl() ?? window.location.origin);
    setEdited(false);
  }, [open]);

  const base = useMemo(() => normalizePublicUrl(address), [address]);
  const link = base ? base + path : null;

  // Guarda o endereço só quando difere do atual (painel aberto por outro endereço que o público).
  useEffect(() => {
    if (!open || !base) return;
    savePublicUrl(base === window.location.origin ? null : base);
  }, [open, base]);

  // A mensagem acompanha link e horários até o organizador editá-la à mão.
  useEffect(() => {
    if (!open || edited || !link) return;
    setMessage(
      whatsappMessage({
        name: round.name,
        link,
        state: round.state,
        opensAt: round.opens_at,
        closesAt: round.closes_at,
      }),
    );
  }, [open, edited, link, round.name, round.state, round.opens_at, round.closes_at]);

  const copy = async (text: string, ok: string) => {
    try {
      await copyText(text);
      toast.success(ok);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  };

  const download = async () => {
    if (!link) return;
    const blob = await qrPngBlob(link);
    if (!blob) {
      toast.error("Não foi possível gerar a imagem.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${slug(round.name)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-2 border-foreground bg-background sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-4xl font-normal">
              Compartilhar a rodada
            </DialogTitle>
            <DialogDescription>
              Mande o link no grupo ou cole o QR Code no mural. Quem abrir faz o pedido sem criar
              conta.
            </DialogDescription>
          </DialogHeader>

          {round.state === "closed" && (
            <p
              role="status"
              className="rounded-2xl border-2 border-foreground bg-accent p-3 text-sm font-bold text-accent-foreground"
            >
              Esta rodada já encerrou: quem abrir o link verá que os pedidos acabaram.
            </p>
          )}

          <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-3">
              {link ? (
                <QrCode
                  text={link}
                  label={`QR Code para ${link}`}
                  className="h-56 w-56 rounded-2xl border-2 border-foreground"
                />
              ) : (
                <div className="grid h-56 w-56 place-items-center rounded-2xl border-2 border-dashed border-foreground p-4 text-center text-sm text-muted-foreground">
                  Informe um endereço válido para gerar o QR Code.
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className={btnPlain}
                  disabled={!link}
                  onClick={() => void download()}
                >
                  <Download className="h-4 w-4" aria-hidden /> Baixar PNG
                </button>
                <button
                  type="button"
                  className={btnPlain}
                  disabled={!link}
                  onClick={() => window.print()}
                >
                  <Printer className="h-4 w-4" aria-hidden /> Imprimir cartaz
                </button>
              </div>
            </div>

            <div className="min-w-0 space-y-5">
              <div>
                <label htmlFor="share-url" className="text-sm font-bold">
                  Endereço do site
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="share-url"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!link}
                    className={field}
                  />
                  <button
                    type="button"
                    className={btnPlain}
                    disabled={!link}
                    onClick={() => link && void copy(link, "Link copiado")}
                  >
                    <Copy className="h-4 w-4" aria-hidden /> Copiar
                  </button>
                </div>
                {!link && (
                  <p role="alert" className="mt-1 text-sm font-bold text-destructive">
                    Endereço inválido. Exemplo: meusite.com.br
                  </p>
                )}
                {link && isLocalAddress(link) && (
                  <p className="mt-1 text-sm font-semibold text-destructive">
                    Este endereço só funciona neste computador. Troque pelo endereço público do site
                    antes de compartilhar.
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Já vem preenchido com o endereço atual. Mude aqui se o painel e o site público
                  tiverem endereços diferentes; fica salvo neste navegador.
                </p>
              </div>

              <div>
                <label htmlFor="share-msg" className="text-sm font-bold">
                  Mensagem para o WhatsApp
                </label>
                <textarea
                  id="share-msg"
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setEdited(true);
                  }}
                  rows={6}
                  className={`${field} mt-1 resize-y`}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {link && message ? (
                    <a
                      href={whatsappLink(message)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={btnPrimary}
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden /> Abrir no WhatsApp
                    </a>
                  ) : (
                    <button type="button" disabled className={btnPrimary}>
                      <MessageCircle className="h-4 w-4" aria-hidden /> Abrir no WhatsApp
                    </button>
                  )}
                  <button
                    type="button"
                    className={btnPlain}
                    disabled={!message}
                    onClick={() => void copy(message, "Mensagem copiada")}
                  >
                    <Copy className="h-4 w-4" aria-hidden /> Copiar mensagem
                  </button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {open &&
        link &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="comanda-print-root" aria-hidden>
            <style>{"@page { size: A4; margin: 12mm; }"}</style>
            <SharePoster roundName={round.name} link={link} closesAt={round.closes_at} />
          </div>,
          document.body,
        )}
    </>
  );
}
