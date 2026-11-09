-- Cria o PRIMEIRO administrador. Rode no SQL Editor do Supabase DEPOIS de:
--   1) aplicar as migrações de supabase/migrations/ (cria as tabelas public.admins e public.establishments);
--   2) criar o usuário em Authentication > Users > Add user (e-mail + senha, "Auto Confirm User" marcado).
-- Troque o e-mail abaixo pelo e-mail desse usuário. Não há outro caminho para virar admin.
-- O primeiro administrador é SUPER: cria estabelecimentos, vincula outros administradores e vê todos.

INSERT INTO public.admins (user_id, is_super)
SELECT id, true FROM auth.users WHERE email = 'troque-por-seu-email@exemplo.com'
ON CONFLICT (user_id) DO UPDATE SET is_super = true;

INSERT INTO public.admin_establishments (admin_id, establishment_id)
SELECT a.user_id, e.id FROM public.admins a CROSS JOIN public.establishments e
WHERE e.is_default AND a.user_id = (SELECT id FROM auth.users WHERE email = 'troque-por-seu-email@exemplo.com')
ON CONFLICT DO NOTHING;

-- Confira (deve listar 1 linha):
SELECT a.user_id, u.email, a.is_super FROM public.admins a JOIN auth.users u ON u.id = a.user_id;
