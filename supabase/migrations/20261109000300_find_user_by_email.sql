-- v3 · 9 · Achar o usuário do Supabase pelo e-mail (C3c: vincular administradores pela tela).
--
-- Aditiva. Só o servidor (service_role) executa. Devolve apenas o id (nunca senha nem dados do usuário);
-- a comparação ignora maiúsculas/minúsculas e espaços nas pontas. O usuário continua sendo criado
-- em Authentication > Users (o app não cria contas nem guarda senhas).

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM auth.users
   WHERE lower(email) = lower(btrim(p_email))
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO service_role;
