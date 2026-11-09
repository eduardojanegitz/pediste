# PedeAí!

Cardápio digital interativo (TanStack Start + React + Tailwind + Motion) com banco, login do admin e fotos no Supabase (hoje via Lovable Cloud).

## Como funciona

- `/` — o participante informa nome e celular, escolhe itens **uma categoria por etapa** (cada categoria tem mínimo e máximo), revisa e confirma. Vê a animação de conclusão só depois de o servidor confirmar. Pode editar ou cancelar até a rodada encerrar.
- Cada item escolhido aceita uma **observação** de até 140 caracteres (ex.: "sem cebola"), que aparece na revisão, no painel, nas exportações e na comanda.
- No painel (Pedidos), **alerta sonoro**: som diferente para pedido novo, editado e cancelado, com volume e teste. O painel consulta a rodada a cada 5 s, mesmo com a aba em segundo plano, destaca os pedidos novos e mostra a contagem no título da aba. O navegador só libera o som depois de um clique (botão "Ativar alertas sonoros") e volta a bloquear ao recarregar a página. Sem a aba aberta não há alerta.
- **Imprimir comanda** (Pedidos): modelo consolidado para o estabelecimento (totais por categoria e produto, com observações) ou uma por pessoa. Papéis: térmica 80 mm, térmica 58 mm ou A4. Mostra uma prévia igual ao papel, não inclui celular nem valores a menos que você marque, e avisa quando pedidos mudam depois da última impressão (com atalho para imprimir só os alterados). Usa a impressão do navegador, sem driver especial.
- **Compartilhar a rodada** (Rodadas e Pedidos): link do site, **QR Code** (baixar PNG ou imprimir cartaz A4) e mensagem pronta de WhatsApp com o prazo, editável, com botão "Abrir no WhatsApp". O endereço vem do que está aberto no navegador; se o painel e o site público tiverem endereços diferentes, ajuste na janela (fica salvo no navegador). O QR é gerado no próprio app, sem biblioteca externa.
- **Pedir o de sempre**: quem já pediu em outra rodada vê, no início do pedido, uma faixa para repetir o último pedido em um toque. O pedido é montado com o cardápio de hoje (o que saiu do ar ou passou do limite é avisado) e abre direto na revisão, para conferir antes de confirmar.
- **Pix e controle de pagamento**: cada organizador cadastra a própria chave Pix na aba **Ajustes** (CPF, CNPJ, e-mail, celular ou chave aleatória, com nome e cidade do recebedor; há um teste de R$ 1,00 para conferir no banco). Quem abriu a rodada recebe: o participante, na própria mensagem de confirmação do pedido ("Último passo: pagar por Pix") e depois na tela do pedido, vê o valor, o QR Code e o código "copia e cola" já com o valor; a confirmação de uma atualização de pedido não fecha sozinha enquanto houver Pix a pagar. O organizador marca "pago" na aba Pedidos (há filtro de pagamento e totais de recebido e a receber). O app **não confirma o pagamento sozinho**; itens sem preço não são cobrados; a chave só aparece inteira para quem tem pedido confirmado e toda troca de chave fica registrada (mascarada). Rodadas abertas antes desta versão (sem dono) usam o único organizador com Pix configurado.
- **Link do estabelecimento** (Pedidos): página só de leitura, sem login, em `/comanda/<token>`, com os pedidos ao vivo (atualiza a cada 8 s), totais por produto, visão por pessoa, alerta sonoro e botão de imprimir a comanda (80 mm, 58 mm ou A4). O token é aleatório (256 bits) e só o hash fica no banco; o link aparece inteiro uma única vez ao ser gerado, vale por 6 h, 24 h ou 3 dias e pode ser revogado. Mostra só nome curto ("João P."), itens e observações: nunca celular, valores ou pagamentos. Quem prepara marca cada pedido como **concluído** (com contador, filtro "só pendentes" e aviso se o pedido mudar depois de concluído); o painel do organizador mostra os concluídos. Quem tem o link só consegue ler a comanda e marcar concluído. A página não é indexada e não vaza o endereço por Referer.
- **Participante por estabelecimento (parte 2)**: o estabelecimento padrão continua em `/` (links e QR Codes já impressos seguem valendo) e os demais abrem em `/e/<apelido>`, cada um com o próprio cardápio e a própria rodada aberta, ao mesmo tempo. Apelido inexistente mostra "Estabelecimento não encontrado". O cadastro do participante (nome e celular) é o mesmo em todos, e o "pedir o de sempre" considera só pedidos do mesmo estabelecimento. O botão **Compartilhar** (link, QR Code, cartaz, WhatsApp) e o lembrete de "quem ainda não pediu" já usam o endereço do estabelecimento escolhido no painel. Exige a migração `20261109000200_active_round_by_establishment.sql`.
- **Vários estabelecimentos e administradores (parte 1)**: cada estabelecimento tem o próprio cardápio e as próprias rodadas, com **uma rodada aberta por estabelecimento**. No painel há um seletor de estabelecimento (aparece com mais de um); Cardápio, Rodadas, Pedidos, Relatórios e o link do estabelecimento mostram só o escolhido. Cada administrador só acessa os estabelecimentos em que está vinculado; o super administrador vê todos. A conferência é feita no servidor em toda função do painel, e o banco recusa pedido com produto de outro estabelecimento. O que existia antes ficou no estabelecimento **Padrão**. Por enquanto estabelecimentos e vínculos são criados por SQL (veja `docs/ADMIN.md`) e o participante só enxerga o Padrão; a tela de gestão e o endereço `/e/<apelido>` do participante vêm nos próximos blocos.
- **Relatórios** (`/admin/reports`): escolha um período (este mês, mês passado, últimos 30 dias ou datas livres, em horário de Brasília) e veja total, recebido, a receber e ticket médio, o gasto **por pessoa** (quem deve mais primeiro) e **por rodada**. O botão **Cobrar** abre o seu WhatsApp com a mensagem pronta e o valor em aberto (o app não envia nada sozinho). Exporta PDF e Excel. Conta só pedidos confirmados, pela data do pedido. **Os valores usam os preços atuais dos produtos** (o app não guarda o preço de cada pedido): se um preço mudar, o relatório de períodos antigos muda junto. Itens sem preço não entram. Limite de 5000 pedidos por consulta e período de até 13 meses.
- **Copiar rodada anterior** (Rodadas → Abrir nova rodada): escolha uma rodada antiga e o formulário vem preenchido com o nome e os horários dela, trazidos para hoje (ou para amanhã, se o horário de hoje já passou), com a mesma hora do dia e a mesma duração. Você confere e abre. O cardápio não pertence à rodada (é o mesmo de sempre), então só nome e horários são copiados.
- **Quem ainda não pediu** (Pedidos, com a rodada aberta): lista as pessoas com celular que já pediram em rodadas anteriores e não têm pedido confirmado nesta (pedido cancelado conta como "não pediu"), com a contagem regressiva do encerramento (pelo relógio do servidor). O botão **Lembrar** abre o seu WhatsApp com a mensagem pronta (primeiro nome, rodada, link e prazo; editável); "Lembrar o próximo" percorre a lista uma pessoa por vez. O app **não envia nada sozinho**. O celular só é lido pelo painel do administrador.
- **Status do pedido e aviso no celular**: na tela do pedido confirmado o participante vê **Recebido → Em preparo → Pronto** (atualiza a cada 8 s). "Em preparo" aparece quando a rodada encerra; "Pronto" quando o estabelecimento marca o pedido como concluído na comanda ao vivo (com a página aberta toca um som, vibra e muda o título da aba). O botão **Avisar no celular quando ficar pronto** ativa notificação push, que chega com o navegador fechado. É preciso configurar as chaves VAPID no servidor (veja Desenvolvimento) e aplicar a migração `20261107000100_push_subscriptions.sql`; sem as chaves o botão não aparece. O push é enviado **sem conteúdo** (o texto é fixo no service worker), então nenhum dado pessoal passa pelo serviço de push. No iPhone só funciona com o app instalado na tela inicial (Compartilhar → Adicionar à Tela de Início).
- Em outro aparelho, o participante recupera o pedido com o **código de recuperação** (mostrado uma vez). Celular sozinho não prova identidade.
- `/admin` (login por e-mail e senha, só administradores) — **Cardápio** (categorias com regras, produtos, preço, disponibilidade, ordem), **Rodadas** (abertura/encerramento em horário de Brasília, reabrir) e **Pedidos** (filtros, visão consolidada, editados, PDF, Excel, texto para WhatsApp, redefinir código).

## Desenvolvimento

```sh
npm i
npm run dev      # precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (servidor)
npm run build
npm test
```

Variável opcional no servidor: `RECOVERY_PEPPER` (texto longo e aleatório) reforça o hash dos códigos de recuperação; sem ela usa a `SUPABASE_SERVICE_ROLE_KEY` (trocar essa chave invalida os códigos já emitidos).

Notificações push: gere as chaves com `node scripts/gen-vapid.mjs` e defina no servidor `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (segredo) e `VAPID_SUBJECT` (`mailto:seu-email`). Sem elas o recurso fica desligado.

O `.env` não é versionado. A `SUPABASE_SERVICE_ROLE_KEY` é injetada pelo Lovable Cloud na publicação e **nunca** vai para o navegador.

## Banco de dados

- `supabase/setup.sql` — estrutura-base para um projeto Supabase novo.
- `supabase/migrations/` — alterações incrementais, em ordem de nome. Todas são aditivas (não apagam dados). **Rode-as manualmente no SQL Editor, na ordem**. Nenhuma é aplicada automaticamente.
- `scripts/sql-tests/` — testa o `setup.sql` e todas as migrações em um Postgres local (PGlite); veja o README da pasta.
- `supabase/first-admin.sql` e `docs/ADMIN.md` — como criar o primeiro administrador (desative o cadastro público antes).
- `src/integrations/supabase/types.ts` foi ajustado à mão para as migrações; o Lovable pode regenerá-lo.

## Segurança

- O navegador só lê categorias, produtos e rodadas (RLS de SELECT público). Participantes, pedidos e itens só passam por funções de servidor com a chave de serviço.
- Toda função de admin exige sessão válida **e** linha em `public.admins`; o redirecionamento no navegador é só conveniência.
- Regras do pedido (rodada aberta, produto disponível, mínimo/máximo, versão, repetição de envio) são validadas no banco, em uma única transação (`submit_order`).
- Recuperação: código de 10 caracteres guardado só como HMAC; 5 tentativas erradas bloqueiam por 15 min; a resposta é igual para celular desconhecido, código errado e bloqueio. Limite de requisições por IP (o IP é guardado só como hash).
- Dados pessoais (nome e celular) são visíveis apenas ao administrador e não vão nas exportações. Há implicações de LGPD: informe os participantes e apague os dados quando não forem mais necessários.

## Limitações conhecidas

- Um aparelho ativo por participante: recuperar o pedido em outro aparelho desconecta o anterior.
- Quem perde o código e não está mais logado precisa pedir ao administrador a redefinição.
- Cancelar um pedido não incrementa a versão dele.
- A animação foi testada em navegador de computador; falta testar em celular real de entrada.
- O efeito cinematográfico "produto escolhido voa para o resumo" não foi feito (existe só o efeito simples).
- Aviso push: não testado em aparelho real (Android/iPhone) nem com os serviços de push de verdade; o iPhone exige o app instalado. Os ícones PNG da tela inicial (`public/icons/`) foram gerados a partir do `favicon.svg`.
- Horário sempre de Brasília (UTC-3 fixo, sem horário de verão desde 2019).
- Produtos sem categoria não aparecem no cardápio até serem atribuídos.
- Fotos exigem URL assinada (bucket privado), gerada pelo servidor.

## Publicação e planos gratuitos

Publique pelo botão Publish do Lovable (HTTPS em `*.lovable.app`). Limites conferidos em 04/11/2026 (confirme nas páginas oficiais antes de um evento):

- **Supabase (grátis):** 500 MB de banco por projeto, 1 GB de arquivos, 50 mil usuários ativos/mês no Auth. **O projeto é pausado após cerca de 1 semana sem uso** (dados preservados; restaure no painel). Para uso semanal, abra o app antes do evento ou use plano pago.
- **Cloudflare Workers (grátis), se hospedar fora do Lovable:** 100 mil requisições/dia, **10 ms de CPU por requisição** (espera por rede/banco não conta), 128 MB de memória. A renderização no servidor deste app pode se aproximar do limite de CPU: teste antes de depender do plano grátis. O build gera um worker via Nitro (`npx nitro deploy --prebuilt`).
- Volume típico (dezenas de pessoas) fica muito abaixo desses limites.
