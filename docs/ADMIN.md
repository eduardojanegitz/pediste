# Acesso do administrador

Só administradores fazem login (`/admin/login`). Participantes do cardápio não têm conta.

## Criar o primeiro administrador (uma vez)

1. Aplique as migrações de `supabase/migrations/` (cria `public.admins`).
2. No painel do Supabase: **Authentication → Sign In / Providers → Email** e **desligue "Allow new users to sign up"**.
   Assim ninguém consegue se cadastrar por conta própria (a API pública de cadastro passa a recusar).
3. **Authentication → Users → Add user → Create new user**: informe e-mail e uma senha forte e marque **Auto Confirm User**.
4. Edite o e-mail em `supabase/first-admin.sql` e rode o arquivo no **SQL Editor**.
5. Entre em `/admin/login`.

## Como a proteção funciona

- Toda função de servidor do painel (produtos, categorias, rodadas, pedidos, upload de fotos) passa por `requireAdmin` (`src/lib/admin-middleware.ts`):
  valida o JWT do Supabase e confere se o usuário está em `public.admins`. Sem isso, a chamada é recusada no servidor, mesmo que alguém chame a função direto.
- O redirecionamento para o login no navegador é só conforto; não é a barreira de segurança.
- A `SUPABASE_SERVICE_ROLE_KEY` fica apenas no servidor.
- A tabela `admins` não tem política de acesso: só o servidor lê e escreve.

## Adicionar ou remover um admin depois

Crie o usuário em Authentication e inclua o `id` dele em `public.admins` (ou apague a linha para remover o acesso; a sessão dele deixa de valer no servidor imediatamente).

## Estabelecimentos e quem acessa o quê

Cada estabelecimento tem o seu cardápio e as suas rodadas (a migração `20261109000100_establishments.sql` cria o estabelecimento **Padrão** e põe nele tudo que já existia).

- **Super administrador** (`admins.is_super = true`): vê todos os estabelecimentos. Quem já era administrador antes da migração virou super.
- **Administrador comum**: só vê os estabelecimentos em que está vinculado (`public.admin_establishments`).
- A conferência é feita no servidor em toda função do painel; esconder o seletor no navegador não é a proteção.

**Pela tela (recomendado):** o super administrador vê a aba **Estabelecimentos**. Nela ele cria estabelecimentos (nome e apelido do endereço), renomeia (o apelido não muda, porque os links compartilhados dependem dele) e libera ou remove administradores pelo e-mail.

- A conta do administrador precisa **já existir** no Supabase (Authentication > Users). O app não cria contas nem guarda senhas.
- Quem ainda não era administrador passa a ser administrador **comum** (só vê os estabelecimentos liberados). Quem já era mantém o papel. Virar super continua sendo feito pelo SQL (`UPDATE public.admins SET is_super = true WHERE user_id = ...`).
- Remover o acesso não apaga a conta nem os dados do estabelecimento.
- Exige a migração `20261109000300_find_user_by_email.sql`.

**Pelo SQL Editor** (alternativa, ou se a tela não estiver disponível):

```sql
-- novo estabelecimento
INSERT INTO public.establishments (name, slug) VALUES ('Padaria do Zé', 'padaria-do-ze');

-- liberar um administrador (use o e-mail dele)
INSERT INTO public.admins (user_id)
SELECT id FROM auth.users WHERE email = 'pessoa@exemplo.com' ON CONFLICT DO NOTHING;
INSERT INTO public.admin_establishments (admin_id, establishment_id)
SELECT u.id, e.id FROM auth.users u, public.establishments e
WHERE u.email = 'pessoa@exemplo.com' AND e.slug = 'padaria-do-ze' ON CONFLICT DO NOTHING;
```

O participante abre o estabelecimento **Padrão** em `/` e os demais em `/e/<apelido>` (o apelido é o `slug` do estabelecimento).
