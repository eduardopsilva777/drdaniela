# Integração com o WhatsApp Business

Código: [`src/server/whatsapp/`](../src/server/whatsapp), [`src/server/services/whatsapp.ts`](../src/server/services/whatsapp.ts), [`src/app/api/webhooks/whatsapp/route.ts`](../src/app/api/webhooks/whatsapp/route.ts). Testes: [`tests/unit/whatsapp-integration.test.ts`](../tests/unit/whatsapp-integration.test.ts), [`tests/integration/whatsapp.test.ts`](../tests/integration/whatsapp.test.ts), [`tests/integration/routes.test.ts`](../tests/integration/routes.test.ts).

## Situação atual

| Parte | Situação |
| --- | --- |
| Interface de provedor, registro de conversas e mensagens, vínculo com leads/pacientes | Pronta e testada |
| Adaptador de **desenvolvimento** (simulação claramente identificada) | Pronto e testado |
| Adaptador da **Cloud API** (envio de texto e de modelos, tradução de erros, tempo limite) | Pronto e testado contra respostas simuladas da API — **nunca executado contra a Meta** |
| Webhook (verificação, assinatura, mensagens recebidas, status, idempotência) | Pronto e testado |
| Credenciais, número verificado e modelos aprovados | **Faltam** (dependem da conta da clínica na Meta) |

O sistema **nunca finge** que uma mensagem foi enviada pela API oficial: no modo de desenvolvimento, toda mensagem é gravada com status `SIMULATED` e a interface mostra “Modo de desenvolvimento — nada é enviado aos contatos”.

## Arquitetura

```
Tela de conversas / fila de lembretes
        │  (Server Actions com permissão)
        ▼
services/whatsapp.ts ── regras: janela de 24h, registro da mensagem, auditoria
        │
        ▼
WhatsAppProvider (interface)         ← escolhido por WHATSAPP_PROVIDER
  ├─ DevelopmentWhatsAppProvider     nada sai do servidor; status SIMULATED
  └─ CloudApiWhatsAppProvider        POST graph.facebook.com/{versão}/{phone-number-id}/messages
        ▲
Meta ──► /api/webhooks/whatsapp ── assinatura → deduplicação → mensagens recebidas / status
```

- `WHATSAPP_PROVIDER=disabled` (padrão em produção): nenhum envio; a tela de conversas funciona para leitura e os lembretes ficam pendentes.
- `development` (padrão fora de produção, **proibido em produção** pela validação do ambiente).
- `cloud_api`: exige `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` e `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — o servidor não sobe sem elas.

## Regras do WhatsApp aplicadas

- **Janela de 24 horas:** mensagens livres só até 24 h depois da última mensagem do contato. Fora dela, o envio é bloqueado com explicação; só **modelos aprovados** (usados pelos lembretes) podem ser enviados.
- **Consentimento:** lembretes só para quem autorizou. Respostas a quem escreveu para a clínica são permitidas dentro da janela.
- Status de entrega e leitura só avançam (enviada → entregue → lida); “falhou” não sobrescreve entregue/lida; eventos atrasados são ignorados.

## Webhook

`GET /api/webhooks/whatsapp` — verificação do endpoint pela Meta: responde `hub.challenge` quando `hub.verify_token` confere (comparação em tempo constante).

`POST /api/webhooks/whatsapp`:

1. Recusa corpo acima de 1 MB.
2. Valida `X-Hub-Signature-256` (HMAC-SHA256 do **corpo bruto** com `WHATSAPP_APP_SECRET`, comparação em tempo constante) — assinatura inválida: 401, nada é processado.
3. Valida o formato (Zod). Formato desconhecido com assinatura válida: confirma (200) e ignora, para a Meta não reenviar indefinidamente.
4. Cada evento recebe uma chave (`msg:<id>` ou `status:<id>:<status>`) registrada em `webhook_events` **sem o payload**. Reentregas já processadas são ignoradas; eventos que falharam são reprocessados na próxima entrega (o processamento é idempotente).
5. Mensagens recebidas criam/atualizam a conversa do telefone (vinculada ao paciente e/ou lead com o mesmo número) e incrementam “não lidas”. Mídias não são baixadas: ficam registradas como “[tipo] conteúdo não exibido”.

O `proxy.ts` deixa `/api/webhooks/` passar sem sessão — a assinatura é a autenticação.

## Logs e segurança

- O token de acesso nunca é registrado; erros da API são traduzidos em mensagens seguras (`classifyCloudApiError`) e os logs contêm só o status HTTP e o código.
- Conteúdo de mensagens não vai para logs. Erros gravados no banco passam por máscara de telefones, e-mails e CPFs.
- Envios manuais são auditados (`whatsapp.message.send`, com a marca de simulação quando for o caso).

## Como ativar a API oficial (passo a passo)

1. Na Meta for Developers, crie um app do tipo *Business* e adicione o produto **WhatsApp**; vincule a conta do WhatsApp Business da clínica e registre/verifique o número.
2. Gere um **token de acesso permanente** de um usuário de sistema com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
3. Crie e aguarde a aprovação de **dois modelos** (categoria *Utility*, idioma `pt_BR`) com parâmetros de corpo na ordem usada pelo sistema:
   - lembrete de agendamento: `{{1}}` nome, `{{2}}` data, `{{3}}` horário, `{{4}}` procedimento;
   - lembrete de retorno: `{{1}}` nome, `{{2}}` procedimento, `{{3}}` data prevista.
4. Configure as variáveis: `WHATSAPP_PROVIDER=cloud_api`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` (segredo do app), `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (valor aleatório escolhido por você), `WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER`, `WHATSAPP_TEMPLATE_RETURN_REMINDER`.
5. No painel da Meta, configure o webhook com a URL `https://<seu-domínio>/api/webhooks/whatsapp` e o mesmo token de verificação; assine o campo **messages**.
6. **Homologue em um banco separado e limpo** — nunca no banco de desenvolvimento com o seed: os telefones fictícios têm formato válido e podem pertencer a pessoas reais (por isso o seed se recusa a rodar com `cloud_api`). Cadastre só números da própria equipe, com consentimento. Envie uma mensagem para o número da clínica (abre a janela de 24h), responda pelo CRM e confira status de entrega/leitura. Depois, processe um lembrete de teste.
7. Agende o processamento da fila (`POST /api/jobs/reminders` com `CRON_SECRET`).

Até concluir esses passos, mantenha `WHATSAPP_PROVIDER=disabled` em produção.
