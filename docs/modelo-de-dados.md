# Modelo de dados

Fonte da verdade: [`prisma/schema.prisma`](../prisma/schema.prisma) e as migrations em [`prisma/migrations/`](../prisma/migrations). Este documento explica o **porquê** das estruturas e as regras que o banco garante.

## Convenções

- Identificadores **UUIDv7** (ordenáveis no tempo).
- Tabelas e colunas em `snake_case` no banco; `camelCase` no código.
- Instantes em `timestamptz` (UTC), exibidos no fuso da clínica (`APP_TIMEZONE`). Datas de calendário (nascimento, data prevista de retorno, início de protocolo) em `date`, sem fuso.
- Telefones em **E.164** (`+5511987654321`), validados por CHECK — permite deduplicar contatos e falar com a API do WhatsApp.
- E-mails sempre em minúsculas (CHECK).
- Valores monetários em **centavos** (inteiros).
- Exclusão física só onde a LGPD pede (lead sem vínculo clínico). Equipe e pacientes são **desativados**, nunca apagados — a auditoria e o histórico dependem deles.

## Mapa das entidades

```
User ─┬─< Session                         (sessões; o banco guarda só o hash do token)
      ├─< AuditLog                        (trilha somente inserção)
      └─< Appointment (profissional)

Lead ──< Interaction >── Patient          (linha do tempo compartilhada após a conversão)
  │  └── patientId (1:1, após a conversão)
  └──< Appointment (avaliação antes de virar paciente)

Patient ─┬─< PatientNote                  (cifradas; CLINICAL ou ADMINISTRATIVE)
         ├─< Appointment ──< AppointmentEvent (histórico)
         ├─< ProcedureRecord              (procedimentos realizados)
         ├─< PatientProtocol ──< PatientReturn ──< Reminder
         ├─< PatientReturn (avulsos)
         └─< WhatsAppConversation ──< WhatsAppMessage (texto cifrado)
                     │                      └── AssistantRun (uma por mensagem recebida)
                     ├─< ConsentEvent        (histórico de consentimento por telefone)
                     └─< StaffTask           (encaminhamentos e avisos à equipe)

Procedure ──< Protocol ─┬─< ProtocolStep  (intervalos definidos pela profissional)
                        └─< FollowUpRule  (etapas de acompanhamento antes do retorno) >── MessageTemplate

KnowledgeEntry ──< KnowledgeEntryVersion  (base do assistente: rascunho → revisão → aprovada)
KnowledgeGap                              (perguntas sem resposta / respostas mal avaliadas)
AssistantSettings                         (configuração única do assistente)
WebhookEvent                              (deduplicação de webhooks, sem payload)
```

## Entidades e regras

### Equipe e acesso
| Tabela | Regras |
| --- | --- |
| `users` | E-mail único em minúsculas. `role` ∈ ADMIN/PROFESSIONAL/RECEPTION para pessoas da equipe; `ASSISTANT` é a **conta de sistema** do assistente virtual (inativa, sem senha válida, recusada no login), usada só para registrar autoria. `must_change_password` marca senha provisória (troca obrigatória). Não podem ser excluídos se houver auditoria (`ON DELETE RESTRICT`). |
| `sessions` | `id` = SHA-256 do token do cookie. Expiração absoluta + inatividade validadas a cada requisição. |
| `login_attempts` | Base do limite de tentativas; apagadas após 90 dias pela rotina de retenção. |
| `audit_logs` | **Somente inserção**: trigger bloqueia `UPDATE`/`DELETE`. `metadata` só aceita valores simples e passa por redação. |

### Comercial
| Tabela | Regras |
| --- | --- |
| `leads` | **Telefone único** (um lead por pessoa). `status` (etapa atual) e `peak_status` (etapa mais avançada já atingida — base do funil por coorte). Perda exige `lost_reason`. `patient_id` único: preenchido na conversão. |
| `interactions` | Ligações, mensagens, e-mails, atendimentos, notas, mudanças de etapa e registros automáticos. CHECK: pertence a um lead, a um paciente ou a ambos. Na conversão, as do lead passam a apontar também para o paciente. |

### Pacientes
| Tabela | Regras |
| --- | --- |
| `patients` | Cadastro mínimo (sem CPF/endereço). Consentimentos com data da última alteração (o histórico fica na auditoria). Telefone pode repetir (ex.: responsável), mas a duplicidade exige confirmação explícita. `is_active` em vez de exclusão. |
| `patient_notes` | Conteúdo **sempre cifrado** na aplicação (AES-256-GCM, `v1:iv:tag:dados`), com o id do paciente como dado autenticado (texto copiado para outro paciente não decifra). `CLINICAL` só para Profissional/Administração, e cada leitura é auditada. |

### Procedimentos, protocolos e retornos
| Tabela | Regras |
| --- | --- |
| `procedures` | Nome único. Duração 5–720 min (padrão da agenda). Preço ≥ 0. `suggested_return_days` 1–3650, **definido pela profissional**. Cor `#RRGGBB` para a agenda. |
| `protocols` / `protocol_steps` | Etapas ordenadas (`position` única por protocolo) com `offset_days` contados do início (`START`) ou da etapa anterior (`PREVIOUS`). |
| `patient_protocols` | Aplicação de um protocolo a um paciente (`ACTIVE`, `COMPLETED`, `CANCELLED` com motivo). |
| `procedure_records` | Procedimento realizado. Criado ao concluir um agendamento com procedimento (um por agendamento — `appointment_id` único) ou manualmente. |
| `patient_returns` | Retorno programado (por etapa de protocolo, por intervalo do procedimento ou avulso): `PENDING → SCHEDULED → COMPLETED/MISSED`, ou `CANCELLED`. `appointment_id` único: no máximo um agendamento atende o retorno. |
| `reminders` | Fila de lembretes e etapas de acompanhamento. `channel` = `WHATSAPP` (modelo aprovado) ou `TASK` (contato manual da equipe). Status `PENDING → PROCESSING → SENT/FAILED`, `CANCELLED` ou `PAUSED` (o paciente respondeu ou a equipe pausou). Índices **parciais únicos**: no máximo um item ativo (`PENDING`/`PROCESSING`/`PAUSED`) por agendamento e por retorno + regra de acompanhamento — idempotência da fila. |
| `follow_up_rules` | Regras do protocolo: N dias antes do retorno, enviar modelo (`MESSAGE`) ou criar tarefa (`TASK`); opcionalmente só para certos tipos de etapa. Sem consentimento (ou modelo de marketing sem consentimento de marketing), a mensagem vira tarefa. |

### Agenda
| Tabela | Regras |
| --- | --- |
| `appointments` | De um paciente **ou** de um lead (CHECK). `ends_at > starts_at` (CHECK). **Sem sobreposição por profissional**: `EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE status NOT IN ('CANCELLED','NO_SHOW')` — horários encostados são permitidos; cancelados e faltas liberam o horário. `rescheduled_from_id` único liga uma remarcação ao original. |
| `appointment_events` | Histórico: criação, reagendamentos (horário anterior e novo), mudanças de status (com motivo) e alterações. |

### WhatsApp
| Tabela | Regras |
| --- | --- |
| `whatsapp_conversations` | Uma por telefone (E.164, único), vinculada ao paciente e/ou lead com o mesmo número. `last_inbound_at` define a janela de 24h. `mode` = `ASSISTANT` (o assistente responde) ou `HUMAN` (equipe); `opted_out_at` marca o descadastro do número; `assistant_state`/`assistant_locked_until` guardam o fluxo em andamento e a reserva que impede duas respostas simultâneas. |
| `whatsapp_messages` | `body` **cifrado** com a `DATA_ENCRYPTION_KEY` (contexto autenticado: a conversa); nulo = conteúdo apagado a pedido do titular. `provider_message_id` único (idempotência dos webhooks) e `idempotency_key` única (envios automáticos nunca duplicam). `origin` = contato, equipe, assistente, lembrete, acompanhamento ou sistema. `provider` registra quem processou (`development` ou `cloud_api`); `SIMULATED` = nada saiu do servidor. Envios automáticos com falha temporária ficam `PENDING` com `attempts`/`next_attempt_at`. |
| `webhook_events` | Chave de deduplicação por evento (`msg:<id>`, `status:<id>:<status>`, `template:…`); **o payload bruto não é armazenado**. Apagados após 90 dias pela rotina de retenção. |
| `message_templates` | Modelos de mensagem da Meta (nome + idioma únicos), com categoria (`UTILITY`/`MARKETING`), uso (lembrete de agendamento, de retorno, acompanhamento) e situação na Meta (atualizada pelo webhook ou pela sincronização). Só modelos `APPROVED` são enviados. |
| `consent_events` | Histórico de consentimento por **telefone** (concedido/revogado, finalidade `WHATSAPP`/`MARKETING`, origem: equipe, palavra-chave do contato ou assistente, evidência). Mantido mesmo após exclusão do lead: é a prova do descadastro (LGPD art. 16, I). |

### Assistente virtual e tarefas
| Tabela | Regras |
| --- | --- |
| `assistant_runs` | Uma execução por mensagem de texto recebida (`inbound_message_id` único: reentregas não geram nova resposta). Fila no banco (`PENDING → PROCESSING → COMPLETED/FAILED/SKIPPED`, reserva com `SKIP LOCKED`). `SKIPPED` + `superseded`: a mensagem foi respondida junto com uma mais nova. Guarda intenção, confiança, resultado, entradas da base usadas e sinais técnicos — nunca o texto. |
| `assistant_settings` | Linha única (`id = 'default'`, CHECK): mensagens, perguntas de qualificação, agendamento pelo assistente, horário e limites de mensagens proativas. Validada na aplicação; alterações auditadas. |
| `knowledge_entries` / `knowledge_entry_versions` | Base de conhecimento com versões: `DRAFT → IN_REVIEW → APPROVED` (ou `REJECTED`); a aprovada anterior vira `SUPERSEDED`. Só a versão publicada (`published_version_id`) é usada nas respostas. Aprovar exige o perfil Profissional ou Administração. |
| `knowledge_gaps` | Perguntas que o assistente não soube responder, respostas bloqueadas pela checagem de segurança e respostas avaliadas negativamente pela equipe. Pergunta mascarada (sem telefone, e-mail, CPF) e cifrada. Uma pendência aberta por mensagem e motivo (índice parcial). |
| `staff_tasks` | Tarefas da equipe: encaminhamento de conversa (`HANDOFF`), oportunidade qualificada, acompanhamento de protocolo e falha de automação. `dedupe_key` com índice parcial único entre as abertas: reprocessamentos não duplicam avisos. |

## Integridade além do Prisma

Restrições que o Prisma não expressa ficam no SQL das migrations: CHECKs (telefones, e-mails, cores, durações, intervalos, preço, contadores da fila, sujeito de interações, agendamentos e lembretes, confiança das execuções, configuração única do assistente), `EXCLUDE` da agenda, índices parciais (fila de lembretes, tarefas abertas, pendências de curadoria) e o trigger da auditoria. Os testes em `tests/integration/database-constraints.test.ts` verificam essas garantias diretamente no banco.

## Conteúdo cifrado

A `DATA_ENCRYPTION_KEY` (AES-256-GCM, formato `v1:iv:tag:dados`) protege três tipos de conteúdo, cada um com seu contexto autenticado: observações dos pacientes (`patient_note:<paciente>`), textos das mensagens do WhatsApp (`whatsapp_message:<conversa>`) e perguntas de curadoria (`knowledge_gap`). Sem a chave, observações não são gravadas; mensagens e perguntas são gravadas sem cifragem (desenvolvimento) e a leitura aceita os dois formatos. A rotação (`npm run data:rotate-key`) recifra os três tipos — veja [operacao.md](operacao.md#rotação-da-data_encryption_key).
