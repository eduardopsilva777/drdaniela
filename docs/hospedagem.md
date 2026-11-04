# Hospedagem — decisão de arquitetura

Situação em 04/11/2026: o build convencional (`npm run build`) passa — TypeScript, geração das 23 rotas e Partial Prerendering. A publicação no Cloudflare Workers falhou durante o empacotamento do OpenNext. Este documento registra o que aconteceu, compara as três opções e recomenda uma.

**Recomendação: Next.js em Node.js convencional (opção A) com PostgreSQL gerenciado.** Nenhuma migração foi feita: os arquivos do Cloudflare continuam no repositório, sem uso, até a clínica decidir.

## O que o deploy no Cloudflare alterou no repositório

O comando automático do Wrangler para projetos Next.js executa `opennextjs-cloudflare migrate`, que grava ([`migrate.js`](../node_modules/@opennextjs/cloudflare/dist/cli/commands/migrate.js)):

| Arquivo | Alteração | Origem |
| --- | --- | --- |
| `wrangler.jsonc`, `open-next.config.ts` | Criados (worker, assets, cache) | Automática |
| `public/_headers` | Criado (cache de `/_next/static`) | Automática |
| `.gitignore` | `.open-next`, `.wrangler`, `.dev.vars*` | Automática |
| `.dev.vars` (ignorado pelo Git) | `NEXTJS_ENV=development` — nenhum segredo | Automática |
| `package.json` | Scripts `preview`, `deploy`, `upload`, `cf-typegen`; dependências `@opennextjs/cloudflare` e `wrangler` | Automática |
| `next.config.ts` | Linha `initOpenNextCloudflareForDev()` no fim do arquivo | Automática |
| `next` `16.4.3 → ^16.4.5` | Exigência do OpenNext (`>=16.4.5`) | Manual (commit `75c1a89`) |
| `src/server/auth/password.ts` | `@node-rs/argon2` (nativo) → `hash-wasm` (WebAssembly) | Manual (commit `75c1a89`) |
| `.open-next/`, `.wrangler/` | Saída do build local (ignorada pelo Git) | Automática |

Correções feitas nesta revisão (sem migrar nada):

- **`next.config.ts`** — a linha automática rodava em todo `next dev`, `next build` e **`next start`**. Em produção Node.js instalada sem dependências de desenvolvimento, a importação de `@opennextjs/cloudflare` falha como rejeição de promise não tratada, o que encerra o processo Node. Agora só roda com `OPENNEXT_CLOUDFLARE_DEV=1` em desenvolvimento, e uma falha vira aviso. O código da aplicação não usa nenhum recurso do Cloudflare (`getCloudflareContext` não aparece em `src/`).
- **`eslint.config.mjs`** — `.open-next/**` e `.wrangler/**` ignorados: o lint analisava o bundle gerado (8.812 apontamentos, todos fora de `src/`).

### Argon2: nativo × WebAssembly

O `hash-wasm` usa o **mesmo algoritmo e os mesmos parâmetros** (Argon2id, m=19456 KiB, t=2, p=1, saída de 32 bytes, sal de 16 bytes) e grava o mesmo formato PHC. A segurança é a mesma. Medido nesta máquina:

| | `@node-rs/argon2` 2.2.2 (nativo) | `hash-wasm` 4.12.0 |
| --- | --- | --- |
| Hash nativo verificado pelo outro | sim | sim |
| Tempo por hash | ~28 ms | ~66 ms |
| 4 logins simultâneos | ~56 ms (em paralelo, fora da thread principal) | ~294 ms (em série, na thread principal) |

Como os dois verificam os hashes um do outro, trocar de biblioteca não invalida senhas cadastradas. Em Node.js, a versão nativa é 2,3× mais rápida e não bloqueia o *event loop* (o WASM bloqueia ~66 ms por login, e logins simultâneos entram em fila). **Sugestão para a opção A:** voltar ao `@node-rs/argon2`. A troca não foi feita porque o pedido foi não migrar automaticamente.

## Comparação

| Critério | A. Node.js + PostgreSQL | B. OpenNext no Workers | C. vinext no Workers |
| --- | --- | --- | --- |
| Estado neste projeto | **Funciona**: build, 300+ testes e `next start` verificados | Empacotamento falhou; nunca executado | Não testado |
| Maturidade | Runtime oficial do Next.js | Adaptador ativo, mas com correções frequentes de compatibilidade com Next 16 (Turbopack, `proxy.ts`) | Experimental: o próprio repositório avisa sobre lacunas, principalmente nas funções novas do App Router |
| Next.js 16 (Cache Components, PPR, `after`, `proxy.ts`) | Suporte completo | `proxy.ts` em Node.js é experimental no adaptador; cache incremental exige configurar R2/D1 | Reimplementação da API do Next sobre Vite (~94% declarado); menos pré-renderização no build |
| Argon2id | Nativo (rápido, fora da thread principal) | Só WASM, que ocupa CPU do isolate a cada login | Só WASM |
| Prisma 7 + PostgreSQL | `@prisma/adapter-pg` com pool no processo | Exige **Hyperdrive** (pool do Cloudflare) e cliente criado por requisição | Igual à B |
| Assistente (IA) e webhook | `after()` executa depois da resposta sem limite de tempo além da reserva da fila | `after()` vira `waitUntil`: **no máximo 30 s depois da resposta**, com o restante cancelado. Uma resposta com IA (tempo limite de 30 s por chamada, novas tentativas, ferramentas) pode passar disso; a fila retomaria pelo cron, com atraso para o paciente | Igual à B |
| Filas e agendador | Cron do sistema/provedor chama `/api/jobs/automation` | Cron Triggers do Workers; precisaria de um handler `scheduled` (não existe no projeto) | Igual à B |
| Webhooks da Meta | Corpo bruto + HMAC funcionam | Funcionam (Web APIs) | Funcionam |
| Segurança e LGPD | Região escolhida (ex.: São Paulo); chaves em variáveis do servidor | Execução distribuída; dados passam pela rede do Cloudflare; segredos no painel do Workers | Igual à B |
| Custo estimado (clínica única) | VPS/contêiner pequeno + PostgreSQL gerenciado: ~US$ 15–40/mês | Workers Paid (US$ 5/mês) + Hyperdrive + PostgreSQL externo (o custo do banco continua) | Igual à B |
| Manutenção | Padrão de mercado; atualizar Node, Next e Prisma | Acompanhar três projetos (Next, OpenNext, Wrangler) e o *workerd*; versões do Next presas ao adaptador | Projeto novo e experimental; risco de divergência a cada versão do Next |

## Arquitetura recomendada (A)

```
WhatsApp Cloud API ──webhook (HMAC)──▶ ┌────────────────────────────┐
Navegador da equipe ──HTTPS────────────▶│ Next.js (next start, Node 22+) │──▶ PostgreSQL gerenciado
Agendador (cron, 1–5 min) ──Bearer─────▶│ /api/jobs/automation          │    (backups diários + PITR)
                                         └──────────────┬─────────────┘
                                                        └──▶ Anthropic API (opcional, AI_PROVIDER=anthropic)
```

- **Aplicação:** um contêiner ou VPS com Node.js 22+ (`npm ci && npm run build && npm start`), atrás de proxy reverso com HTTPS (`TRUST_PROXY=true`). Uma instância basta para uma clínica. Com mais de uma, defina `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`; as filas já são seguras com processadores simultâneos (SKIP LOCKED).
- **Banco:** PostgreSQL 16+ gerenciado, na mesma região, com backups automáticos e recuperação a um ponto no tempo. `npm run db:deploy` aplica as migrations (nunca `migrate dev` em produção).
- **Agendador:** chamar `POST /api/jobs/automation` a cada 1–5 minutos com `Authorization: Bearer $CRON_SECRET` (exemplos em [operacao.md](operacao.md)).
- **Segredos:** variáveis do servidor (nunca no repositório): `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, credenciais da Meta e, se usado, `ANTHROPIC_API_KEY`.
- **Região:** de preferência no Brasil (latência e LGPD). A transferência de dados para a Anthropic, quando ativada, é internacional (LGPD art. 33) e depende de contrato.

Para seguir com a opção A, os arquivos do Cloudflare podem ficar (não interferem: o código não os usa) ou ser removidos em um commit próprio: `wrangler.jsonc`, `open-next.config.ts`, `public/_headers`, os quatro scripts e as duas dependências de desenvolvimento. As dependências também respondem por 4 dos alertas altos do `npm audit` de desenvolvimento (cadeia `glob` do `@opennextjs/aws`); `npm audit --omit=dev` continua sem vulnerabilidades.

## Se a clínica ainda quiser o Cloudflare (B)

Pré-requisitos antes de tentar de novo — nenhum foi implementado:

1. Hyperdrive configurado para o PostgreSQL e um cliente Prisma criado por requisição.
2. Handler `scheduled` (Cron Triggers) chamando o ciclo de automação; não depender de `after()` para o assistente.
3. Cache incremental do OpenNext (R2) configurado e testado com Cache Components.
4. Teste de carga de login com Argon2 em WASM dentro do limite de CPU do plano.
5. Homologação completa (login, agenda, webhooks assinados, fila, exportação LGPD) em ambiente de preview antes de qualquer dado real.

Fontes: [limites de `waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/), [Prisma com Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm/), [notas do OpenNext 1.20](https://github.com/opennextjs/opennextjs-cloudflare/releases/tag/@opennextjs%2Fcloudflare@1.20.3), [repositório do vinext](https://github.com/cloudflare/vinext).
