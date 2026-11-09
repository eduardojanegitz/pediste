/**
 * Web Push sem dependências (só WebCrypto, que roda no Cloudflare Workers e no Node).
 * Mandamos push SEM conteúdo: só a autenticação VAPID. O service worker mostra um texto fixo
 * ("Seu pedido está pronto!"), então não há o que criptografar nem dado pessoal passando pelo
 * serviço de push do navegador.
 */

const b64uToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const bytesToB64u = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const strToB64u = (s: string) => bytesToB64u(new TextEncoder().encode(s));

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** Chaves VAPID das variáveis de ambiente; `null` = notificação não configurada (recurso fica desligado). */
export function vapidFromEnv(): VapidConfig | null {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env["VAPID_SUBJECT"] || "mailto:admin@pediste.local",
  };
}

/** JWT ES256 do VAPID (RFC 8292) para o serviço de push do `audience`. */
export async function vapidJwt(cfg: VapidConfig, audience: string, nowMs = Date.now()) {
  const pub = b64uToBytes(cfg.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY inválida");
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64u(pub.slice(1, 33)),
      y: bytesToB64u(pub.slice(33, 65)),
      d: cfg.privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const head = strToB64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = strToB64u(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(nowMs / 1000) + 12 * 3600,
      sub: cfg.subject,
    }),
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${bytesToB64u(new Uint8Array(sig))}`;
}

export type PushResult = "sent" | "gone" | "failed";

/** Envia um push vazio. `gone` = inscrição expirada (404/410): quem chamou deve apagá-la. */
export async function sendPush(
  cfg: VapidConfig,
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  try {
    const jwt = await vapidJwt(cfg, new URL(endpoint).origin);
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${jwt}, k=${cfg.publicKey}`,
        TTL: "3600",
        Urgency: "high",
        "Content-Length": "0",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) {
      // Só o host e o código (o endereço completo é secreto); o corpo costuma dizer o motivo.
      const body = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`push recusado: ${new URL(endpoint).host} ${res.status} ${body}`);
    }
    return res.ok ? "sent" : "failed";
  } catch (e) {
    console.error("push", e instanceof Error ? e.message : e);
    return "failed";
  }
}

/**
 * Confere se a chave privada combina com a pública: assina um JWT de teste e verifica a assinatura
 * com a chave pública. Devolve null se está tudo certo, ou o motivo do problema.
 */
export async function vapidSelfTest(cfg: VapidConfig): Promise<string | null> {
  try {
    const pub = b64uToBytes(cfg.publicKey);
    if (pub.length !== 65 || pub[0] !== 4) return "a chave pública não tem o formato esperado";
    const jwt = await vapidJwt(cfg, "https://push.example");
    const [h, p, s] = jwt.split(".") as [string, string, string];
    const key = await crypto.subtle.importKey(
      "raw",
      pub,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64uToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    return ok
      ? null
      : "a chave privada não combina com a pública (foram geradas em execuções diferentes)";
  } catch {
    // O WebCrypto recusa a importação tanto de um par que não combina quanto de um formato inválido.
    return "a chave privada não combina com a pública ou tem formato inválido (gere as duas juntas com scripts/gen-vapid.mjs)";
  }
}
