import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
const root = fileURLToPath(new URL("../../supabase", import.meta.url));
const db = new PGlite();
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
const code = async (p) => { try { await p; return "OK"; } catch (e) { return e.message.split("\n")[0].replace(/^error: /i, ""); } };
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit int, allowed_mime_types text[]);`);
await db.exec(fs.readFileSync(path.join(root, "setup.sql"), "utf8"));
await db.exec(`
INSERT INTO categories (id,name,position) VALUES ('00000000-0000-0000-0000-0000000000a1','Prato principal',0),('00000000-0000-0000-0000-0000000000a2','Acompanhamentos',1);
INSERT INTO products (id,category_id,name) VALUES
 ('00000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-0000000000a1','Frango'),
 ('00000000-0000-0000-0000-000000000c01','00000000-0000-0000-0000-0000000000a2','Arroz'),
 ('00000000-0000-0000-0000-000000000c02','00000000-0000-0000-0000-0000000000a2','Purê');
INSERT INTO rounds (id,name) VALUES ('00000000-0000-0000-0000-0000000000f1','Almoço');
INSERT INTO participants (id,display_name,token_hash) VALUES ('00000000-0000-0000-0000-0000000000e1','João','h1');
`);
const files = fs.readdirSync(path.join(root, "migrations")).sort();
for (const f of files) await db.exec(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
for (const f of files) await db.exec(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
ok(true, "migrações (incluindo a de observações) aplicam e reaplicam: " + files.length);
const P = "00000000-0000-0000-0000-0000000000e1", R = "00000000-0000-0000-0000-0000000000f1";
const id = (x) => `00000000-0000-0000-0000-000000000${x}`;
const submit = (items, ver, n) => db.query("SELECT submit_order($1,$2,$3::jsonb,$4,$5) r", [P, R, JSON.stringify(items), ver, `11111111-1111-1111-1111-11111111111${n}`]);
const notes = async () => Object.fromEntries((await db.query("SELECT p.name, oi.note FROM order_items oi JOIN products p ON p.id=oi.product_id")).rows.map(r => [r.name, r.note]));

await submit([
  { product_id: id("b01"), quantity: 1, note: "  sem   cebola\n e  bem passado " },
  { product_id: id("c01"), quantity: 1 },
  { product_id: id("c02"), quantity: 1, note: "   " },
], 0, 1);
let n = await notes();
ok(n["Frango"] === "sem cebola e bem passado", "observação é limpa (espaços/quebras) e gravada");
ok(n["Arroz"] === null, "sem observação = NULL");
ok(n["Purê"] === null, "observação só com espaços = NULL");

await submit([
  { product_id: id("b01"), quantity: 1, note: null },
  { product_id: id("c01"), quantity: 1, note: "pouco sal" },
  { product_id: id("c02"), quantity: 1 },
], 1, 2);
n = await notes();
ok(n["Frango"] === null && n["Arroz"] === "pouco sal", "edição substitui as observações");

const long = "x".repeat(141);
ok((await code(submit([{ product_id: id("b01"), quantity: 1, note: long }, { product_id: id("c01"), quantity: 1 }, { product_id: id("c02"), quantity: 1 }], 2, 3))) === "INVALID_ITEMS", "141 caracteres é rejeitado");
await submit([{ product_id: id("b01"), quantity: 1, note: "y".repeat(140) }, { product_id: id("c01"), quantity: 1 }, { product_id: id("c02"), quantity: 1 }], 2, 4);
ok((await notes())["Frango"].length === 140, "140 caracteres é aceito");
ok((await code(db.exec("UPDATE order_items SET note=''"))).includes("order_items_note_len"), "o banco recusa observação vazia por conta própria");
ok((await code(db.exec("UPDATE order_items SET note=repeat('z',141)"))).includes("order_items_note_len"), "o banco recusa observação longa por conta própria");

// duplicados do mesmo produto: soma quantidade e fica uma observação
await db.exec("UPDATE categories SET allow_quantity=true WHERE name='Acompanhamentos'");
await submit([{ product_id: id("b01"), quantity: 1 }, { product_id: id("c01"), quantity: 1, note: "a" }, { product_id: id("c01"), quantity: 1, note: "b" }, { product_id: id("c02"), quantity: 1 }], 3, 5);
const rows = (await db.query("SELECT oi.quantity, oi.note FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE p.name='Arroz'")).rows;
ok(rows.length === 1 && rows[0].quantity === 2 && rows[0].note === "a", "duplicados: 1 linha, quantidade somada, uma observação");

// texto estranho não vira SQL nem quebra
await submit([{ product_id: id("b01"), quantity: 1, note: "'; DROP TABLE orders; --" }, { product_id: id("c01"), quantity: 1 }, { product_id: id("c02"), quantity: 1 }], 4, 6);
ok((await notes())["Frango"] === "'; DROP TABLE orders; --", "aspas e SQL ficam como texto");
ok((await db.query("SELECT count(*)::int n FROM orders")).rows[0].n === 1, "tabela de pedidos intacta");
ok((await db.query("SELECT has_function_privilege('anon','submit_order(uuid,uuid,jsonb,integer,uuid)','execute') a")).rows[0].a === false, "anon continua sem executar submit_order");
console.log(fail ? `\n${fail} FALHA(S)` : "\nTudo certo");
process.exit(fail ? 1 : 0);
