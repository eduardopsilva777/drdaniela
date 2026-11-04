# Operação em produção

Guia para colocar e manter o CRM em produção: configuração, agendador da fila de lembretes, backups, rotação de chaves, retenção e recuperação de falhas. Riscos e decisões de segurança: [seguranca-e-lgpd.md](seguranca-e-lgpd.md). Achados da auditoria técnica: [auditoria-tecnica.md](auditoria-tecnica.md).

## 1. Checklist antes do primeiro deploy

- [ ] PostgreSQL 16+ gerenciado (ou próprio) com a extensão `btree_gist` disponível, **backup automático e recuperação para um ponto no tempo (PITR)** ativos, acesso só pela rede privada da aplicação.
- [ ] Usuário do banco da aplicação **sem** privilégio de superusuário. As migrations podem rodar com um usuário dono do schema.
- [ ] HTTPS obrigatório (o cookie de sessão usa `__Host-` + `Secure`; sem HTTPS não há login).
- [ ] Variáveis da seção 2 configuradas no provedor (nunca em arquivo versionado).
- [ ] `DATA_ENCRYPTION_KEY` gerada e **guardada em dois lugares** (cofre de segredos + cópia offline), separada dos backups do banco.
- [ ] Agendador da fila de lembretes configurado (seção 3).
- [ ] `WHATSAPP_PROVIDER=disabled` até a homologação da API oficial ([whatsapp.md](whatsapp.md)).
- [ ] Rotina de backup testada com uma restauração completa (seção 4).
- [ ] Primeira conta de administração criada pela linha de comando; as demais pela tela **Equipe**.
- [ ] Monitoramento de `GET /api/health` e dos logs (seção 7).

Sequência de deploy:

```bash
npm ci                 # instala também as dependências de build (Tailwind, shadcn, Prisma CLI)
npm run build          # APP_URL e NEXT_SERVER_ACTIONS_ENCRYPTION_KEY precisam existir JÁ no build
npm run db:deploy      # aplica migrations pendentes (faça backup antes)
npm start
npm run user:create -- --email … --name "…" --role ADMIN   # só na primeira vez
```

Nunca rode em produção: `db:migrate` (cria migrations), `db:reset` (apaga o banco), `db:seed` (dados fictícios — o seed recusa `NODE_ENV=production`) nem os testes de integração (apagam o banco de testes; recusam bancos sem “test” no nome).

## 2. Configuração de produção

Validada na inicialização (`src/server/env.ts`): valores inválidos impedem o servidor de subir; configurações **aceitas mas arriscadas** geram avisos `config.production_warning` no log (apenas nomes de variáveis):

| Situação | Efeito | Aviso |
| --- | --- | --- |
| `APP_URL` ausente ou sem `https://` | Sem HSTS e `upgrade-insecure-requests` | sim |
| `DATA_ENCRYPTION_KEY` ausente | Observações de pacientes indisponíveis | sim |
| `DATA_ENCRYPTION_KEY_PREVIOUS` definida | Rotação em andamento | sim |
| `CRON_SECRET` ausente | `/api/jobs/reminders` responde 404; fila parada | sim |
| `cloud_api` sem os modelos de lembrete | Lembretes falham com aviso | sim |
| `WHATSAPP_PROVIDER=development` | **Recusado** em produção | erro |
| `cloud_api` sem credenciais | **Recusado** | erro |

Pontos que dependem da infraestrutura:

- **Build × execução:** `next.config.ts` lê `APP_URL` no **build** (cabeçalhos HSTS); `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` também precisa ser igual em todos os builds/instâncias quando houver mais de uma.
- **Proxy reverso:** defina `TRUST_PROXY=true` só atrás de um proxy que sobrescreve `X-Forwarded-For`. O proxy deve preservar `Host`/`X-Forwarded-Host` iguais ao domínio público — as Server Actions conferem a origem (proteção CSRF) e recusam requisições com origem divergente.
- **Fuso:** `APP_TIMEZONE` (padrão `America/Sao_Paulo`); o banco guarda UTC.

## 3. Agendador da fila de lembretes

A fila é processada por `POST /api/jobs/reminders` (também aceita `GET`) com `Authorization: Bearer $CRON_SECRET`. Execuções simultâneas são seguras (reserva com `SKIP LOCKED`); reservas presas há mais de 15 minutos voltam para a fila. **Recomendação: a cada 5 minutos.** A resposta é um resumo JSON (`claimed`, `sent`, `simulated`, `retried`, `failed`, `cancelled`, `skippedReason`). Com `WHATSAPP_PROVIDER=disabled` nada é enviado (`skippedReason`) — é seguro manter o agendador ligado desde o início.

Escolha **uma** das opções:

**crontab (servidor Linux):**

```cron
# /etc/cron.d/crm-lembretes — o segredo fica em arquivo legível só pelo usuário do cron
*/5 * * * * crm curl --fail --silent --show-error --max-time 60 -X POST -H "Authorization: Bearer $(cat /etc/crm/cron_secret)" https://crm.exemplo.com.br/api/jobs/reminders > /dev/null
```

**systemd timer:**

```ini
# /etc/systemd/system/crm-lembretes.service
[Unit]
Description=Processa a fila de lembretes do CRM
[Service]
Type=oneshot
EnvironmentFile=/etc/crm/cron.env          # CRON_SECRET=...  (chmod 600)
ExecStart=/usr/bin/curl --fail --silent --show-error --max-time 60 -X POST -H "Authorization: Bearer ${CRON_SECRET}" https://crm.exemplo.com.br/api/jobs/reminders

# /etc/systemd/system/crm-lembretes.timer
[Unit]
Description=Fila de lembretes do CRM a cada 5 minutos
[Timer]
OnCalendar=*:0/5
Persistent=true
[Install]
WantedBy=timers.target
```

Ative com `systemctl enable --now crm-lembretes.timer` e acompanhe com `journalctl -u crm-lembretes`.

**Vercel:** com a variável `CRON_SECRET` definida no projeto, o Vercel Cron envia o cabeçalho `Authorization: Bearer <CRON_SECRET>` automaticamente. Em `vercel.json`: `{ "crons": [{ "path": "/api/jobs/reminders", "schedule": "*/5 * * * *" }] }` (a frequência mínima depende do plano).

**GitHub Actions** (agendamento pode atrasar alguns minutos — aceitável para lembretes): workflow com `on: schedule: - cron: "*/5 * * * *"` executando o mesmo `curl`, com o segredo em *Actions secrets*.

Verificação: a tela **Protocolos e retornos → Lembretes** mostra a fila; cada execução com lembretes processados gera o evento de auditoria “Fila de lembretes processada” (pelo agendador automático). Falhas do endpoint aparecem como `jobs.reminders.failed` no log.

## 4. Backups e recuperação do PostgreSQL

O banco contém **dados de saúde**: backups devem ser cifrados, ter acesso restrito e prazo de guarda definido.

**Preferencial:** backup gerenciado do provedor com PITR (ex.: retenção de 7–30 dias).

**Complementar (lógico, diário):**

```bash
# formato custom (comprimido, restauração seletiva); cifrado antes de sair do servidor
pg_dump --format=custom --no-owner --no-acl --file "crm-$(date +%F).dump" "$DATABASE_URL"
gpg --symmetric --cipher-algo AES256 "crm-$(date +%F).dump" && shred -u "crm-$(date +%F).dump"
```

Sugestão de guarda: 30 diários + 12 mensais, em armazenamento separado da aplicação, com acesso só da responsável técnica.

**Restauração (sempre em um banco NOVO primeiro):**

```bash
createdb crm_restaurado
pg_restore --no-owner --no-acl --dbname "postgresql://…/crm_restaurado" crm-AAAA-MM-DD.dump
DATABASE_URL="postgresql://…/crm_restaurado" npx prisma migrate status   # deve dizer "up to date"
```

Depois, aponte uma instância de teste para o banco restaurado com a **mesma `DATA_ENCRYPTION_KEY` da época do backup**, confira `/api/health`, o login e a leitura de uma observação. Só então troque o banco de produção.

**Teste de restauração:** a cada 3 meses, com registro do resultado. Um backup nunca restaurado não é um backup.

Observações:

- A trilha de auditoria é somente inserção (trigger bloqueia `UPDATE`/`DELETE`); `pg_restore` funciona normalmente (recria as tabelas).
- As observações dos pacientes estão cifradas dentro do backup: **sem a chave da época, o backup restaura tudo, menos as observações**. Por isso a chave é guardada à parte e as chaves antigas são mantidas enquanto houver backups cifrados com elas.

## 5. Rotação de chaves e segredos

| Segredo | Quando rotacionar | Como |
| --- | --- | --- |
| `DATA_ENCRYPTION_KEY` | Suspeita de vazamento; saída de quem tinha acesso; periodicamente (ex.: anual) | Procedimento abaixo |
| `CRON_SECRET` | Vazamento ou troca de agendador | Gere um novo (`openssl rand -base64 32`), atualize o ambiente da aplicação **e** o agendador; reinicie |
| Credenciais do WhatsApp (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`) | Vazamento; troca de responsável | Revogue/gere no Meta Business; atualize o ambiente; para o segredo do app, atualize também o webhook |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Raramente | Novo valor no ambiente e no painel da Meta (refaz a verificação) |
| Senha do banco | Política do provedor; vazamento | Crie a nova senha, atualize `DATABASE_URL`, reinicie, revogue a antiga |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Vazamento | Novo valor + novo build/deploy de todas as instâncias (formulários abertos precisam ser recarregados) |
| Sessões | Incidente | Desativar a conta encerra as sessões dela; para encerrar **todas**: `DELETE FROM sessions;` (papel administrativo do banco) |

### Rotação da `DATA_ENCRYPTION_KEY`

1. Gere a nova chave: `openssl rand -base64 32`. Guarde-a (cofre + cópia offline) **antes** de usar.
2. No ambiente: `DATA_ENCRYPTION_KEY=<nova>` e `DATA_ENCRYPTION_KEY_PREVIOUS=<antiga>`. Faça o deploy: novas observações já usam a chave nova; as antigas continuam legíveis.
3. Simule: `npm run data:rotate-key` (no servidor/ambiente com as duas variáveis). Confira “Ilegíveis com as duas chaves: 0”.
4. Aplique: `npm run data:rotate-key -- --apply` (registra “Chave de cifragem das observações rotacionada” na auditoria). Rode a simulação de novo: todas devem estar “já na chave nova”.
5. Remova `DATA_ENCRYPTION_KEY_PREVIOUS` e faça o deploy (o aviso de rotação some do log).
6. **Não descarte a chave antiga** enquanto existirem backups feitos antes da rotação.

Se a simulação apontar observações ilegíveis, **pare**: provavelmente foram gravadas com outra chave (configuração errada no passado). Localize a chave correta antes de seguir; o script nunca altera notas que não consegue ler.

## 6. Retenção de dados

`npm run data:retention` simula; `-- --apply` executa e audita (sugestão: mensalmente, pelo mesmo agendador). Remove apenas dados técnicos: sessões expiradas, tentativas de login com mais de 90 dias e registros de webhook com mais de 90 dias. Prazos para dados de pacientes, leads, agenda e conversas — e a anonimização — dependem de decisão jurídica da clínica ([seguranca-e-lgpd.md](seguranca-e-lgpd.md#retenção-de-dados)).

## 7. Monitoramento

- **Disponibilidade:** `GET /api/health` (200 com o banco respondendo; 503 caso contrário). Alerta após 2 falhas seguidas.
- **Logs** (JSON, uma linha por evento, já com redação de dados pessoais) — alertas sugeridos:
  - `config.production_warning` na inicialização;
  - `jobs.reminders.failed`, `jobs.reminders.unauthorized` (tentativa com segredo errado);
  - picos de `whatsapp.webhook.invalid_signature` (alguém forjando webhooks);
  - `request.unhandled_error` e `action.failed` (erros inesperados; o código de referência mostrado à equipe é o `digest`).
- **Auditoria** (tela Gestão → Auditoria): bloqueios de login, acessos negados, exportações, leituras de observações clínicas, operações da equipe.
- **Fila de lembretes:** lembretes “Falhou” na tela de Lembretes.

## 8. Recuperação de falhas (runbook)

| Situação | O que fazer |
| --- | --- |
| `/api/health` em 503 | Banco inacessível: verifique o provedor, credenciais e conexões. A aplicação volta sozinha quando o banco responder. |
| Migration falhou no deploy | `npx prisma migrate status`. Corrija a causa; se a migration ficou parcialmente aplicada, restaure o backup feito antes do deploy (preferível) ou use `prisma migrate resolve` com orientação técnica. Não edite migrations já aplicadas. |
| Fila de lembretes parada | Confirme o agendador (log do cron/timer) e o `CRON_SECRET`. Reservas presas se recuperam em 15 minutos. Lembretes “Falhou” podem ser reenfileirados na tela após corrigir a causa. |
| Webhook do WhatsApp com erro | A Meta reenvia; eventos que falharam são reprocessados na próxima entrega. Assinaturas inválidas: confira `WHATSAPP_APP_SECRET`. |
| Observações “ilegíveis” | Chave errada no ambiente (ex.: deploy com outra `DATA_ENCRYPTION_KEY`). Restaure a variável correta; nada é perdido enquanto a chave existir. |
| Chave de cifragem vazada | Rotação imediata (seção 5) e avaliação de incidente (LGPD art. 48: comunicar ANPD e titulares se houver risco relevante). |
| Conta da equipe comprometida | Tela Equipe: **desativar** (encerra sessões na hora) e gerar senha provisória; revise a auditoria da conta. |
| Ninguém consegue entrar como administração | No servidor: `npm run user:reset-password -- --email …` ou `npm run user:create -- --role ADMIN`. |
| Mensagens de WhatsApp enviadas por engano | Desative imediatamente: `WHATSAPP_PROVIDER=disabled` + deploy; cancele lembretes pendentes na tela; avalie comunicação aos titulares. |
