# Clinni

CRM para clínicas de estética — nesta versão, uma clínica por instalação: leads e funil comercial, pacientes, agenda, protocolos de tratamento com retornos e lembretes, conversas de WhatsApp (preparadas para a API oficial) com assistente virtual — incluindo IA conversacional que usa as ferramentas do CRM com segurança — e indicadores, com segurança e LGPD desde a base.

## Situação dos módulos

Um módulo só aparece como disponível quando funciona de ponta a ponta (telas, regras no servidor, banco e testes). Nada aqui é ilustrativo.

| Etapa | Módulo | Situação | O que funciona |
| --- | --- | --- | --- |
| 1 | Fundação | **Concluída** | Login, sessões no banco, perfis de acesso (RBAC), auditoria somente inserção, cabeçalhos de segurança, layout |
| 2 | Leads e funil | **Concluída** | Cadastro sem duplicidade por telefone, funil Kanban com arrastar e soltar (e teclado), lista com filtros/ordenação/paginação, interações e próximas ações, motivo de perda, conversão transacional em paciente |
| 3 | Pacientes | **Concluída** | Cadastro mínimo com consentimentos datados, ficha com abas (resumo, agenda, procedimentos, protocolos e retornos, mensagens, interações, observações), observações cifradas com acesso clínico restrito e auditado, exportação de dados (LGPD) |
| 4 | Agenda | **Concluída** | Visões dia/semana/mês, criação por clique no horário livre, filtros por profissional e status, confirmar/concluir/cancelar/não compareceu, reagendamento com histórico, remarcação de cancelados, conflitos bloqueados |
| 5 | Protocolos e retornos | **Concluída** | Catálogo de protocolos com intervalos definidos pela profissional, aplicação ao paciente, retornos programados e recalculados, vínculo retorno ↔ agendamento, fila de lembretes com tentativas e falhas |
| 6 | Dashboard | **Concluída** | Indicadores reais do banco: agenda do dia, retornos atrasados, próximas ações comerciais, leads novos, conversão por etapa, origem dos leads e procedimentos realizados, com filtro de período |
| 7 | WhatsApp | **Concluída (estrutura)** | Adaptadores de desenvolvimento e da Cloud API, webhook com assinatura e idempotência, conversas vinculadas a leads/pacientes, janela de 24h, status de entrega/leitura. **Envio real depende das credenciais da Meta** (veja abaixo) |
| 8 | Equipe e LGPD | **Concluída** | Gestão de contas na interface (perfis, desativação, senha provisória com troca obrigatória), troca da própria senha, rotina de retenção de dados técnicos |
| 9 | Assistente virtual | **Concluída (IA real depende de credencial)** | Fila de atendimento, base de conhecimento com versões e aprovação, pendências de curadoria, tarefas da equipe, consentimentos e três motores: por regras (sem IA), guiado e **IA conversacional** — respostas geradas na hora a partir da personalidade configurada, do contexto do contato e da base aprovada, com ferramentas do CRM validadas no servidor (cadastro de leads, agenda com confirmação explícita, transferência, retornos, acompanhamentos), checagem das respostas e controle de custo. Testada com provedor simulado; **nunca chamada contra a API real neste ambiente** ([detalhes](docs/assistente-ia.md)) |

### Pendências reais e limitações

- **WhatsApp real:** o código da Cloud API está pronto e testado com respostas simuladas da API, mas **nunca foi exercitado contra a Meta** — faltam número verificado, token, segredo do app e modelos aprovados. Passo a passo em [`docs/whatsapp.md`](docs/whatsapp.md). Sem isso, use `WHATSAPP_PROVIDER=disabled` (padrão em produção): nada é enviado e os lembretes ficam visíveis no CRM.
- **Agendador do ciclo de automação:** o endpoint `/api/jobs/automation` (lembretes, acompanhamentos, fila do assistente e reenvios; `/api/jobs/reminders` continua como sinônimo) existe e as configurações prontas (crontab, systemd, Vercel, GitHub Actions) estão em [`docs/operacao.md`](docs/operacao.md#3-agendador-da-fila-de-lembretes), mas o agendador precisa ser ligado na hospedagem. Sem ele, a fila só é processada pelo botão “Processar fila” (perfis Profissional e Administração) — e o servidor avisa no log ao iniciar sem `CRON_SECRET`.
- **Retenção de dados pessoais:** a rotina automática cobre apenas dados técnicos. Prazos de guarda de dados de pacientes e anonimização de leads antigos dependem de decisão jurídica da clínica — veja [`docs/seguranca-e-lgpd.md`](docs/seguranca-e-lgpd.md).
- **IA conversacional real:** implementada e testada com provedor simulado, CRM simulado e PostgreSQL real, mas **sem nenhuma chamada à API da Anthropic neste ambiente** (sem chave; chamadas pagas não autorizadas). Antes de ativar: contrato e base legal para a transferência internacional (LGPD art. 33), `ANTHROPIC_API_KEY` e a avaliação `npm run assistant:eval -- --confirm-costs` ([docs/assistente-ia.md](docs/assistente-ia.md)).
- **Hospedagem:** a recomendação é Node.js convencional; o empacotamento para Cloudflare Workers (OpenNext) falhou e não está validado ([docs/hospedagem.md](docs/hospedagem.md)).
- **Mídia no WhatsApp:** mensagens recebidas com imagem, áudio ou documento são registradas apenas como “[tipo] conteúdo não exibido” (a mídia não é baixada nem armazenada).
- **Notificações em tempo real:** a tela de conversas não se atualiza sozinha (há o botão “Atualizar”), para não manter sessões ociosas abertas indefinidamente.
- **Agenda por sala/equipamento** e **pagamentos/financeiro** estão fora do escopo atual.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Framework | Next.js 16.4 (App Router, Cache Components / Partial Prerendering, Turbopack) + React 19.3 |
| Linguagem | TypeScript 5.9 (modo estrito) |
| Interface | Tailwind CSS 4.3 + shadcn/ui 4 (Radix), dnd-kit (funil), Recharts (gráfico) |
| Banco | PostgreSQL 18 + Prisma ORM 7.10 (driver adapter `pg`) |
| Datas | date-fns 4 + `@date-fns/tz` (fuso da clínica) |
| Telefones | libphonenumber-js (E.164) |
| Validação | Zod 4 (cliente e servidor) |
| Senhas | Argon2id via WebAssembly (`hash-wasm`) |
| Testes | Vitest 5 (unitários e de integração com PostgreSQL real) |

## Requisitos

- Node.js **22.12 ou superior** (desenvolvido com Node 24) e npm 10+
- Docker (PostgreSQL local) — ou um PostgreSQL 16+ próprio com a extensão `btree_gist`

## Como rodar localmente

```bash
# 1. Dependências (também gera o Prisma Client)
npm install

# 2. Variáveis de ambiente
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
#    gere DATA_ENCRYPTION_KEY e CRON_SECRET (comandos no próprio .env.example)

# 3. Banco de dados (cria os bancos crm_dev e crm_test)
npm run db:up

# 4. Migrations e dados FICTÍCIOS de desenvolvimento
npm run db:migrate
npm run db:seed

# 5. Aplicação
npm run dev
```

Acesse <http://localhost:3000>. Contas fictícias do seed (senha = `SEED_USER_PASSWORD` do `.env`):

| Perfil | E-mail |
| --- | --- |
| Administração | `admin@demo.test` |
| Profissional | `profissional@demo.test` |
| Recepção | `recepcao@demo.test` |

O seed cria também leads, pacientes, agenda (com datas relativas a hoje), um protocolo aplicado, retornos e uma conversa **simulada** — todos fictícios (domínio `.test`, sobrenome “Demo”, categoria “Demonstração”). Ele se recusa a rodar com `NODE_ENV=production`. Em desenvolvimento, o cabeçalho exibe “Desenvolvimento: dados fictícios” e o WhatsApp funciona em **modo de desenvolvimento** (nada sai do servidor; tudo marcado como simulado).

> **npm 11 e scripts de instalação:** os pacotes que precisam de scripts (Prisma, esbuild, unrs-resolver) já estão aprovados em `allowScripts`. Se o npm avisar sobre um pacote novo, revise com `npm install-scripts ls` antes de aprovar.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e execução de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | Gera os tipos de rotas e roda o TypeScript |
| `npm test` | Testes unitários (sem banco) |
| `npm run test:integration` | Testes de integração (usa `TEST_DATABASE_URL`, **apaga os dados desse banco**) |
| `npm run test:all` | Todos os testes |
| `npm run check` | Lint + tipos + todos os testes + build |
| `npm run db:up` / `db:down` | Sobe/derruba o PostgreSQL do Docker |
| `npm run db:migrate` | Aplica/cria migrations em desenvolvimento |
| `npm run db:deploy` | Aplica migrations em produção/CI (sem criar novas) |
| `npm run db:seed` | Dados fictícios de desenvolvimento |
| `npm run db:reset` | Recria o banco de desenvolvimento do zero e roda o seed (pede confirmação) |
| `npm run db:studio` | Prisma Studio |
| `npm run user:create` | Cria uma conta pela linha de comando (primeira conta de administração) |
| `npm run user:reset-password` | Redefine a senha pela linha de comando e encerra as sessões |
| `npm run data:retention` | Retenção de dados técnicos — **simula**; `-- --apply` executa |
| `npm run data:rotate-key` | Rotação da `DATA_ENCRYPTION_KEY` (observações, mensagens, notas do assistente e pendências) — **simula**; `-- --apply` recifra ([procedimento](docs/operacao.md#rotação-da-data_encryption_key)) |
| `npm run assistant:eval -- --confirm-costs` | Avaliação da IA conversacional com o **modelo real** sobre um CRM simulado (tem custo; nada é gravado nem enviado) |

### Contas da equipe

A primeira conta de administração é criada pela linha de comando; as demais, pela tela **Equipe** (menu Gestão):

```bash
npm run user:create -- --email daniela@clinica.com.br --name "Daniela Zilioli" --role ADMIN
```

Na tela Equipe, a administração cria contas, muda perfis, desativa/reativa e gera **senhas provisórias** (exibidas uma única vez; a troca é exigida no primeiro acesso). Contas nunca são excluídas — a auditoria depende delas. O sistema impede desativar a própria conta e ficar sem nenhuma administração ativa.

## Variáveis de ambiente

Validadas com Zod na inicialização (`src/instrumentation.ts`); se algo estiver errado o servidor não sobe e a mensagem lista apenas **nomes** de variáveis, nunca valores.

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | sim | Conexão PostgreSQL |
| `TEST_DATABASE_URL` | testes | Banco exclusivo dos testes de integração (diferente de `DATABASE_URL`) |
| `APP_URL` | recomendada | URL pública. Com `https://`, ativa HSTS e `upgrade-insecure-requests` |
| `APP_TIMEZONE` | não | Fuso da clínica (padrão `America/Sao_Paulo`) |
| `LOG_LEVEL` | não | `debug`, `info` (padrão), `warn`, `error` |
| `SESSION_MAX_AGE_HOURS` | não | Duração máxima da sessão (padrão 12) |
| `SESSION_IDLE_TIMEOUT_MINUTES` | não | Encerramento por inatividade (padrão 120) |
| `TRUST_PROXY` | não | `true` somente atrás de proxy reverso confiável (ativa o limite de login por IP) |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | multi-instância | Chave estável para Server Actions (`openssl rand -base64 32`) |
| `DATA_ENCRYPTION_KEY` | sim, para observações | AES-256 (32 bytes em base64) que cifra as observações dos pacientes. **Sem ela, observações antigas ficam ilegíveis** — guarde com o mesmo cuidado do backup |
| `DATA_ENCRYPTION_KEY_PREVIOUS` | só na rotação | Chave anterior, aceita apenas na leitura enquanto `data:rotate-key` recifra as observações; remova ao concluir |
| `CRON_SECRET` | para o agendador | Segredo exigido por `/api/jobs/reminders` (mín. 32 caracteres) |
| `REMINDER_RETURN_DAYS_BEFORE` | não | Antecedência do lembrete de retorno, em dias (padrão 2; enviado às 09:00) |
| `REMINDER_APPOINTMENT_HOURS_BEFORE` | não | Antecedência do lembrete de agendamento, em horas (padrão 24) |
| `WHATSAPP_PROVIDER` | não | `disabled` (padrão em produção), `development` (padrão fora de produção; proibido em produção) ou `cloud_api` |
| `WHATSAPP_GRAPH_API_VERSION` | não | Versão da Graph API (padrão `v23.0`) |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | com `cloud_api` | Credenciais da Cloud API e do webhook |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | não | Conta do WhatsApp Business (referência) |
| `WHATSAPP_TEMPLATE_LANGUAGE` | não | Idioma dos modelos (padrão `pt_BR`) |
| `WHATSAPP_TEMPLATE_RETURN_REMINDER`, `WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER` | com `cloud_api` | Nomes dos modelos aprovados na Meta para os lembretes |
| `AI_PROVIDER` | não | `disabled` (padrão em produção), `rules` (padrão fora de produção, sem IA) ou `anthropic` |
| `AI_ENGINE` | não | Com `anthropic`: `agent` (IA conversacional, padrão) ou `guided` (IA só interpreta; textos configurados) |
| `ANTHROPIC_API_KEY` | com `anthropic` | Credencial da Anthropic (nunca exibida nem registrada) |
| `ANTHROPIC_MODEL`, `AI_EFFORT` | não | Modelo (padrão `claude-opus-5-5`) e esforço de raciocínio (`low`, `medium` — padrão —, `high`) |
| `AI_TIMEOUT_MS`, `AI_TURN_TIMEOUT_MS` | não | Tempo limite por chamada (30 s) e por mensagem inteira (120 s) |
| `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_CONCURRENCY` | não | Teto de tokens gerados por chamada (8.000) e chamadas simultâneas por processo (3) |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK`, `AI_PRICE_CACHE_READ_PER_MTOK`, `AI_PRICE_CACHE_WRITE_PER_MTOK` | não | Preços (US$ por milhão de tokens) para estimar o custo e aplicar o limite mensal (padrões do `claude-opus-5-5`) |
| `OPENNEXT_CLOUDFLARE_DEV` | não | `1` liga a simulação do Cloudflare no `next dev` (só para testar o empacotamento OpenNext) |
| `SEED_USER_PASSWORD` | seed | Senha das contas fictícias de desenvolvimento |

## Arquitetura

```
src/
├── app/
│   ├── (auth)/login/            Login (formulário + Server Action)
│   ├── (app)/                   Área autenticada: dashboard, leads, pacientes, agenda,
│   │                            protocolos, procedimentos, whatsapp, equipe, auditoria, conta
│   └── api/
│       ├── health/              Health check (consulta o banco)
│       ├── pacientes/[id]/exportar/   Exportação LGPD (somente administração)
│       ├── webhooks/whatsapp/   Webhook da Cloud API (assinatura + idempotência)
│       └── jobs/automation/     Ciclo de automação: lembretes, acompanhamentos, assistente, reenvios (CRON_SECRET)
├── components/                  ui/ (shadcn), layout/, data/, forms/ e componentes por módulo
├── hooks/                       useAction (Server Actions + feedback), useResetOnHide
├── lib/                         Código isomórfico: rótulos, datas no fuso, telefones, dinheiro,
│                                cálculo de protocolos, posicionamento da agenda, validações (Zod)
├── server/
│   ├── auth/                    Senhas, tokens, sessões, limite de login, DAL, actions de login
│   ├── actions/                 Server Actions (envelope runAction: sessão + permissão + erros)
│   ├── services/                Regras de negócio (recebem o ator; testadas com banco real)
│   ├── queries/                 Leituras com autorização embutida
│   ├── assistant/               Assistente: motor por regras, motor guiado e agent/ (IA conversacional:
│   │                            instruções, contexto, ferramentas do CRM, provedor Anthropic, simulador)
│   ├── whatsapp/                Contrato do provedor, adaptadores e leitura de webhooks
│   ├── crypto/                  Cifragem AES-256-GCM das observações
│   ├── maintenance/             Rotina de retenção de dados técnicos
│   ├── audit.ts, env.ts, logger.ts, errors.ts
└── proxy.ts                     Redirecionamento otimista para o login
prisma/                          Schema, migrations e seed fictício
scripts/                         Linha de comando: contas, retenção, rotação de chave e avaliação da IA
tests/                           unit/ e integration/
docs/                            Documentação por domínio
```

**Camadas.** Página (Server Component) → consulta com permissão (`server/queries`) para ler; formulário/ação → Server Action (`server/actions`, sempre via `runAction`: valida sessão, exige a permissão, converte erros) → serviço (`server/services`, confere a permissão de novo, valida regras, grava em transação e audita). Os serviços recebem o banco e o “relógio” por parâmetro — por isso os testes de integração exercitam as mesmas regras que a interface usa.

**Fluxo de uma requisição autenticada.** `proxy.ts` só verifica a presença do cookie. A página entrega o HTML estático (layout, títulos, esqueletos) e as partes dependentes do usuário rodam em `<Suspense>`, chamando a DAL (`server/auth/dal.ts`), que valida a sessão no banco **a cada requisição** (com `connection()`, para nada autenticado ser pré-renderizado). Com senha provisória pendente, toda página e ação leva à troca de senha.

Documentação por domínio:

- [Identidade visual e design system](docs/design-system.md) (arquivos oficiais da marca em [`docs/brand/`](docs/brand/))
- [Modelo de dados](docs/modelo-de-dados.md)
- [Fluxos comerciais (leads, funil, conversão, indicadores)](docs/fluxos-comerciais.md)
- [Agendamentos](docs/agendamentos.md)
- [Protocolos, retornos e lembretes](docs/protocolos-e-retornos.md)
- [Integração com o WhatsApp](docs/whatsapp.md)
- [Assistente virtual e IA conversacional](docs/assistente-ia.md)
- [Hospedagem: Node.js × OpenNext × vinext](docs/hospedagem.md)
- [Segurança e LGPD](docs/seguranca-e-lgpd.md)
- [Operação em produção (deploy, agendador, backups, rotação de chaves, recuperação)](docs/operacao.md)
- [Auditoria técnica de 02/11/2026](docs/auditoria-tecnica.md)

## Segurança e LGPD (resumo)

Detalhes em [`docs/seguranca-e-lgpd.md`](docs/seguranca-e-lgpd.md).

- **Autenticação:** Argon2id; sessões no banco (cookie com token de 256 bits, banco guarda só o SHA-256); `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção; expiração absoluta (12 h) e por inatividade (2 h); limite de tentativas por e-mail (e por IP com `TRUST_PROXY`); respostas sem enumeração de contas.
- **Autorização (RBAC) no servidor**, em três camadas: páginas (`checkPermission`), Server Actions (`requirePermission`) e serviços (`assertPermission`). Esconder um botão nunca é a proteção.

| Permissão | Recepção | Profissional | Administração |
| --- | :---: | :---: | :---: |
| Leads, pacientes, agenda, retornos, lembretes, WhatsApp | ✓ | ✓ | ✓ |
| Excluir leads, inativar pacientes, procedimentos/protocolos, aplicar protocolos, processar a fila | | ✓ | ✓ |
| Observações clínicas (leitura auditada) | | ✓ | ✓ |
| Equipe, auditoria, exportação de dados de pacientes | | | ✓ |

- **Auditoria somente inserção** (trigger no banco) de acessos, alterações, consentimentos, leituras de observações clínicas, exportações e operações da equipe — sem conteúdo pessoal no `metadata`.
- **Dados de saúde minimizados:** cadastro sem CPF/endereço; observações sempre cifradas (AES-256-GCM com o paciente como dado autenticado); campos comerciais avisam para não registrar informação clínica.
- **Consentimentos datados** (WhatsApp, comunicações promocionais, uso de imagem); revogar o WhatsApp cancela os lembretes pendentes.
- **Direitos do titular:** exportação completa dos dados do paciente (JSON, auditada); exclusão definitiva de leads (pedido de eliminação); retenção de dados técnicos por rotina explícita.
- **Webhooks** autenticados por HMAC-SHA256 do corpo bruto, deduplicados e registrados **sem o payload**.
- **Logs** estruturados com redação automática (senhas, tokens, telefones, e-mails, CPFs); a CSP não permite origens externas.

O sistema **não gera diagnósticos nem recomendações clínicas**: os intervalos de retorno são definidos pela profissional, e o sistema apenas calcula datas a partir deles.

## Banco de dados e migrations

O schema (`prisma/schema.prisma`) e as migrations em `prisma/migrations/` cobrem equipe/sessões/auditoria, leads e interações, pacientes e observações, procedimentos, protocolos e etapas, protocolos do paciente, procedimentos realizados, retornos, fila de lembretes, agenda com histórico e WhatsApp (conversas, mensagens, eventos de webhook). Detalhes e invariantes: [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md).

| Migration | Conteúdo |
| --- | --- |
| `20261031155449_init` | Estrutura inicial, `btree_gist`, agenda sem sobreposição (`EXCLUDE`), CHECKs, auditoria somente inserção |
| `20261031180000_crm_modules` | Módulos do CRM: interações de leads/pacientes, retornos, fila de lembretes com índices de idempotência, histórico da agenda, consentimentos |
| `20261031180100_appointments_no_show_overlap` | “Não compareceu” também libera o horário na restrição de sobreposição |
| `20261102120000_whatsapp_assistant` | WhatsApp, assistente virtual, base de conhecimento com versões, curadoria, tarefas da equipe, consentimentos, modelos da Meta |
| `20261102120100_reminders_follow_up_index` | Idempotência das etapas de acompanhamento na fila de lembretes |
| `20261104120000_assistant_agent` | IA conversacional (só adições): consumo por execução, execuções de acompanhamento, notas cifradas da conversa |

Datas e horas ficam em `timestamptz` (UTC) e são exibidas no fuso da clínica; datas de calendário (retornos, nascimento) em `date`.

Em produção: `npm run db:deploy` (aplica migrations sem criar novas). **Faça backup antes de aplicar migrations em produção.**

## Testes

375 testes (Vitest), em duas camadas:

- **Unitários** (`tests/unit`): senhas, tokens, permissões, redirecionamento, validações (Zod) de todos os módulos, redação de logs, ambiente (incluindo regras do WhatsApp), datas no fuso, telefones, dinheiro, cálculo de protocolos, posicionamento da agenda, assinatura/leitura de webhooks (inclusive sobre bytes brutos), adaptador da Cloud API (sem vazar token em logs), cifragem, redação de erros do PostgreSQL, avisos de configuração de produção e a trava do banco de testes.
- **Integração** (`tests/integration`, PostgreSQL real): sessões e login com limite de tentativas; restrições do banco; leads (duplicidade, funil, interações, conversão transacional e concorrente, exclusão); pacientes (consentimentos, cifragem, acesso clínico auditado, exportação); agenda (fuso, conflitos inclusive com criações simultâneas, janela de datas, reagendamento com histórico, transições, reflexo no funil); protocolos e retornos (cálculo, recálculo, cancelamento, vínculo com a agenda); fila de lembretes (simulação, novas tentativas, falha definitiva, processadores concorrentes, trava presa); WhatsApp (webhook idempotente, status, janela de 24h, simulação); rotas públicas (assinatura do webhook, segredo do cron, exportação recusada vinda de outro site); equipe, troca de senha com limite de tentativas, retenção e rotação da chave; assistente virtual (fila, motores por regras e guiado, base de conhecimento, curadoria) e **IA conversacional** de ponta a ponta com provedor roteirizado — conversa com dúvida, cadastro, agendamento com confirmação e consentimento; isolamento e minimização do contexto; notas cifradas; transferência; limite mensal; falhas; janela de 24h; retornos de protocolo; acompanhamentos.
- **Cenários de conversa** (`tests/unit/assistant-agent*.test.ts`): ferramentas e permissões, confirmação explícita, checagem das respostas, manipulação, limites de tokens/chamadas/tempo e perfis de contato com vários turnos. A qualidade da linguagem do modelo real é avaliada à parte, com `npm run assistant:eval` (opcional, com custo).

```bash
npm run check   # lint + typecheck + todos os testes + build
```

## Produção

Guia completo — checklist, configuração, agendador, backups e restauração, rotação de chaves, monitoramento e runbook de falhas: **[`docs/operacao.md`](docs/operacao.md)**. Resumo:

1. Configure as variáveis de ambiente (com `APP_URL` em `https://` — também no build —, `DATA_ENCRYPTION_KEY`, `CRON_SECRET` e `WHATSAPP_PROVIDER=disabled` até a integração real). O servidor avisa no log (`config.production_warning`) o que estiver faltando.
2. `npm ci && npm run build`
3. Backup do banco → `npm run db:deploy`
4. `npm run user:create -- --email … --name "…" --role ADMIN` (primeira conta)
5. `npm start`. Monitore `GET /api/health`.
6. Agende `POST /api/jobs/automation` (ex.: a cada 5 minutos) com `Authorization: Bearer $CRON_SECRET`.
7. Opcional: agende `npm run data:retention -- --apply` (ex.: mensalmente).

Atrás de um proxy reverso que acrescenta o IP do cliente ao `X-Forwarded-For`, defina `TRUST_PROXY=true`. Use sempre HTTPS: o cookie de sessão exige conexão segura.

### Hospedagem

Recomendação: **Node.js convencional + PostgreSQL gerenciado** (comparação e arquitetura em [`docs/hospedagem.md`](docs/hospedagem.md)). O repositório também contém `wrangler.jsonc`, `open-next.config.ts` e os scripts `preview`/`deploy`/`upload` do OpenNext para Cloudflare Workers, gerados automaticamente pelo Wrangler — esse caminho **não está validado**: o empacotamento falhou (dependências nativas e versão do Next) e o limite de 30 s do `waitUntil` não comporta o atendimento com IA. Não faça deploy no Workers sem cumprir os pré-requisitos listados no documento.

## Decisões técnicas

- **Regras de negócio em serviços testáveis**, não nas telas: as Server Actions só traduzem formulário → serviço; os serviços recebem ator, banco e relógio por parâmetro.
- **Conflitos de agenda em duas camadas:** checagem com mensagem amigável dentro da transação, serializada por profissional com *advisory lock* (evita *deadlocks* em agendamentos simultâneos), e a restrição `EXCLUDE USING gist` no banco como garantia final.
- **Fila de lembretes no próprio PostgreSQL** (`FOR UPDATE SKIP LOCKED`, índices parciais de idempotência): sem dependência extra (Redis, filas gerenciadas) para o volume de uma clínica.
- **WhatsApp atrás de uma interface** (`WhatsAppProvider`): desenvolvimento e Cloud API são intercambiáveis por variável de ambiente; o modo de desenvolvimento é proibido em produção pela validação do ambiente.
- **Sem atualização automática na tela de conversas:** consultas periódicas manteriam a sessão ativa indefinidamente (contornando o encerramento por inatividade).
- **TypeScript 5.9 e não 7.0** (limite do `typescript-eslint`); **Prisma 7.10 e não 8** (a tag `latest` do CLI aponta para um *release candidate*).
- **`clsx` + `tailwind-merge`**: componentes usam `cn` de `@/lib/utils`; o ESLint acusa o import `cn` que o CLI do shadcn 4 gera. A escala tipográfica própria (`text-title-1`, `text-metric`…) é registrada no `extendTailwindMerge` — sem isso ela era descartada ao lado de uma cor.
- **Identidade Clinni com tema claro e escuro** (direção “Contínuo” da pasta `vsmidia`): tokens semânticos em `src/app/globals.css`, Manrope, contraste AA medido nos dois temas. O tema segue o sistema por padrão e a escolha fica no navegador — sem cookie, para as páginas continuarem pré-renderizáveis. Detalhes e decisões em [`docs/design-system.md`](docs/design-system.md).
- **Variáveis de ambiente via `@next/env`** em Prisma, seed, scripts e testes — a mesma ordem de carregamento do Next.js.
