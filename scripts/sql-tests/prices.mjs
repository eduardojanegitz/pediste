import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const root = fileURLToPath(new URL("../../supabase", import.meta.url));
const db = new PGlite();
let fail = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fail++;
};
const code = async (p) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e.message.split("\n")[0].replace(/^error: /i, "");
  }
};
const id = (x) => `00000000-0000-0000-0000-000000000${x}`;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit int, allowed_mime_types text[]);`);
await db.exec(fs.readFileSync(path.join(root, "setup.sql"), "utf8"));

const files = fs.readdirSync(path.join(root, "migrations")).sort();
const at = files.findIndex((f) => f.startsWith("20261109000400"));
for (const f of files.slice(0, at)) await db.exec(fs.readFileSync(path.join(root, "migrations", f), "utf8"));

// Estado ANTES desta migração: um pedido antigo, com um produto que tem preço e outro sem.
await db.exec(`
INSERT INTO categories (id,name,position,min_select,max_select) VALUES ('${id("c01")}','Pratos',0,0,5);
INSERT INTO products (id,category_id,name,price_cents) VALUES
  ('${id("b01")}','${id("c01")}','Frango',1000),
  ('${id("b02")}','${id("c01")}','Suco',NULL);
INSERT INTO rounds (id,name) VALUES ('${id("f01")}','Almoço');
INSERT INTO participants (id,display_name,token_hash) VALUES ('${id("e01")}','João','h1');
INSERT INTO orders (id,round_id,participant_id,status,version) VALUES ('${id("d01")}','${id("f01")}','${id("e01")}','confirmed',1);
INSERT INTO order_items (order_id,product_id,quantity) VALUES ('${id("d01")}','${id("b01")}',2), ('${id("d01")}','${id("b02")}',1);
`);

const mig = fs.readFileSync(path.join(root, "migrations", files[at]), "utf8");
await db.exec(mig);
const items = () =>
  q(`SELECT product_id, unit_price_cents FROM order_items ORDER BY product_id`);

let it = await items();
ok(it[0].unit_price_cents === 1000, "pedido antigo recebe o preço atual do produto (uma vez)");
ok(it[1].unit_price_cents === null, "produto sem preço continua sem preço");

// Reaplicar não congela de novo (o preço mudou e o item antigo não deve acompanhar).
await db.exec(`UPDATE products SET price_cents = 1500 WHERE id = '${id("b01")}'`);
await db.exec(mig);
ok((await items())[0].unit_price_cents === 1000, "reaplicar a migração não refaz o preço dos itens");

// Constraint de faixa.
ok((await code(db.exec(`UPDATE order_items SET unit_price_cents = -1`))) !== "OK", "preço negativo é recusado");
ok((await code(db.exec(`UPDATE order_items SET unit_price_cents = 10000000`))) !== "OK", "preço acima do limite é recusado");

// Novo pedido grava o preço da hora.
await db.exec(`INSERT INTO participants (id,display_name,token_hash) VALUES ('${id("e02")}','Maria','h2')`);
const P = id("e02");
const send = (ver, req, list) =>
  db.query("SELECT submit_order($1,$2,$3::jsonb,$4,$5)", [P, id("f01"), JSON.stringify(list), ver, req]);
await send(0, "11111111-1111-1111-1111-111111111111", [
  { product_id: id("b01"), quantity: 1 },
  { product_id: id("b02"), quantity: 1 },
]);
const mine = () =>
  q(
    `SELECT oi.product_id, oi.unit_price_cents FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.participant_id = $1 ORDER BY oi.product_id`,
    [P],
  );
let m = await mine();
ok(m[0].unit_price_cents === 1500 && m[1].unit_price_cents === null, "novo pedido grava o preço do momento (e null sem preço)");

// Mudar o preço depois NÃO altera o pedido.
await db.exec(`UPDATE products SET price_cents = 9900 WHERE id = '${id("b01")}'`);
m = await mine();
ok(m[0].unit_price_cents === 1500, "mudar o preço do produto não altera o pedido já feito");
ok((await items()).find((r) => r.product_id === id("b01")).unit_price_cents === 1000, "nem o pedido antigo");

// Editar o pedido regrava com os preços da hora da edição.
await send(1, "22222222-2222-2222-2222-222222222222", [{ product_id: id("b01"), quantity: 1 }]);
m = await mine();
ok(m.length === 1 && m[0].unit_price_cents === 9900, "editar o pedido regrava com o preço da hora da edição");

// Reenvio idempotente não mexe nos preços.
await db.exec(`UPDATE products SET price_cents = 100 WHERE id = '${id("b01")}'`);
await send(1, "22222222-2222-2222-2222-222222222222", [{ product_id: id("b01"), quantity: 1 }]);
ok((await mine())[0].unit_price_cents === 9900, "reenvio do mesmo pedido não reprecifica");

// Segurança: continua restrita ao servidor.
const g = await q(`SELECT grantee FROM information_schema.routine_privileges WHERE routine_name = 'submit_order' AND grantee IN ('anon','authenticated','PUBLIC')`);
ok(g.length === 0, "anon/authenticated não executam submit_order");

console.log(fail ? `\n${fail} FALHA(S)` : "\nTudo certo");
process.exit(fail ? 1 : 0);
