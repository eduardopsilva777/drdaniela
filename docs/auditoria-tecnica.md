# Auditoria técnica — preparação para produção (02/11/2026)

Escopo: todo o conjunto de alterações não commitadas (etapas 2–8), segurança da aplicação e prontidão operacional. Sem funcionalidades novas: as mudanças abaixo corrigem riscos ou dão suporte à operação (rotação de chave, avisos de configuração).

Escala: **Crítica** (exploração imediata, dano grave) · **Alta** · **Média** · **Baixa** · **Informativa**.

**Resultado:** nenhum achado crítico ou alto. Cinco médios (quatro corrigidos, um operacional pendente na hospedagem), oito baixos corrigidos e itens informativos documentados.

## Achados

| # | Severidade | Achado | Situação |
| --- | --- | --- | --- |
| 1 | Média | **Dados pessoais podiam chegar aos logs de produção.** O Prisma, com `log: ["error"]`, imprime erros por conta própria, fora da redação (erros de validação incluem os argumentos da consulta); e mensagens de restrição do PostgreSQL repetem a linha (`Failing row contains (…nome…)`, `Key (phone)=(…)`), com nomes que a redação não mascarava. | **Corrigido:** Prisma sem saída própria e `errorFormat: "minimal"` em produção; redação omite os valores das mensagens de restrição (testado com CHECK, UNIQUE e EXCLUDE). |
| 2 | Média | **Chave de cifragem das observações sem caminho de rotação.** Um vazamento da `DATA_ENCRYPTION_KEY` não podia ser corrigido sem perder a leitura de todas as observações. | **Corrigido:** leitura com chave anterior (`DATA_ENCRYPTION_KEY_PREVIOUS`) e `npm run data:rotate-key` (simulação por padrão, atualização condicional, nunca altera nota ilegível, auditado). Procedimento em [operacao.md](operacao.md#rotação-da-data_encryption_key). |
| 3 | Média | **Troca de senha sem limite de tentativas.** Uma sessão sequestrada permitia testar a senha atual sem limite (para tomar a conta). | **Corrigido:** mesmo limite do login (5 falhas/15 min por e-mail; por IP com `TRUST_PROXY`), falhas auditadas e contadas também para o login. |
| 4 | Média | **Testes de integração apagam o banco de `TEST_DATABASE_URL`** (TRUNCATE em todas as tabelas) com uma única trava (“diferente de `DATABASE_URL`”). Uma configuração errada em CI apontando para produção destruiria os dados. | **Corrigido:** recusa bancos sem “test” no nome e `NODE_ENV=production` (na preparação global e em cada arquivo). |
| 5 | Média | **Fila de lembretes sem agendador.** O endpoint existe, mas nada o chama em produção: nenhum lembrete seria processado automaticamente. | **Documentado** (crontab, systemd, Vercel, GitHub Actions) e **aviso na inicialização** sem `CRON_SECRET`. **Pendente:** configurar na hospedagem. |
| 6 | Baixa | Exportação de dados do paciente (GET autenticado por cookie) podia ser disparada por um link de outro site clicado pela administração (download + registro de exportação indevido). | **Corrigido:** navegações de outros sites são recusadas (`Sec-Fetch-Site`). |
| 7 | Baixa | Assinatura do webhook calculada sobre o texto já decodificado, não sobre os bytes recebidos. | **Corrigido:** HMAC sobre os bytes brutos (testado com acentos). |
| 8 | Baixa | O servidor de desenvolvimento imprimia os argumentos das Server Actions no terminal (texto de mensagens, buscas por nome, motivos de cancelamento). | **Corrigido:** `logging.serverFunctions: false`. Senhas nunca apareceram (FormData é impresso como `{}`). |
| 9 | Baixa | O seed cria contatos fictícios com consentimento de WhatsApp e telefones de formato válido, que podem pertencer a pessoas reais; com a API oficial configurada nesse banco, lembretes iriam a terceiros. | **Corrigido:** o seed recusa `WHATSAPP_PROVIDER=cloud_api`; homologar em banco separado ([whatsapp.md](whatsapp.md)). |
| 10 | Baixa | `npm run db:reset` usava `--force` (apaga o banco sem confirmação). | **Corrigido:** o Prisma pede confirmação. |
| 11 | Baixa | CLI `shadcn` em `dependencies` (só o CSS dele é usado, no build): 6 alertas do `npm audit` na árvore de produção. | **Corrigido:** movido para `devDependencies`; `npm audit --omit=dev`: 0 vulnerabilidades. |
| 12 | Baixa | Conversão de formulário aceitava chaves `__proto__`/`constructor` (sem impacto explorável encontrado; defesa em profundidade). | **Corrigido** e testado. |
| 13 | Baixa | Teste de redação usava um e-mail com aparência de real (`@gmail.com`). | **Corrigido** (domínio de exemplo). |
| 14 | Informativa | Código sem uso e duplicado: 6 exports sem referência, helper de query string repetido em 4 arquivos, lista de tipos de interação em 3 lugares, relógio divergente em uma action. | **Corrigido.** Componentes de UI sem uso — `scroll-area`, `switch`, `tabs`, `toggle-group`, `toggle` (novos) e `alert`, `badge`, `breadcrumb`, `card` (etapa 1) — **mantidos**: excluir arquivos não rastreados é irreversível e depende da sua autorização. |
| 15 | Informativa | A migration `20261031180000_crm_modules` remove `lead_interactions`, `return_reminders` e `patients.archived_at` (este depois de migrado para `is_active`). | **Sem perda:** o código da etapa 1 nunca gravou nessas tabelas. Só exigiria cuidado em um ambiente com dados inseridos manualmente nelas. Schema e banco conferidos sem *drift*. |
| 16 | Informativa | 19 alertas moderados do `npm audit` em ferramentas de desenvolvimento (cadeia do ESLint/shadcn). | Não vão para produção; acompanhar atualizações (as correções propostas pelo npm são *breaking*). |
| 17 | Informativa | CSP com `'unsafe-inline'` em scripts (exigência do Partial Prerendering). | Risco residual aceito (etapa 1); nenhum HTML injetado com dados foi encontrado e o React escapa todo o conteúdo. |
| 18 | Informativa | Isolamento por perfil, não por profissional: quem tem acesso a pacientes vê todos. | Decisão de produto para clínica única; observações clínicas seguem restritas e auditadas. |

## Verificado sem achados

- **Segredos:** nenhuma chave, token ou credencial real nos arquivos versionáveis; `.env*` ignorado (exceto o exemplo, com valores de desenvolvimento documentados).
- **Dados pessoais:** só dados fictícios (domínio `.test`, sobrenome “Demo”) em seed e testes.
- **Arquivos temporários/binários:** nenhum no conjunto a commitar.
- **Autenticação e sessões:** token de 256 bits (banco guarda o SHA-256), cookie `__Host-`/`HttpOnly`/`SameSite=Lax`/`Secure`, expiração absoluta e por inatividade, invalidação ao desativar conta, redefinir ou trocar senha, proteção contra *open redirect* e enumeração de contas.
- **Autorização:** das 42 Server Actions, 39 passam por `runAction` (sessão + permissão) e as de login, logout e troca da própria senha têm checagem própria; as 31 consultas exigem a permissão junto ao dado; os serviços conferem de novo. Arquivos `"use server"` só exportam funções assíncronas (e tipos).
- **Entradas:** todas as actions validam com Zod (IDs como UUID, limites de tamanho); consultas SQL cruas usam *tagged templates* parametrizados.
- **CSRF:** Server Actions com verificação de origem do Next.js; rotas sem cookie usam assinatura (webhook) ou segredo (cron).
- **XSS:** nenhum `dangerouslySetInnerHTML` com dados (o único é o estilo estático do gráfico); links dinâmicos só com UUIDs/datas; nenhum `target=_blank`.
- **Webhooks:** HMAC em tempo constante, limite de 1 MB, deduplicação por evento, reprocessamento só do que falhou, payload não armazenado.
- **Migrations:** schema válido e idêntico ao banco migrado.

# Consolidação de 04/11/2026

Revisão do que foi commitado em `7a2797b` (fila do assistente, rotação completa da chave, decifragem na ficha e na exportação, leitura do webhook limitada a 1 MB, remarcação/cancelamento concorrentes, bloqueio de reenvio de texto apagado/ilegível) e em `75c1a89` (deploy no Cloudflare). As correções do `7a2797b` foram conferidas no código e cobertas pelos testes existentes (307 na linha de base, todos passando).

| # | Severidade | Achado | Situação |
| --- | --- | --- | --- |
| 19 | Alta | `next.config.ts` importava `@opennextjs/cloudflare` (dependência de desenvolvimento) em todo `next dev`/`build`/`start`. Em produção Node.js sem dependências de desenvolvimento, a importação falha como rejeição não tratada, o que pode encerrar o processo; com elas instaladas, o simulador do Cloudflare (workerd) era iniciado dentro do servidor de produção. | **Corrigido:** só com `OPENNEXT_CLOUDFLARE_DEV=1` em desenvolvimento, com falha tratada. |
| 20 | Média | `npm run lint` falhava (8.812 apontamentos) por analisar o bundle gerado em `.open-next/`. | **Corrigido:** `.open-next/**` e `.wrangler/**` ignorados. |
| 21 | Média | Argon2id trocado de `@node-rs/argon2` (nativo) para `hash-wasm` para o Workers. Mesmo algoritmo e parâmetros (hashes compatíveis nos dois sentidos, verificado), porém ~2,3× mais lento e executado na thread principal (logins simultâneos em fila). | **Documentado** em [hospedagem.md](hospedagem.md) com a recomendação de voltar ao nativo na hospedagem Node.js (não alterado: decisão da clínica). |
| 22 | Média | Deploy no Workers sem validação: empacotamento falhou; `after()` limitado a 30 s (`waitUntil`) não comporta o atendimento com IA; Prisma exigiria Hyperdrive. | **Documentado** ([hospedagem.md](hospedagem.md)); recomendação: Node.js. README corrigido (não descreve mais o deploy no Workers como funcional). |
| 23 | Baixa | A checagem de identidade não reconhecia "Dra." com ponto ("Aqui é a Dra. Daniela"). | **Corrigido** e testado (vale para os motores guiado e agente). |
| 24 | Informativa | `npm audit` (desenvolvimento): 4 altos e 19 moderados nas cadeias do `shadcn`, ESLint e `@opennextjs/cloudflare`; produção sem vulnerabilidades. | Acompanhar; as correções propostas pelo npm são *breaking*. |

Validação final: lint, typecheck, 375 testes (unitários + integração com PostgreSQL), migrations sem *drift*, `npm audit --omit=dev` sem vulnerabilidades, build de produção e verificação visual (sem rolagem horizontal) em 390, 768 e 1440 px.
