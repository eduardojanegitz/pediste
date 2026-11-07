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
const R = "00000000-0000-0000-0000-0000000000f1";
const H = (c) => c.repeat(64);
const ins = (hash, exp = "now() + interval '1 day'") => db.query(`INSERT INTO board_links (round_id, token_hash, expires_at) VALUES ($1, $2, ${exp})`, [R, hash]);
await ins(H("a"));
ok((await db.query("SELECT count(*)::int n FROM board_links")).rows[0].n === 1, "link válido entra");
ok((await code(ins(H("a")))).includes("board_links_token_hash_key"), "hash repetido é recusado (único)");
ok((await code(ins("curto"))).includes("board_links_token_hash_len"), "hash que não tem 64 caracteres é recusado");
ok((await code(ins(H("b"), "now() - interval '1 hour'"))).includes("board_links_expiry"), "prazo no passado é recusado");
await db.exec(`UPDATE board_links SET revoked_at = now()`);
ok((await db.query("SELECT revoked_at FROM board_links")).rows[0].revoked_at !== null, "revogar grava o instante");
await ins(H("c"));
await db.exec(`DELETE FROM rounds WHERE id='${R}'`);
ok((await db.query("SELECT count(*)::int n FROM board_links")).rows[0].n === 0, "apagar a rodada apaga os links (cascata)");
const r = (await db.query("SELECT has_table_privilege('anon','board_links','select') a, has_table_privilege('authenticated','board_links','select') b, has_table_privilege('service_role','board_links','select') s")).rows[0];
ok(r.a === false && r.b === false && r.s === true, "só service_role acessa board_links");
ok((await db.query("SELECT relrowsecurity r FROM pg_class WHERE relname='board_links'")).rows[0].r === true, "RLS ligada em board_links");
console.log(fail ? `\n${fail} FALHA(S)` : "\nTudo certo");
process.exit(fail ? 1 : 0);
