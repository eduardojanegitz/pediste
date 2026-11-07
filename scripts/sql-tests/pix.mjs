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
const U = "00000000-0000-0000-0000-0000000000aa";
await db.exec(`INSERT INTO auth.users (id) VALUES ('${U}')`);
const P = "00000000-0000-0000-0000-0000000000e1", R = "00000000-0000-0000-0000-0000000000f1";
const id = (x) => `00000000-0000-0000-0000-000000000${x}`;
await db.query("SELECT submit_order($1,$2,$3::jsonb,0,$4)", [P, R, JSON.stringify([{product_id:id("b01"),quantity:1},{product_id:id("c01"),quantity:1},{product_id:id("c02"),quantity:1}]), "11111111-1111-1111-1111-111111111111"]);
const ord = async () => (await db.query("SELECT updated_at, paid_at, version FROM orders")).rows[0];
let o = await ord();
ok(o.paid_at === null, "pedido nasce sem pagamento");

// marcar pago NÃO muda updated_at
await new Promise(r => setTimeout(r, 30));
const before = o.updated_at.getTime();
await db.exec(`UPDATE orders SET paid_at = now(), paid_by = '${U}'`);
o = await ord();
ok(o.paid_at !== null, "marcou pago");
ok(o.updated_at.getTime() === before, "marcar pago preserva updated_at");
await new Promise(r => setTimeout(r, 30));
await db.exec(`UPDATE orders SET paid_at = NULL, paid_by = NULL`);
o = await ord();
ok(o.updated_at.getTime() === before, "desmarcar pago também preserva updated_at");

// editar o pedido muda updated_at (e a versão)
await new Promise(r => setTimeout(r, 30));
await db.query("SELECT submit_order($1,$2,$3::jsonb,1,$4)", [P, R, JSON.stringify([{product_id:id("b01"),quantity:1},{product_id:id("c01"),quantity:1},{product_id:id("c02"),quantity:1,note:"x"}]), "11111111-1111-1111-1111-111111111112"]);
o = await ord();
ok(o.updated_at.getTime() > before && o.version === 2, "editar o pedido atualiza updated_at");

// cancelar também conta como mudança
await new Promise(r => setTimeout(r, 30));
const b2 = o.updated_at.getTime();
await db.exec("UPDATE orders SET status = 'cancelled'");
o = await ord();
ok(o.updated_at.getTime() > b2, "cancelar atualiza updated_at");

// restrições de admin_settings
const ins = (k, t, n, c) => db.query("INSERT INTO admin_settings (admin_id,pix_key,pix_key_type,pix_name,pix_city) VALUES ($1,$2,$3,$4,$5)", [U, k, t, n, c]);
ok((await code(ins("123", "xxx", "NOME", "CIDADE"))).includes("admin_settings_pix_type"), "tipo de chave inválido é recusado");
ok((await code(ins("k", "cpf", null, "CIDADE"))).includes("admin_settings_pix_all_or_none"), "chave sem nome é recusada");
ok((await code(ins("k", "cpf", "N".repeat(26), "CIDADE"))).includes("admin_settings_pix_lengths"), "nome > 25 recusado");
ok((await code(ins("k", "cpf", "NOME", "C".repeat(16)))).includes("admin_settings_pix_lengths"), "cidade > 15 recusada");
ok((await code(ins("x".repeat(78), "email", "NOME", "CIDADE"))).includes("admin_settings_pix_lengths"), "chave > 77 recusada");
await ins("12345678909", "cpf", "FULANO", "SAO PAULO");
ok((await db.query("SELECT count(*)::int n FROM admin_settings")).rows[0].n === 1, "configuração válida entra");
await db.exec(`UPDATE admin_settings SET pix_key=NULL, pix_key_type=NULL, pix_name=NULL, pix_city=NULL`);
ok(true, "limpar a chave (tudo nulo) é permitido");

// rodada com dono; apagar o usuário não apaga a rodada
await db.exec(`UPDATE rounds SET created_by='${U}'`);
await db.exec(`DELETE FROM auth.users WHERE id='${U}'`);
ok((await db.query("SELECT created_by FROM rounds")).rows[0].created_by === null, "apagar o organizador mantém a rodada (dono vira nulo)");

// acesso: só service_role
for (const t of ["admin_settings", "pix_key_audit"]) {
  ok((await db.query("SELECT has_table_privilege('anon',$1,'select') a, has_table_privilege('authenticated',$1,'select') b, has_table_privilege('service_role',$1,'select') s", [t])).rows[0].a === false, `anon não lê ${t}`);
  const r = (await db.query("SELECT has_table_privilege('authenticated',$1,'select') b, has_table_privilege('service_role',$1,'select') s", [t])).rows[0];
  ok(r.b === false && r.s === true, `authenticated não lê ${t}; service_role lê`);
}
ok((await db.query("SELECT relrowsecurity r FROM pg_class WHERE relname='admin_settings'")).rows[0].r === true, "RLS ligada em admin_settings");
console.log(fail ? `\n${fail} FALHA(S)` : "\nTudo certo");
process.exit(fail ? 1 : 0);
