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
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
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
ok(true, "migrações aplicam e reaplicam: " + files.length);
const P = "00000000-0000-0000-0000-0000000000e1", R = "00000000-0000-0000-0000-0000000000f1";
const id = (x) => `00000000-0000-0000-0000-000000000${x}`;
const items = (n) => JSON.stringify([{product_id:id("b01"),quantity:1},{product_id:id("c01"),quantity:1},{product_id:id("c02"),quantity:1,note:n}]);
await db.query("SELECT submit_order($1,$2,$3::jsonb,0,$4)", [P, R, items("a"), "11111111-1111-1111-1111-111111111111"]);
const ord = async () => (await db.query("SELECT updated_at, done_at, paid_at, version FROM orders")).rows[0];
let o = await ord();
ok(o.done_at === null, "pedido nasce sem conclusão");
await new Promise(r => setTimeout(r, 30));
const before = o.updated_at.getTime();
await db.exec(`UPDATE orders SET done_at = now()`);
o = await ord();
ok(o.done_at !== null && o.updated_at.getTime() === before, "concluir preserva updated_at");
await new Promise(r => setTimeout(r, 30));
await db.exec(`UPDATE orders SET done_at = NULL`);
o = await ord();
ok(o.done_at === null && o.updated_at.getTime() === before, "desfazer também preserva updated_at");
await db.exec(`UPDATE orders SET done_at = now(), paid_at = now()`);
o = await ord();
ok(o.updated_at.getTime() === before, "concluir + pagar juntos também não contam como alteração");
// editar depois de concluído: updated_at passa à frente de done_at (a tela avisa)
await new Promise(r => setTimeout(r, 30));
await db.query("SELECT submit_order($1,$2,$3::jsonb,1,$4)", [P, R, items("b"), "11111111-1111-1111-1111-111111111112"]);
o = await ord();
ok(o.done_at !== null && o.updated_at.getTime() > o.done_at.getTime(), "editar depois de concluído deixa updated_at maior que done_at");
ok(o.version === 2, "e a versão sobe");
await new Promise(r => setTimeout(r, 30));
const b2 = o.updated_at.getTime();
await db.exec("UPDATE orders SET status = 'cancelled'");
o = await ord();
ok(o.updated_at.getTime() > b2, "cancelar continua contando como mudança");
console.log(fail ? `\n${fail} FALHA(S)` : "\nTudo certo");
process.exit(fail ? 1 : 0);
