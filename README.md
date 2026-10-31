# CRM — Dra. Daniela Zilioli

Sistema interno de gestão da clínica de estética: leads, pacientes, agenda, protocolos de retorno e, futuramente, mensagens pelo WhatsApp Business.

## Situação do projeto

O sistema é entregue em etapas. Uma etapa só é marcada como concluída quando funciona de ponta a ponta — telas apenas ilustrativas não contam.

| Etapa | Escopo | Situação |
| --- | --- | --- |
| 1 | Fundação: estrutura, design system, layout, banco de dados, autenticação, perfis de acesso, auditoria | **Concluída** |
| 2 | Leads e funil comercial | Planejada |
| 3 | Pacientes (ficha, históricos, observações clínicas restritas) | Planejada |
| 4 | Agenda (visões diária/semanal, status, conflitos) | Planejada |
| 5 | Protocolos e retornos | Planejada |
| 6 | Indicadores do dashboard | Planejada |
| 7 | WhatsApp (arquitetura para a API oficial) | Planejada |
| 8 | LGPD e gestão da equipe | Planejada |

**O que já funciona (etapa 1):** login com e-mail e senha, sessões seguras, perfis de acesso, trilha de auditoria (com tela para a administração), layout responsivo com navegação, dashboard inicial, health check e scripts de gestão de contas. O **modelo de dados completo do MVP** já está no banco (com as restrições de integridade), mas os módulos de leads, pacientes, agenda, protocolos e WhatsApp ainda **não** têm telas nem operações — suas páginas dizem isso explicitamente.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Framework | Next.js 16.4 (App Router, Cache Components, Turbopack) + React 19.3 |
| Linguagem | TypeScript 5.9 (modo estrito) |
| Interface | Tailwind CSS 4.3 + shadcn/ui 4 (base Radix, estilo Nova) |
| Banco | PostgreSQL 18 + Prisma ORM 7.10 (driver adapter `pg`) |
| Validação | Zod 4 |
| Senhas | Argon2id (`@node-rs/argon2`) |
| Testes | Vitest 5 (unitários e de integração com PostgreSQL real) |

## Requisitos

- Node.js **22.12 ou superior** (desenvolvido com Node 24 LTS) e npm 10+
- Docker (para o PostgreSQL local) — ou um PostgreSQL próprio com a extensão `btree_gist` disponível (testado com a versão 18)

## Como rodar localmente

```bash
# 1. Dependências (também gera o Prisma Client)
npm install

# 2. Variáveis de ambiente
cp .env.example .env            # PowerShell: Copy-Item .env.example .env

# 3. Banco de dados (cria os bancos crm_dev e crm_test)
npm run db:up

# 4. Migrations e dados FICTÍCIOS de desenvolvimento
npm run db:migrate
npm run db:seed

# 5. Aplicação
npm run dev
```

Acesse <http://localhost:3000>. Contas fictícias criadas pelo seed (senha = `SEED_USER_PASSWORD` do `.env`):

| Perfil | E-mail |
| --- | --- |
| Administração | `admin@demo.test` |
| Profissional | `profissional@demo.test` |
| Recepção | `recepcao@demo.test` |

Os dados de desenvolvimento usam o domínio reservado `.test` e o sobrenome "Demo". Em desenvolvimento, o cabeçalho exibe "Desenvolvimento: dados fictícios". O seed se recusa a rodar com `NODE_ENV=production`.

> **npm 11 e scripts de instalação:** o npm 11 só executa scripts de instalação de pacotes aprovados. Os necessários (Prisma, esbuild, unrs-resolver) já estão aprovados em `allowScripts` no `package.json`. Se o npm avisar sobre um pacote novo, revise com `npm install-scripts ls` antes de aprovar.

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
| `npm run db:reset` | Recria o banco de desenvolvimento do zero e roda o seed |
| `npm run db:studio` | Prisma Studio |
| `npm run user:create` | Cria uma conta da equipe (ver abaixo) |
| `npm run user:reset-password` | Redefine a senha e encerra as sessões da pessoa |

### Contas da equipe em ambientes reais

Até a etapa 8 (gestão de usuários na interface), contas são criadas pela linha de comando. A senha é digitada sem eco e validada pela política (mínimo de 12 caracteres, sem senhas óbvias). Toda operação é auditada.

```bash
npm run user:create -- --email daniela@clinica.com.br --name "Daniela Zilioli" --role ADMIN
npm run user:reset-password -- --email daniela@clinica.com.br
```

Perfis: `ADMIN` (administração), `PROFESSIONAL` (profissional de saúde), `RECEPTION` (recepção/atendimento).

## Variáveis de ambiente

Todas são validadas com Zod na inicialização do servidor (`src/instrumentation.ts`); se algo estiver errado, o servidor não sobe e a mensagem lista apenas os **nomes** das variáveis, nunca os valores.

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
| `SEED_USER_PASSWORD` | seed | Senha das contas fictícias de desenvolvimento |

## Arquitetura

```
src/
├── app/
│   ├── (auth)/login/        Tela de login (formulário + Server Action)
│   ├── (app)/               Área autenticada: layout com barra lateral e páginas dos módulos
│   ├── api/health/          Health check (consulta o banco)
│   └── globals.css          Tokens do design system
├── components/
│   ├── ui/                  Componentes shadcn/ui
│   ├── layout/              Barra lateral, cabeçalho, páginas, estados vazios
│   └── brand/               Monograma
├── lib/                     Código isomórfico: permissões, validação, formatação, catálogo de módulos
├── server/                  Código exclusivo do servidor
│   ├── auth/                Senhas, tokens, sessões, limite de login, DAL, Server Actions
│   ├── db/                  Prisma Client
│   ├── queries/             Consultas com autorização embutida
│   ├── audit.ts             Trilha de auditoria
│   ├── env.ts               Variáveis de ambiente (Zod)
│   └── logger.ts            Logs estruturados com redação
├── generated/prisma/        Prisma Client gerado (não versionado)
├── instrumentation.ts       Validação de ambiente na inicialização e log de erros
└── proxy.ts                 Redirecionamento otimista para o login
prisma/                      Schema, migrations e seed
scripts/                     Gestão de contas pela linha de comando
tests/                       unit/ e integration/
```

**Fluxo de uma requisição autenticada**

1. `proxy.ts` verifica apenas se existe o cookie de sessão (checagem otimista) e, se não existir, redireciona para `/login?next=…`.
2. A página entrega imediatamente o HTML estático (barra lateral, títulos, esqueletos) — *Partial Prerendering*.
3. Cada parte que depende do usuário roda dentro de `<Suspense>` e chama a **DAL** (`src/server/auth/dal.ts`), que valida a sessão no banco **a cada requisição** e então busca os dados.
4. Server Actions repetem a validação e a checagem de permissão — nunca confiam no que a interface escondeu.

A validação de sessão chama `connection()`: com o *Partial Prefetching* do Next.js 16, rotas que leem cookies poderiam ter conteúdo autenticado pré-renderizado e guardado no navegador; aqui, sessão e dados protegidos só são resolvidos na requisição real.

## Segurança e LGPD

### Autenticação
- Senhas com **Argon2id** (m = 19 MiB, t = 2, p = 1 — mínimo da OWASP), com *rehash* automático se os parâmetros forem endurecidos.
- **Sessões no banco**: o cookie guarda um token aleatório de 256 bits; o banco guarda só o **SHA-256** do token.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção.
- Expiração absoluta (12 h) e por inatividade (2 h); usuários desativados perdem a sessão imediatamente.
- **Limite de tentativas**: 5 falhas por e-mail em 15 min bloqueiam novas tentativas; por IP (20 falhas) quando `TRUST_PROXY=true`.
- Mesma resposta e tempo equivalente para e-mail inexistente, senha errada e usuário desativado (sem enumeração de contas). O motivo real fica só na auditoria.
- Destino pós-login validado contra *open redirect*. Server Actions têm a verificação de origem (CSRF) do Next.js.

### Autorização (RBAC)

| Permissão | Recepção | Profissional | Administração |
| --- | :---: | :---: | :---: |
| Leads, pacientes, agenda, retornos, WhatsApp | ✓ | ✓ | ✓ |
| Excluir leads, arquivar pacientes, configurar procedimentos/protocolos | | ✓ | ✓ |
| Observações clínicas | | ✓ | ✓ |
| Auditoria e gestão de contas | | | ✓ |

As permissões ficam em `src/lib/auth/permissions.ts` e são verificadas **no servidor** (`requirePermission` nas Server Actions, `checkPermission` nas páginas, e dentro das funções de consulta). Atribua `ADMIN` apenas à responsável técnica/gestora da clínica.

### Auditoria
- Registra entradas, saídas, tentativas sem sucesso, bloqueios, acessos negados, criação de contas e redefinição de senhas — com autor, data, IP e agente do navegador.
- **Não registra conteúdo** de dados pessoais ou clínicos: o campo `metadata` aceita só valores simples e passa por redação.
- **Somente inserção**: um *trigger* no banco impede `UPDATE` e `DELETE` na tabela `audit_logs`; contas com histórico não podem ser excluídas (apenas desativadas).

### Logs
Logs estruturados (JSON em produção) com redação automática: chaves sensíveis (senha, token, cookie, telefone, e-mail, conteúdo…) são substituídas e textos livres têm e-mails, telefones e CPFs mascarados — inclusive mensagens de erro do banco, que podem repetir valores da linha que falhou. Consultas de busca (query string) não são registradas.

### Cabeçalhos HTTP
CSP restritiva, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `X-Robots-Tag: noindex` e HSTS (em HTTPS). A CSP usa `'unsafe-inline'` para scripts porque CSP com *nonce* é incompatível com o *Partial Prerendering*; as demais diretivas não permitem nenhuma origem externa.

### Minimização de dados
- O cadastro não pede CPF, endereço nem documentos — apenas o necessário para o atendimento.
- Consentimento para WhatsApp registrado com data (`whatsappOptIn`/`whatsappOptInAt`), exigido pela política do WhatsApp e pela LGPD.
- Webhooks do WhatsApp serão registrados **sem o payload bruto**.
- Planejado: cifragem das observações clínicas na aplicação (etapa 3); exportação, anonimização e rotinas de retenção (etapa 8).

O sistema **não gera diagnósticos nem recomendações clínicas**: os intervalos de retorno são definidos pela profissional, e o sistema apenas calcula datas a partir deles.

## Banco de dados

O schema (`prisma/schema.prisma`) cobre todo o MVP: equipe, sessões, auditoria, leads e interações, pacientes e observações, procedimentos, protocolos e etapas, protocolos do paciente, procedimentos realizados, lembretes de retorno, agendamentos e a estrutura de WhatsApp (conversas, mensagens, eventos de webhook).

Restrições que o Prisma não expressa estão no SQL da migration inicial:
- **Agenda sem conflitos**: `EXCLUDE USING gist` impede dois agendamentos ativos sobrepostos para o mesmo profissional (cancelados não bloqueiam; horários encostados são permitidos).
- Término posterior ao início; todo agendamento ligado a paciente ou lead.
- Telefones em E.164, e-mails da equipe em minúsculas, cores e durações válidas.
- Trigger de auditoria somente inserção.

Datas e horas ficam em `timestamptz` (UTC) e são exibidas no fuso da clínica.

## Testes

- **Unitários** (`tests/unit`): hash de senhas, tokens, permissões, proteção de redirecionamento, validações, redação de logs, variáveis de ambiente, IP do cliente, formatação de datas no fuso da clínica.
- **Integração** (`tests/integration`, PostgreSQL real): ciclo de vida das sessões (expiração, inatividade, desativação), fluxo completo de login com limite de tentativas, auditoria somente inserção, agenda sem conflitos e demais restrições do banco.

## Produção

1. Configure as variáveis de ambiente (veja a tabela acima), com `APP_URL` em `https://`.
2. `npm ci && npm run build`
3. `npm run db:deploy` — aplica as migrations
4. `npm run user:create -- --email … --name "…" --role ADMIN` — primeira conta
5. `npm start` (ou a plataforma de hospedagem). Monitore `GET /api/health`.

Atrás de um proxy reverso que acrescenta o IP do cliente ao `X-Forwarded-For` (Nginx, Caddy, a maioria das plataformas), defina `TRUST_PROXY=true`. Em produção use sempre HTTPS: o cookie de sessão exige conexão segura.

## Decisões técnicas

- **TypeScript 5.9 e não 7.0**: o `typescript-eslint` (usado pelo `eslint-config-next`) ainda só suporta TypeScript < 6.1.
- **Prisma 7.10 e não 8**: no npm, a tag `latest` do CLI aponta para um *release candidate* da versão 8; o Prisma Client estável é o 7.10.
- **`clsx` + `tailwind-merge`**: o shadcn 4 passou a gerar `import { cn } from "cn"`, um pacote ainda em 0.x. Os componentes usam `cn` de `@/lib/utils`, e o ESLint acusa o import antigo se o CLI do shadcn o gerar de novo.
- **Somente tema escuro**: identidade visual definida para a clínica (grafite, preto e rosé), sem alternância de tema.
- **Variáveis de ambiente via `@next/env`** em Prisma, seed, scripts e testes — a mesma ordem de carregamento do Next.js.
