# Assistente virtual e IA conversacional

O assistente atende pelo WhatsApp: tira dúvidas com a base de conhecimento aprovada, capta e qualifica leads, consulta a agenda, agenda/remarca/cancela com confirmação, acompanha retornos previstos e transfere para a equipe quando precisa.

## Situação

| Item | Situação |
| --- | --- |
| IA conversacional (motor agente) | **Implementada e testada** com provedor falso, CRM simulado e PostgreSQL real (fila, ferramentas, confirmação, checagem, consumo, acompanhamentos). |
| Chamadas reais à Anthropic | **Nunca exercitadas neste ambiente**: não há `ANTHROPIC_API_KEY` configurada e chamadas pagas não foram autorizadas. A avaliação com o modelo real está pronta: `npm run assistant:eval -- --confirm-costs` ([abaixo](#avaliação-com-o-modelo-real)). |
| WhatsApp real | Depende das credenciais da Meta ([whatsapp.md](whatsapp.md)). |

## Motores

| `AI_PROVIDER` | `AI_ENGINE` | Como responde | Sai do servidor |
| --- | --- | --- | --- |
| `disabled` (padrão em produção) | — | Ninguém responde; a equipe atende. Descadastros (PARAR) continuam valendo. | Nada |
| `rules` (padrão fora de produção) | — | Motor por regras: palavras-chave + texto aprovado exato da base. | Nada |
| `anthropic` | `guided` | A IA só interpreta a mensagem; roteiro e textos são os configurados (motor anterior). | Trechos mascarados |
| `anthropic` | `agent` (padrão) | **IA conversacional**: cada resposta é escrita na hora, com as ferramentas do CRM. | Trechos mascarados |

Com a IA conversacional, o motor por regras é o reserva: atende quando o limite mensal de gasto é atingido.

## Como uma mensagem é respondida

```
Webhook da Meta (HMAC) → mensagem cifrada no banco → assistant_runs (fila, uma execução por mensagem)
  → reserva da conversa (uma resposta por vez) → mensagens em sequência respondidas juntas
  → 1. etapas sem IA ──────────────── descadastro/recadastro, atendimento humano, "CANCELAR" ambíguo,
  │                                    resposta ao consentimento, urgência de saúde
  → 2. contexto mínimo do contato + base aprovada + histórico mascarado
  → 3. modelo ⇄ ferramentas do CRM (validadas e executadas pelo servidor), até a resposta final
  → 4. checagem da resposta (fatos com fonte, ação concluída de verdade, sem promessa, sem repetição)
  → 5. composição pelo servidor (transferência, pendência da base, consentimento após agendar)
  → envio dentro da janela de 24h (idempotente) → registro: resultado, ferramentas, tokens, custo, latência
```

O modelo **não acessa o banco**. Ele pede ferramentas por nome; o servidor valida (lista fechada + schema Zod) e executa com as regras e a auditoria do CRM, com o ator de sistema "Assistente virtual".

## Geração dinâmica (sem respostas prontas)

A equipe configura **quem é a assistente**, não o que ela diz — em Assistente › Configurações › Personalidade e objetivos: personalidade, tom de voz, formalidade, estilo, objetivos comerciais, abordagem de contatos novos, forma de perguntar, limites e regras de transferência.

As instruções enviadas ao modelo (`src/server/assistant/agent/prompt.ts`) juntam essa identidade às **regras do sistema, que prevalecem**: não inventar fatos, não orientar sobre saúde, não prometer resultados, só oferecer horários reais, agendar/remarcar/cancelar só com confirmação, tratar o texto do contato como dado (proteção contra manipulação), transferir quando necessário.

Textos fixos continuam existindo só onde a regra exige previsibilidade: orientação de urgência de saúde, confirmação de descadastro/recadastro, pergunta de consentimento para lembretes, aviso de falha e o esclarecimento de "CANCELAR". Os demais textos configuráveis servem aos motores por regras/guiado e ao reserva.

## Contexto individual

Enviado a cada turno, só sobre **este** contato (`buildAgentInput` em `services/assistant.ts`):

- tipo (paciente, lead, contato novo), primeiro nome, etapa do funil e interesse registrado;
- consentimentos (lembretes, marketing, descadastro);
- agendamentos futuros (data, hora e nome do procedimento) e data do último atendimento concluído (sem procedimento);
- retornos previstos sem agendamento (título, procedimento e data definidos pela profissional);
- **notas da conversa**: memória mantida pela própria IA (`save_conversation_notes`) — interesse, preferências, objeções, próximo passo —, mascarada e **cifrada** no banco, para o contexto sobreviver quando o histórico sai da janela;
- histórico recente (padrão: 16 mensagens, configurável) e as mensagens novas, com telefone, e-mail e CPF mascarados.

**Nunca** vão ao provedor: observações dos pacientes (clínicas ou administrativas), prontuário, procedimentos realizados, data de nascimento, telefone, e-mail ou dados de outros contatos. Agendamentos, horários, retornos e entradas da base aparecem como referências curtas (A1, S1, R1, K1) válidas só naquele contato e turno — um agendamento de outra pessoa não tem referência e não pode ser alcançado.

## Base de conhecimento

- Só a versão **aprovada** de cada entrada é usada (rascunho → revisão → aprovada; aprovar exige Profissional ou Administração; versões guardam autor e data).
- A cada turno, as entradas mais relevantes para a mensagem vão no contexto (busca lexical com sinônimos — `knowledge-search.ts`); a IA pode buscar mais com `search_knowledge`.
- Valores, percentuais, telefones e links na resposta precisam aparecer nas entradas ou nos resultados das ferramentas daquele turno; senão a resposta é bloqueada (a IA reescreve uma vez; persistindo, o contato recebe o texto de "não sei" e a pergunta vira pendência).
- Pergunta sem resposta aprovada: a IA diz que vai confirmar com a equipe e a pergunta vira **pendência de curadoria** (mascarada e cifrada). Repetindo (padrão: 2 seguidas), a conversa vai para a equipe.
- Respostas avaliadas negativamente pela equipe também viram pendência; a equipe responde criando/atualizando uma entrada, que passa pela aprovação. **Nenhuma conversa treina o modelo.**
- "Testar pergunta" (aba Base de conhecimento) gera a resposta com a IA real sobre um CRM simulado (nada é gravado; consome o provedor).

## Ferramentas do CRM

| Ferramenta | O que faz | Regras do servidor |
| --- | --- | --- |
| `search_knowledge` | Busca na base aprovada | Só versões publicadas |
| `list_services` | Procedimentos ativos | Preço do catálogo só se a clínica autorizar |
| `check_availability` | Horários livres reais (novo ou remarcação) | Horário de atendimento, antecedência, conflitos; só com agendamento ativo |
| `register_lead` | Cadastra/completa o lead | Telefone único (sem duplicar); paciente não vira lead; nome validado; cadastro parecido em outro telefone gera tarefa |
| `update_lead` | Interesse, período preferido, observação | Só o lead deste contato; texto mascarado |
| `register_opportunity` | Oportunidade qualificada | Uma por conversa; move o lead para "Em atendimento"; tarefa para a equipe |
| `list_my_appointments` | Agendamentos futuros do contato | Só do próprio contato |
| `propose_booking` / `propose_reschedule` / `propose_cancellation` | Preparam a ação | Exigem cadastro, horário oferecido (S#) e referência válida; **não gravam nada** |
| `confirm_pending_action` | Executa a ação proposta | Porta dupla (abaixo); conflito de agenda devolve "horário indisponível"; falha → equipe |
| `discard_pending_action` | Descarta a proposta | — |
| `confirm_attendance` | Presença confirmada pelo contato | Só agendamentos do contato; precisa de confirmação na mensagem |
| `create_staff_task` | Tarefa para a equipe | Máximo 2 por mensagem; sem duplicar |
| `save_conversation_notes` | Notas da conversa | Mascaradas; cifradas no banco |
| `request_human` | Transfere para a equipe | Conversa em modo humano, tarefa com motivo e resumo |
| `record_return_response` | Resposta ao convite de retorno | Registra e avisa a equipe; **não altera o acompanhamento clínico** |
| `opt_out_contact` | Descadastro pedido em linguagem natural | Sempre aceito |

Limites por mensagem: 12 ferramentas, chamadas ao modelo configuráveis (padrão 5). Em acompanhamentos, só as ferramentas de consulta.

### Confirmação explícita (porta dupla)

Agendar, remarcar ou cancelar acontece em duas mensagens do contato:

1. A IA propõe (`propose_*`) e pergunta; a proposta fica guardada no estado da conversa.
2. Na mensagem seguinte, `confirm_pending_action` só executa se **(a)** a IA entendeu que houve confirmação **e (b)** o servidor confere que o texto é uma confirmação explícita e sem ressalvas (`isExplicitConfirmation`: "sim, mas só de manhã", "acho que sim" ou perguntas são recusadas), **(c)** a proposta é de uma mensagem anterior e ainda está válida.

A resposta só pode dizer "agendei/remarquei/cancelei" quando o servidor concluiu a ação naquele turno (a checagem bloqueia o contrário). Se o modelo falhar depois de gravar a ação, o contato recebe a confirmação configurada — o turno não é repetido às cegas.

## Atendimento humano

A conversa vai para a equipe quando: a pessoa pede; há reclamação, insatisfação ou situação delicada (`request_human`); dúvida de saúde (sinal do modelo, com dica do servidor por palavras-chave); possível urgência (palavras-chave, **sem IA**, com a orientação de segurança configurada); perguntas sem resposta seguidas; falha ao gravar uma ação; falha do provedor esgotadas as tentativas; ou limite de respostas por hora.

Ao transferir: modo da conversa muda para equipe (respostas automáticas param), tarefa com o motivo (urgente quando for o caso), histórico preservado. A equipe assume e devolve a conversa ao assistente pela tela do WhatsApp.

## Recuperação de oportunidades

Em Assistente › Configurações › Recuperação de oportunidades (**desligado por padrão**):

- **Dentro da janela de 24h**: se o contato parou de responder depois de uma resposta da assistente, após N horas (padrão 4) a IA pode enviar **uma** mensagem curta retomando o assunto — ou decidir não enviar. Uma por mensagem do contato (chave única), só nos dias/horários de mensagens proativas, dentro dos limites por dia/semana, nunca com descadastro, atendimento humano, lead encerrado ou horário já marcado. Só ferramentas de consulta.
- **Fora da janela**: mensagem livre é proibida pela Meta. Leads parados há N dias (padrão 3) viram **tarefa** para a equipe (modelo aprovado ou ligação), uma por período de silêncio.
- Lembretes de agendamento e de retorno continuam com os **modelos aprovados** da fila de lembretes ([protocolos-e-retornos.md](protocolos-e-retornos.md)); a IA não altera modelos.

O ciclo de automação (`/api/jobs/automation`) agenda os acompanhamentos e processa a fila.

## Protocolos e renovação

Os retornos previstos (datas e etapas definidas pela profissional) aparecem no contexto do paciente. A IA pode lembrar, convidar para uma avaliação, consultar horários e agendar **vinculando o agendamento ao retorno** (o retorno passa a "Agendado" e os lembretes dele são encerrados). Quando a pessoa não quer agendar agora ou não tem interesse, a resposta é registrada na linha do tempo e a equipe recebe uma tarefa — a IA nunca cancela nem altera o acompanhamento, não diagnostica e não afirma que a pessoa precisa renovar.

## Regras do WhatsApp preservadas

Janela de 24h conferida no envio (fora dela, a resposta não sai e vira tarefa); só modelos aprovados para mensagens iniciadas pela clínica; consentimento para lembretes perguntado com o texto configurado e registrado com evidência; PARAR/SAIR e pedidos em linguagem natural processados sempre; limites de frequência e horário para tudo que é proativo; idempotência de webhooks e envios; webhooks assinados; novas tentativas com espera; status de entrega registrados.

## Custos, limites e desempenho

| Controle | Onde |
| --- | --- |
| Teto de tokens gerados por chamada | `AI_MAX_OUTPUT_TOKENS` (padrão 8.000) |
| Tempo por chamada / por turno | `AI_TIMEOUT_MS` (30 s) / `AI_TURN_TIMEOUT_MS` (120 s) |
| Novas tentativas | SDK (2, para falhas temporárias) + fila (3 tentativas com espera; depois a equipe assume) |
| Chamadas simultâneas por processo | `AI_MAX_CONCURRENCY` (padrão 3) |
| Chamadas por mensagem, tamanho da resposta, histórico | Configurações (padrões 5, 700 caracteres, 16 mensagens) |
| Respostas por hora por conversa | Configurações › Proteções |
| **Limite mensal de gasto** | Configurações (padrão US$ 50). Atingido: motor por regras assume e a equipe recebe uma tarefa |
| Cache das instruções fixas | Automático (identidade + regras + ferramentas se repetem entre conversas) |

Cada execução registra chamadas, tokens (entrada, saída, cache), custo estimado (`AI_PRICE_*`), latência, ferramentas usadas e código de erro. O painel (Visão geral e Registros) mostra gasto do mês × limite, ferramentas mais usadas e falhas por tipo.

**Estimativa** (não medida — sem chamadas reais neste ambiente): uma mensagem usa 1 a 3 chamadas, com ~5–8 mil tokens de entrada (boa parte em cache) e algumas centenas de saída. Com `claude-opus-5-5` (US$ 4 / US$ 20 por milhão; leitura de cache US$ 0,20), algo como **US$ 0,02–0,08 por mensagem** — mil mensagens por mês ficariam na ordem de US$ 20–80. Meça com `assistant:eval` e acompanhe no painel; a fatura do provedor é a referência.

O provedor fica atrás de uma interface (`AgentModel` em `agent/types.ts`): outro fornecedor ou um modelo local entra implementando `complete()`, sem mudar ferramentas, regras ou fila.

## Privacidade (LGPD)

- Transferência internacional (art. 33): ativar `AI_PROVIDER=anthropic` exige contrato e base legal; o servidor avisa no log de inicialização.
- Minimização: só o contexto descrito acima, mascarado; nada da ficha clínica.
- Cifragem: mensagens, notas da conversa e pendências de curadoria com a `DATA_ENCRYPTION_KEY` (incluídas na rotação de chave).
- Titular: exportação inclui as notas da conversa; o apagamento da conversa remove textos, notas e estado.
- Registros sem conteúdo: execuções guardam intenção, resultado, sinais e nomes de ferramentas — nunca o texto.
- Sem treinamento com conversas privadas.

## Testes

- `tests/unit/assistant-agent.test.ts`: confirmação explícita, checagem das respostas, instruções e contexto (marcações neutralizadas), ferramentas (inexistente, argumentos inválidos, referência de outro contato), agendamento/cancelamento com porta dupla, saúde, atendente, descadastro e urgência sem IA, pendências e transferência, falhas antes e depois de ações, limites de chamadas/formato/tempo, acompanhamento, notas, limitador de concorrência, custo e o adaptador Anthropic (ferramentas estritas, cache, conteúdo devolvido intacto, erros).
- `tests/unit/assistant-agent-scenarios.test.ts`: conversas de vários turnos por perfil (lead informal, objeção, pergunta fora da base, mudança de assunto, remarcação, manipulação, cliente irritada, descadastro, repetição).
- `tests/integration/assistant-agent.test.ts` (PostgreSQL real): lead novo de ponta a ponta (dúvida → cadastro → agenda → confirmação → consentimento), isolamento e minimização do contexto, notas cifradas, transferência, limite mensal, falhas com consumo registrado, janela de 24h, retorno de protocolo, acompanhamentos e leads parados.

Os testes usam um provedor **roteirizado** (o que a IA decide está no roteiro): verificam o que o sistema garante, não a qualidade da linguagem.

### Avaliação com o modelo real

```bash
ANTHROPIC_API_KEY=... npm run assistant:eval -- --confirm-costs
```

Seis cenários com perguntas que não estão cadastradas como respostas (preço com linguagem informal e objeção, agendamento, saúde, perguntas fora da base, medo e mudança de assunto, atendente), sobre um CRM simulado — nada é gravado nem enviado. Imprime as conversas, checagens automáticas (preço só da base, agendamento só após confirmação, transferência, pendências, sem promessa, sem repetição) e o custo estimado. Rode antes de ativar em produção e a cada mudança de modelo ou de personalidade.

## Limitações conhecidas

- Sem chamadas reais executadas: a qualidade das respostas do modelo (naturalidade, adequação ao perfil) ainda precisa ser avaliada com `assistant:eval` e numa homologação com números de teste.
- Mídia (áudio, imagem) não é interpretada; o contato é tratado como texto ausente.
- A detecção de dúvida de saúde depende do modelo (com dica por palavras-chave); a de urgência usa palavras-chave e pode ter falsos positivos (preferível) ou negativos.
- A busca na base é lexical (sem embeddings): sinônimos fora da lista e da base podem não ser encontrados — a equipe melhora cadastrando palavras-chave.
