import { formatSaoPaulo } from "@/lib/format";
import { QrCode } from "@/components/QrCode";
import "./share-poster.css";

/** Cartaz A4 com o QR Code, para colar no mural ou na porta. Preto e branco (impressora comum). */
export function SharePoster({
  roundName,
  link,
  closesAt,
}: {
  roundName: string;
  link: string;
  closesAt: string | null;
}) {
  return (
    <div className="poster">
      <p className="poster__brand">PEDISTE</p>
      <h1 className="poster__title">Faça seu pedido</h1>
      <p className="poster__round">{roundName}</p>
      <QrCode text={link} label={`QR Code para ${link}`} className="poster__qr" />
      <p className="poster__how">Aponte a câmera do celular para o QR Code</p>
      <p className="poster__link">{link.replace(/^https?:\/\//, "")}</p>
      {closesAt && <p className="poster__deadline">Pedidos até {formatSaoPaulo(closesAt)}</p>}
    </div>
  );
}
