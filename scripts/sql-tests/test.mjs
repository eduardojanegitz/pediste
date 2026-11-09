import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const root = fileURLToPath(new URL("../../supabase", import.meta.url));
const db = new PGlite();
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
const code = async (p) => { try { await p; return "OK"; } catch (e) { return e.message.split("\n")[0].replace(/^error: /i, ""); } };

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit int, allowed_mime_types text[]);
`);
await db.exec(fs.readFileSync(path.join(root, "setup.sql"), "utf8"));
// categorias/produtos pré-existentes (migração não pode quebrar dados antigos)
await db.exec(`
INSERT INTO categories (id,name,position) VALUES ('00000000-0000-0000-0000-0000000000a1','Prato principal',0),('00000000-0000-0000-0000-0000000000a2','Acompanhamentos',1);
INSERT INTO products (id,category_id,name) VALUES
 ('00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-0000000000a1','Frango'),
 ('00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-0000000000a1','Lasanha'),
 ('00000000-0000-0000-0000-000000000c01','00000000-0000-0000-0000-0000000000a2','Arroz'),
 ('00000000-0000-0000-0000-000000000c02','00000000-0000-0000-0000-0000000000a2','Purê'),
 ('00000000-0000-0000-0000-000000000c03','00000000-0000-0000-0000-0000000000a2','Farofa'),
 ('00000000-0000-0000-0000-000000000d01','00000000-0000-0000-0000-0000000000a2','Inativo');
INSERT INTO rounds (id,name) VALUES ('00000000-0000-0000-0000-0000000000f1','Almoço');
INSERT INTO participants (id,display_name,token_hash) VALUES ('00000000-0000-0000-0000-0000000000e1','João','h1');
`);
const files = fs.readdirSync(path.join(root, "migrations")).sort();
for (const f of files) await db.exec(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
// idempotência: rodar de novo não pode falhar
for (const f of files) await db.exec(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
ok(true, "migrações aplicam e reaplicam sem erro (" + files.length + " arquivos)");

const lim = (await db.query("SELECT name,min_select,max_select FROM categories ORDER BY position")).rows;
ok(lim[0].min_select === 1 && lim[0].max_select === 1 && lim[1].min_select === 2 && lim[1].max_select === 2, "limites iniciais 1/1 e 2/2");
ok((await code(db.exec("UPDATE categories SET min_select=3,max_select=2"))).includes("categories_min_le_max"), "max < min é rejeitado");
ok((await code(db.exec("UPDATE participants SET phone_e164='15999999999'"))).includes("participants_phone_format"), "celular fora do E.164 rejeitado");
await db.exec("UPDATE participants SET phone_e164='+5515999999999'");
ok((await db.query("SELECT count(*)::int n FROM products WHERE is_active")).rows[0].n === 6, "produtos antigos ficam ativos");

await db.exec("UPDATE products SET is_active=false WHERE name='Inativo'");
const P = "00000000-0000-0000-0000-0000000000e1", R = "00000000-0000-0000-0000-0000000000f1";
const it = (...ids) => JSON.stringify(ids.map((id) => ({ product_id: `00000000-0000-0000-0000-000000000${id}`, quantity: 1 })));
const submit = (items, ver, req) => db.query("SELECT submit_order($1,$2,$3::jsonb,$4,$5) r", [P, R, items, ver, req]);
const rid = (n) => `11111111-1111-1111-1111-11111111111${n}`;

const r1 = (await submit(it("b01", "c01", "c02"), 0, rid(1))).rows[0].r;
ok(r1.version === 1 && r1.replayed === false, "primeiro pedido grava (versão 1)");
const r1b = (await submit(it("b01", "c01", "c02"), 0, rid(1))).rows[0].r;
ok(r1b.replayed === true && r1b.version === 1, "reenvio com mesma chave não duplica");
ok((await db.query("SELECT count(*)::int n FROM orders")).rows[0].n === 1, "um único pedido");

ok((await code(submit(it("b01", "c01"), 1, rid(2)))) === "CATEGORY_MIN", "mínimo de acompanhamentos exigido");
ok((await code(submit(it("b01", "c01", "c02", "c03"), 1, rid(2)))) === "CATEGORY_MAX", "máximo de acompanhamentos respeitado");
ok((await code(submit(it("b01", "b02", "c01", "c02"), 1, rid(2)))) === "CATEGORY_MAX", "só 1 prato principal");
ok((await code(submit(it("c01", "c02"), 1, rid(2)))) === "CATEGORY_MIN", "prato principal obrigatório");
ok((await code(submit(it("b01", "c01", "d01"), 1, rid(2)))) === "PRODUCT_UNAVAILABLE", "produto inativo rejeitado");
ok((await code(submit(JSON.stringify([{ product_id: "00000000-0000-0000-0000-000000000b01", quantity: 2 }, ...JSON.parse(it("c01", "c02"))]), 1, rid(2)))) === "QUANTITY_NOT_ALLOWED", "quantidade 2 bloqueada sem allow_quantity");
ok((await code(submit("[]", 1, rid(2)))) === "INVALID_ITEMS", "lista vazia inválida");
ok((await code(submit('[{"product_id":"x","quantity":1}]', 1, rid(2)))) === "INVALID_ITEMS", "uuid inválido -> INVALID_ITEMS");
ok((await code(submit(it("b01", "c01", "c02"), 0, rid(2)))) === "VERSION_CONFLICT", "versão antiga gera conflito");
const kept = (await db.query("SELECT count(*)::int n FROM order_items")).rows[0].n;
ok(kept === 3, "falhas não alteram os itens (atomicidade)");

const r2 = (await submit(it("b02", "c01", "c03"), 1, rid(3))).rows[0].r;
ok(r2.version === 2, "edição incrementa versão");
const names = (await db.query("SELECT string_agg(p.name,',' ORDER BY p.name) s FROM order_items i JOIN products p ON p.id=i.product_id")).rows[0].s;
ok(names === "Arroz,Farofa,Lasanha", "edição substitui itens no mesmo pedido");
ok((await db.query("SELECT count(*)::int n FROM orders")).rows[0].n === 1, "edição não cria pedido duplicado");

await db.exec("UPDATE rounds SET closes_at = now() - interval '1 minute'");
ok((await code(submit(it("b01", "c01", "c02"), 2, rid(4)))) === "ROUND_CLOSED", "após closes_at: encerrado");
ok((await submit(it("b02", "c01", "c03"), 2, rid(3))).rows[0].r.replayed === true, "reenvio após encerrar devolve o já salvo");
await db.exec("UPDATE rounds SET closes_at=NULL, opens_at = now() + interval '1 hour'");
ok((await code(submit(it("b01", "c01", "c02"), 2, rid(4)))) === "ROUND_NOT_STARTED", "antes de opens_at: aguardando");
ok((await db.query("SELECT round_state(r) s FROM rounds r")).rows[0].s === "waiting", "round_state = waiting");
await db.exec("UPDATE rounds SET opens_at=NULL");
await db.exec("UPDATE rounds SET status='closed'");
ok((await code(submit(it("b01", "c01", "c02"), 2, rid(4)))) === "ROUND_CLOSED", "status closed bloqueia");
await db.exec("UPDATE rounds SET status='open'");
await db.exec("UPDATE categories SET is_active=false WHERE name='Acompanhamentos'");
ok((await code(submit(it("b01"), 2, rid(5)))) === "OK", "categoria inativa não exige mínimo");
ok((await code(submit(it("b01", "c01"), 3, rid(6)))) === "PRODUCT_UNAVAILABLE", "produto de categoria inativa rejeitado");
ok((await db.query("SELECT has_function_privilege('anon','submit_order(uuid,uuid,jsonb,integer,uuid)','execute') a, has_function_privilege('service_role','submit_order(uuid,uuid,jsonb,integer,uuid)','execute') s")).rows[0].a === false, "anon não executa submit_order");
ok((await db.query("SELECT has_table_privilege('authenticated','admins','select') a")).rows[0].a === false, "authenticated não lê admins");


// ---------- migração 5 ----------
const hit = async (k, max, win) => (await db.query("SELECT hit_rate_limit($1,$2,$3) ok", [k, max, win])).rows[0].ok;
ok((await hit("a", 3, 60)) && (await hit("a", 3, 60)) && (await hit("a", 3, 60)), "rate limit: 3 primeiras passam");
ok(!(await hit("a", 3, 60)), "rate limit: 4ª bloqueada");
ok(await hit("b", 3, 60), "rate limit: chaves independentes");
await db.exec("UPDATE rate_limits SET window_start = now() - interval '2 minutes' WHERE key='a'");
ok(await hit("a", 3, 60), "rate limit: janela expira e reinicia");

await db.exec("UPDATE participants SET recovery_hash='hh' WHERE id='" + P + "'");
const br = async (ph) => (await db.query("SELECT * FROM begin_recovery($1)", [ph])).rows;
ok((await br("+5511000000000")).length === 0, "recuperação: celular desconhecido = sem linhas");
for (let i = 1; i <= 5; i++) ok((await br("+5515999999999")).length === 1, "recuperação: tentativa " + i + " permitida");
ok((await br("+5515999999999")).length === 0, "recuperação: 6ª tentativa bloqueada");
await db.exec("UPDATE participants SET locked_until = now() - interval '1 minute' WHERE id='" + P + "'");
ok((await br("+5515999999999")).length === 1, "recuperação: após o bloqueio expirar volta a permitir");
ok((await db.query("SELECT recovery_attempts a FROM participants WHERE id='" + P + "'")).rows[0].a === 1, "recuperação: contador reinicia em 1");
await db.exec("SELECT finish_recovery('" + P + "','newhash')");
const pr = (await db.query("SELECT token_hash,recovery_attempts a,locked_until l FROM participants WHERE id='" + P + "'")).rows[0];
ok(pr.token_hash === "newhash" && pr.a === 0 && pr.l === null, "finish_recovery troca token e zera tentativas");
await db.exec("UPDATE participants SET recovery_hash=NULL WHERE id='" + P + "'");
ok((await br("+5515999999999")).length === 0, "participante sem código não recupera");

await db.exec("UPDATE rounds SET status='open', opens_at=NULL, closes_at=NULL");
const ar = (await db.query("SELECT * FROM get_active_round()")).rows;
ok(ar.length === 1 && ar[0].state === "open" && ar[0].server_now, "get_active_round: aberta, com server_now");
await db.exec("UPDATE rounds SET opens_at = now() + interval '1 hour'");
ok((await db.query("SELECT state FROM get_active_round()")).rows[0].state === "waiting", "get_active_round: aguardando");
await db.exec("UPDATE rounds SET opens_at=NULL, closes_at = now() - interval '1 second'");
ok((await db.query("SELECT state FROM get_active_round()")).rows[0].state === "closed", "get_active_round: encerrada por horário");
ok((await db.query("SELECT get_round_state($1) s", [R])).rows[0].s === "closed", "get_round_state");
ok((await db.query("SELECT get_round_state('00000000-0000-0000-0000-000000000000') s")).rows[0].s === null, "get_round_state: inexistente = null");
ok((await db.query("SELECT has_function_privilege('anon','begin_recovery(text)','execute') a")).rows[0].a === false, "anon não executa begin_recovery");
ok((await db.query("SELECT has_table_privilege('anon','rate_limits','select') a")).rows[0].a === false, "anon não lê rate_limits");

console.log(fail ? `\n${fail} FALHA(S)` : "\nTudo certo");
process.exit(fail ? 1 : 0);
