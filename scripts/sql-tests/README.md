# Testes das migrações SQL

Aplicam `supabase/setup.sql` e todas as migrações em um Postgres local (PGlite, sem Docker nem banco real)
e conferem as regras: limites do pedido, observações, Pix, links do estabelecimento, concluído.

```sh
cd scripts/sql-tests
npm install
npm test
```

Ficam fora do `package.json` da raiz de propósito (para não mexer no `bun.lock` do app). Cada arquivo
imprime `PASS`/`FAIL` e termina com erro se algo falhar. Ao criar uma migração nova, acrescente um teste.
