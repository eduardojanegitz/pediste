-- v3 · 7 · Vários estabelecimentos e vários administradores (C3a: modelo de dados).
--
-- Aditiva: nada é apagado. Tudo que existe hoje passa a pertencer ao estabelecimento "Padrão".
--   * establishments: cada estabelecimento tem o seu cardápio e as suas rodadas;
--   * admin_establishments: quais administradores cuidam de quais estabelecimentos;
--   * admins.is_super: super administrador (cria estabelecimentos, vincula pessoas e vê todos);
--     os administradores que já existem viram super;
--   * categories/rounds.establishment_id: o padrão é o estabelecimento "Padrão", então o app antigo
--     (sem saber de estabelecimentos) continua gravando certo;
--   * "uma rodada aberta" passa a valer POR estabelecimento;
--   * submit_order só aceita produtos do estabelecimento da rodada e só confere os limites das categorias dele.
-- Só o servidor (service_role) acessa as tabelas novas; sem policies.

CREATE TABLE IF NOT EXISTS public.establishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT establishments_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT establishments_slug_fmt CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 40)
);
-- No máximo um estabelecimento padrão.
CREATE UNIQUE INDEX IF NOT EXISTS establishments_single_default
  ON public.establishments ((true)) WHERE is_default;

ALTER TABLE public.establishments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.establishments FROM anon, authenticated;
GRANT ALL ON public.establishments TO service_role;

INSERT INTO public.establishments (name, slug, is_default)
SELECT 'Padrão', 'padrao', true
WHERE NOT EXISTS (SELECT 1 FROM public.establishments WHERE is_default);

CREATE OR REPLACE FUNCTION public.default_establishment_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM establishments WHERE is_default
$$;

-- Administradores: super (vê e gerencia tudo) e vínculos com estabelecimentos.
CREATE TABLE IF NOT EXISTS public.admin_establishments (
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, establishment_id)
);
ALTER TABLE public.admin_establishments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_establishments FROM anon, authenticated;
GRANT ALL ON public.admin_establishments TO service_role;

-- A promoção dos administradores atuais e o vínculo inicial rodam SÓ na primeira vez (quando a coluna
-- ainda não existe). Se esta migração for reaplicada, nenhum administrador novo vira super por engano.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'is_super'
  ) THEN
    ALTER TABLE public.admins ADD COLUMN is_super boolean NOT NULL DEFAULT false;
    UPDATE public.admins SET is_super = true;
    INSERT INTO public.admin_establishments (admin_id, establishment_id)
    SELECT a.user_id, public.default_establishment_id() FROM public.admins a
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Cardápio e rodadas passam a ter dono. O DEFAULT mantém o app antigo funcionando.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS establishment_id uuid NOT NULL
    DEFAULT public.default_establishment_id() REFERENCES public.establishments(id);
ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS establishment_id uuid NOT NULL
    DEFAULT public.default_establishment_id() REFERENCES public.establishments(id);

CREATE INDEX IF NOT EXISTS categories_establishment_idx ON public.categories (establishment_id, position);
CREATE INDEX IF NOT EXISTS rounds_establishment_idx ON public.rounds (establishment_id, opened_at DESC);

-- Uma rodada aberta por estabelecimento (antes: uma no sistema inteiro).
DROP INDEX IF EXISTS public.rounds_single_open;
CREATE UNIQUE INDEX IF NOT EXISTS rounds_single_open_per_establishment
  ON public.rounds (establishment_id) WHERE status = 'open';

-- Rodada atual enxerga só o estabelecimento padrão até o C3b (participante por estabelecimento).
CREATE OR REPLACE FUNCTION public.get_active_round()
RETURNS TABLE (
  id uuid, name text, status text, opened_at timestamptz, closed_at timestamptz,
  opens_at timestamptz, closes_at timestamptz, state text, server_now timestamptz
) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT r.id, r.name, r.status, r.opened_at, r.closed_at, r.opens_at, r.closes_at,
         round_state(r), now()
    FROM rounds r
   WHERE r.status = 'open' AND r.establishment_id = default_establishment_id();
$$;

-- submit_order: mesma assinatura e mesmas regras; acrescenta o escopo do estabelecimento da rodada.
CREATE OR REPLACE FUNCTION public.submit_order(
  p_participant uuid,
  p_round uuid,
  p_items jsonb,
  p_expected_version integer,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_round public.rounds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_items jsonb;
  v_bad text;
  v_cat record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM participants WHERE id = p_participant) THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND';
  END IF;

  SELECT * INTO v_order FROM orders
   WHERE round_id = p_round AND participant_id = p_participant AND last_request_id = p_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'version', v_order.version, 'status', v_order.status, 'replayed', true);
  END IF;

  SELECT * INTO v_round FROM rounds WHERE id = p_round FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  CASE round_state(v_round)
    WHEN 'waiting' THEN RAISE EXCEPTION 'ROUND_NOT_STARTED';
    WHEN 'closed' THEN RAISE EXCEPTION 'ROUND_CLOSED';
    ELSE NULL;
  END CASE;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'INVALID_ITEMS';
  END IF;
  BEGIN
    SELECT coalesce(jsonb_agg(jsonb_build_object('pid', pid, 'qty', qty, 'note', note)), '[]'::jsonb)
      INTO v_items
      FROM (
        SELECT (e->>'product_id')::uuid AS pid,
               sum((e->>'quantity')::integer) AS qty,
               min(nullif(btrim(regexp_replace(regexp_replace(coalesce(e->>'note', ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '')) AS note
          FROM jsonb_array_elements(p_items) e
         GROUP BY 1
      ) s;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'INVALID_ITEMS';
  END;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_items) AS x(pid uuid, qty integer, note text)
              WHERE x.qty NOT BETWEEN 1 AND 99 OR char_length(coalesce(x.note, '')) > 140) THEN
    RAISE EXCEPTION 'INVALID_ITEMS';
  END IF;

  -- Produto inexistente, inativo, sem categoria, em categoria inativa ou de OUTRO estabelecimento.
  SELECT coalesce(min(coalesce(pr.name, x.pid::text)), NULL) INTO v_bad
    FROM jsonb_to_recordset(v_items) AS x(pid uuid, qty integer)
    LEFT JOIN products pr ON pr.id = x.pid
    LEFT JOIN categories c ON c.id = pr.category_id
   WHERE pr.id IS NULL OR NOT pr.is_active OR c.id IS NULL OR NOT c.is_active
      OR c.establishment_id <> v_round.establishment_id;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING DETAIL = v_bad;
  END IF;

  SELECT min(c.name) INTO v_bad
    FROM jsonb_to_recordset(v_items) AS x(pid uuid, qty integer)
    JOIN products pr ON pr.id = x.pid
    JOIN categories c ON c.id = pr.category_id
   WHERE x.qty > 1 AND NOT c.allow_quantity;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'QUANTITY_NOT_ALLOWED' USING DETAIL = v_bad;
  END IF;

  -- Mínimo/máximo só das categorias ativas DESTE estabelecimento.
  FOR v_cat IN
    SELECT c.name, c.min_select, c.max_select,
           (SELECT count(*) FROM jsonb_to_recordset(v_items) AS x(pid uuid, qty integer)
              JOIN products pr ON pr.id = x.pid
             WHERE pr.category_id = c.id) AS picked
      FROM categories c
     WHERE c.is_active AND c.establishment_id = v_round.establishment_id
     ORDER BY c.position, c.created_at
  LOOP
    IF v_cat.picked < v_cat.min_select THEN
      RAISE EXCEPTION 'CATEGORY_MIN' USING DETAIL = v_cat.name;
    ELSIF v_cat.picked > v_cat.max_select THEN
      RAISE EXCEPTION 'CATEGORY_MAX' USING DETAIL = v_cat.name;
    END IF;
  END LOOP;

  INSERT INTO orders (round_id, participant_id, status, version)
  VALUES (p_round, p_participant, 'confirmed', 0)
  ON CONFLICT (round_id, participant_id) DO NOTHING;

  SELECT * INTO v_order FROM orders
   WHERE round_id = p_round AND participant_id = p_participant FOR UPDATE;

  IF v_order.last_request_id IS NOT DISTINCT FROM p_request_id AND v_order.version > 0 THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'version', v_order.version, 'status', v_order.status, 'replayed', true);
  END IF;

  IF v_order.version <> coalesce(p_expected_version, -1) THEN
    RAISE EXCEPTION 'VERSION_CONFLICT';
  END IF;

  DELETE FROM order_items WHERE order_id = v_order.id;
  INSERT INTO order_items (order_id, product_id, quantity, note)
  SELECT v_order.id, x.pid, x.qty, x.note
    FROM jsonb_to_recordset(v_items) AS x(pid uuid, qty integer, note text);

  UPDATE orders
     SET status = 'confirmed', version = version + 1, last_request_id = p_request_id
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('order_id', v_order.id, 'version', v_order.version, 'status', v_order.status, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_order(uuid, uuid, jsonb, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order(uuid, uuid, jsonb, integer, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_active_round() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_round() TO service_role;
REVOKE ALL ON FUNCTION public.default_establishment_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.default_establishment_id() TO service_role;
