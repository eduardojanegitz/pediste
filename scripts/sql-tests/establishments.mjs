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

await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit int, allowed_mime_types text[]);`);
await db.exec(fs.readFileSync(path.join(root, "setup.sql"), "utf8"));

// Estado ANTES do C3: dados e administradores já existentes (o app antigo).
const files = fs.readdirSync(path.join(root, "migrations")).sort();
const last = files.findIndex((f) => f.startsWith("20261109000100"));
for (const f of files.slice(0, last)) await db.exec(fs.readFileSync(path.join(root, "migrations", f), "utf8"));
await db.exec(`
INSERT INTO auth.users (id) VALUES ('${id("a01")}'), ('${id("a02")}'), ('${id("a03")}');
INSERT INTO admins (user_id) VALUES ('${id("a01")}'), ('${id("a02")}');
INSERT INTO categories (id,name,position,min_select,max_select) VALUES ('${id("c01")}','Pratos',0,1,1);
INSERT INTO products (id,category_id,name) VALUES ('${id("b01")}','${id("c01")}','Frango');
INSERT INTO rounds (id,name) VALUES ('${id("f01")}','Almoço');
INSERT INTO participants (id,display_name,token_hash) VALUES ('${id("e01")}','João','h1');
`);

const mig = fs.readFileSync(path.join(root, "migrations", files[last]), "utf8");
await db.exec(mig);
await db.exec(mig); // idempotente
ok(true, "migração aplica duas vezes sem erro");

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const DEF = (await q("SELECT id FROM establishments WHERE is_default"))[0].id;

ok((await q("SELECT count(*)::int n FROM establishments"))[0].n === 1, "existe só o estabelecimento Padrão");
ok((await q("SELECT count(*)::int n FROM categories WHERE establishment_id = $1", [DEF]))[0].n === 1, "categorias antigas ficam no Padrão");
ok((await q("SELECT count(*)::int n FROM rounds WHERE establishment_id = $1", [DEF]))[0].n === 1, "rodadas antigas ficam no Padrão");
ok((await q("SELECT count(*)::int n FROM admins WHERE is_super")).at(0).n === 2, "administradores atuais viram super");
ok((await q("SELECT count(*)::int n FROM admin_establishments WHERE establishment_id = $1", [DEF]))[0].n === 2, "e são vinculados ao Padrão");

// Reaplicar não promove um admin criado depois.
await db.exec(`INSERT INTO admins (user_id) VALUES ('${id("a03")}')`);
await db.exec(mig);
ok((await q("SELECT is_super FROM admins WHERE user_id = $1", [id("a03")]))[0].is_super === false, "reaplicar não promove admin novo a super");
ok((await q("SELECT count(*)::int n FROM admin_establishments WHERE admin_id = $1", [id("a03")]))[0].n === 0, "nem o vincula sozinho");

// Compatibilidade com o app antigo: insere sem establishment_id.
await db.exec(`INSERT INTO categories (name,position) VALUES ('Antiga',9)`);
ok((await q("SELECT establishment_id FROM categories WHERE name='Antiga'"))[0].establishment_id === DEF, "inserção sem estabelecimento cai no Padrão");

// Slug e padrão único.
ok((await code(db.exec(`INSERT INTO establishments (name, slug) VALUES ('X','Com Espaço')`))) !== "OK", "slug inválido é recusado");
ok((await code(db.exec(`INSERT INTO establishments (name, slug, is_default) VALUES ('Outro','outro2',true)`))) !== "OK", "só um estabelecimento padrão");
await db.exec(`INSERT INTO establishments (id, name, slug) VALUES ('${id("e11")}','Padaria','padaria')`);
ok((await code(db.exec(`INSERT INTO establishments (name, slug) VALUES ('Dup','padaria')`))) !== "OK", "slug repetido é recusado");

// Uma rodada aberta POR estabelecimento.
await db.exec(`INSERT INTO rounds (id,name,establishment_id) VALUES ('${id("f02")}','Café','${id("e11")}')`);
ok(true, "outro estabelecimento pode ter rodada aberta ao mesmo tempo");
ok((await code(db.exec(`INSERT INTO rounds (name,establishment_id) VALUES ('Dup','${id("e11")}')`))) !== "OK", "mas não duas no mesmo estabelecimento");
ok((await code(db.exec(`INSERT INTO rounds (name) VALUES ('Dup2')`))) !== "OK", "nem no Padrão");

// get_active_round só devolve o Padrão (até o C3b).
const ar = await q("SELECT id FROM get_active_round()");
ok(ar.length === 1 && ar[0].id === id("f01"), "get_active_round devolve só a rodada do Padrão");

// C3b: rodada atual por estabelecimento (get_active_round_for).
const mig2 = fs.readFileSync(path.join(root, "migrations", files[last + 1]), "utf8");
await db.exec(mig2);
await db.exec(mig2); // idempotente
const forPad = await q("SELECT id FROM get_active_round_for($1)", [DEF]);
const forPad2 = await q("SELECT id, state FROM get_active_round_for($1)", [id("e11")]);
ok(forPad.length === 1 && forPad[0].id === id("f01"), "get_active_round_for(Padrão) devolve a rodada do Padrão");
ok(forPad2.length === 1 && forPad2[0].id === id("f02") && forPad2[0].state === "open", "get_active_round_for(Padaria) devolve a da Padaria");
ok((await q("SELECT id FROM get_active_round_for($1)", ["00000000-0000-0000-0000-0000000000ff"])).length === 0, "estabelecimento sem rodada: vazio");
await db.exec(`UPDATE rounds SET status = 'closed', closed_at = now() WHERE id = '${id("f02")}'`);
ok((await q("SELECT id FROM get_active_round_for($1)", [id("e11")])).length === 0, "rodada encerrada some só daquele estabelecimento");
ok((await q("SELECT id FROM get_active_round_for($1)", [DEF])).length === 1, "e a do Padrão continua");
await db.exec(`UPDATE rounds SET status = 'open', closed_at = NULL WHERE id = '${id("f02")}'`);
const gr = await q(`SELECT grantee FROM information_schema.routine_privileges WHERE routine_name = 'get_active_round_for' AND grantee IN ('anon','authenticated','PUBLIC')`);
ok(gr.length === 0, "anon/authenticated não executam get_active_round_for");

// C3c: achar usuário pelo e-mail.
const mig3 = fs.readFileSync(path.join(root, "migrations", files[last + 2]), "utf8");
await db.exec(mig3);
await db.exec(mig3); // idempotente
await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${id("a21")}', 'Maria@Exemplo.com')`);
ok((await q("SELECT find_user_id_by_email($1) AS u", ["maria@exemplo.com"]))[0].u === id("a21"), "acha por e-mail (maiúsculas não importam)");
ok((await q("SELECT find_user_id_by_email($1) AS u", ["  MARIA@exemplo.com "]))[0].u === id("a21"), "ignora espaços nas pontas");
ok((await q("SELECT find_user_id_by_email($1) AS u", ["outra@exemplo.com"]))[0].u === null, "e-mail desconhecido devolve vazio");
ok((await q("SELECT find_user_id_by_email($1) AS u", [""]))[0].u === null, "e-mail vazio devolve vazio");
const fg = await q(`SELECT grantee FROM information_schema.routine_privileges WHERE routine_name = 'find_user_id_by_email' AND grantee IN ('anon','authenticated','PUBLIC')`);
ok(fg.length === 0, "anon/authenticated não executam find_user_id_by_email");

// submit_order: escopo do estabelecimento.
await db.exec(`
INSERT INTO categories (id,name,position,min_select,max_select,establishment_id) VALUES ('${id("c11")}','Salgados',0,1,1,'${id("e11")}');
INSERT INTO products (id,category_id,name) VALUES ('${id("b11")}','${id("c11")}','Coxinha');
UPDATE categories SET min_select = 0 WHERE id <> '${id("c01")}' AND id <> '${id("c11")}';
`);
const P = id("e01");
const send = (round, pid, ver = 0, req = "11111111-1111-1111-1111-111111111111") =>
  db.query("SELECT submit_order($1,$2,$3::jsonb,$4,$5)", [P, round, JSON.stringify([{ product_id: pid, quantity: 1 }]), ver, req]);
ok((await code(send(id("f01"), id("b01")))) === "OK", "pedido no Padrão com produto do Padrão");
ok((await code(send(id("f02"), id("b11")))) === "OK", "pedido na Padaria com produto da Padaria (limites só da Padaria)");
ok((await code(send(id("f02"), id("b01"), 1, "22222222-2222-2222-2222-222222222222"))).includes("PRODUCT_UNAVAILABLE"), "produto de outro estabelecimento é recusado");
ok((await code(send(id("f01"), id("b11"), 1, "33333333-3333-3333-3333-333333333333"))).includes("PRODUCT_UNAVAILABLE"), "e o contrário também");

// Categoria obrigatória de OUTRO estabelecimento não trava o pedido (o bug que o escopo evita).
await db.exec(`UPDATE categories SET min_select = 1 WHERE id = '${id("c11")}'`);
ok((await code(send(id("f01"), id("b01"), 1, "44444444-4444-4444-4444-444444444444"))) === "OK", "mínimo da Padaria não afeta pedido do Padrão");

// Vínculo some junto com o estabelecimento ou o usuário.
await db.exec(`INSERT INTO admin_establishments (admin_id, establishment_id) VALUES ('${id("a03")}','${id("e11")}')`);
await db.exec(`DELETE FROM auth.users WHERE id = '${id("a03")}'`);
ok((await q("SELECT count(*)::int n FROM admin_establishments WHERE admin_id = $1", [id("a03")]))[0].n === 0, "apagar o usuário remove os vínculos");

// Segurança: tabelas novas não são acessíveis a anon/authenticated.
const grants = await q(`SELECT grantee, table_name FROM information_schema.role_table_grants
  WHERE table_name IN ('establishments','admin_establishments') AND grantee IN ('anon','authenticated')`);
ok(grants.length === 0, "anon/authenticated não têm acesso às tabelas novas");

console.log(fail ? `\n${fail} FALHA(S)` : "\nTudo certo");
process.exit(fail ? 1 : 0);
