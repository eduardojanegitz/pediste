-- v3 · 8 · Rodada atual POR estabelecimento (C3b: participante em /e/<apelido>).
--
-- Aditiva. Mantém get_active_round() (estabelecimento Padrão) para o app antigo e cria
-- get_active_round_for(estabelecimento) para o participante de cada estabelecimento.
-- Só o servidor (service_role) executa.

CREATE OR REPLACE FUNCTION public.get_active_round_for(p_establishment uuid)
RETURNS TABLE (
  id uuid, name text, status text, opened_at timestamptz, closed_at timestamptz,
  opens_at timestamptz, closes_at timestamptz, state text, server_now timestamptz
) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.id, r.name, r.status, r.opened_at, r.closed_at, r.opens_at, r.closes_at,
         round_state(r), now()
    FROM rounds r
   WHERE r.status = 'open' AND r.establishment_id = p_establishment;
$$;

REVOKE ALL ON FUNCTION public.get_active_round_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_round_for(uuid) TO service_role;
