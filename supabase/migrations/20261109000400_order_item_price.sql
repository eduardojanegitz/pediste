-- v3 · 10 · Preço guardado em cada item do pedido (relatórios e Pix não mudam se o preço do produto mudar).
--
-- Aditiva. order_items.unit_price_cents = preço unitário, em centavos, no momento do pedido
-- (NULL = produto sem preço). Itens antigos recebem, UMA vez, o preço atual do produto (é o melhor
-- dado disponível); depois disso o preço de um pedido só muda quando o participante o edita.
-- submit_order: mesma assinatura e mesmas regras; só acrescenta a gravação do preço.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'unit_price_cents'
  ) THEN
    ALTER TABLE public.order_items ADD COLUMN unit_price_cents integer;
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_unit_price_range
      CHECK (unit_price_cents IS NULL OR unit_price_cents BETWEEN 0 AND 9999999);
    UPDATE public.order_items oi
       SET unit_price_cents = pr.price_cents
      FROM public.products pr
     WHERE pr.id = oi.product_id;
  END IF;
END $$;

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
  -- Guarda o preço de cada item NO MOMENTO do pedido: mudar o preço do produto depois não altera
  -- pedidos já feitos (Pix, relatórios e comanda). Editar o pedido grava os preços da hora da edição.
  INSERT INTO order_items (order_id, product_id, quantity, note, unit_price_cents)
  SELECT v_order.id, x.pid, x.qty, x.note, pr.price_cents
    FROM jsonb_to_recordset(v_items) AS x(pid uuid, qty integer, note text)
    JOIN products pr ON pr.id = x.pid;

  UPDATE orders
     SET status = 'confirmed', version = version + 1, last_request_id = p_request_id
   WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('order_id', v_order.id, 'version', v_order.version, 'status', v_order.status, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_order(uuid, uuid, jsonb, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order(uuid, uuid, jsonb, integer, uuid) TO service_role;
