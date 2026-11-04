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
         └─< WhatsAppConversation ──< WhatsAppMessage

Procedure ──< Protocol ──< ProtocolStep   (intervalos definidos pela profissional)

WebhookEvent                              (deduplicação de webhooks, sem payload)
```

## Entidades e regras

### Equipe e acesso
| Tabela | Regras |
| --- | --- |
| `users` | E-mail único em minúsculas. `role` ∈ ADMIN/PROFESSIONAL/RECEPTION. `must_change_password` marca senha provisória (troca obrigatória). Não podem ser excluídos se houver auditoria (`ON DELETE RESTRICT`). |
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
| `reminders` | Fila de lembretes (WhatsApp). Índices **parciais únicos**: no máximo um lembrete ativo (`PENDING`/`PROCESSING`) por retorno e por agendamento — idempotência da fila. |

### Agenda
| Tabela | Regras |
| --- | --- |
| `appointments` | De um paciente **ou** de um lead (CHECK). `ends_at > starts_at` (CHECK). **Sem sobreposição por profissional**: `EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE status NOT IN ('CANCELLED','NO_SHOW')` — horários encostados são permitidos; cancelados e faltas liberam o horário. `rescheduled_from_id` único liga uma remarcação ao original. |
| `appointment_events` | Histórico: criação, reagendamentos (horário anterior e novo), mudanças de status (com motivo) e alterações. |

### WhatsApp
| Tabela | Regras |
| --- | --- |
| `whatsapp_conversations` | Uma por telefone (E.164, único), vinculada ao paciente e/ou lead com o mesmo número. `last_inbound_at` define a janela de 24h. |
| `whatsapp_messages` | `provider_message_id` único (idempotência dos webhooks). `provider` registra quem processou (`development` ou `cloud_api`); `SIMULATED` = nada saiu do servidor. |
| `webhook_events` | Chave de deduplicação por evento (`msg:<id>`, `status:<id>:<status>`); **o payload bruto não é armazenado**. |

## Integridade além do Prisma

Restrições que o Prisma não expressa ficam no SQL das migrations: CHECKs (telefones, e-mails, cores, durações, intervalos, preço, contadores da fila, sujeito de interações e agendamentos), `EXCLUDE` da agenda, índices parciais da fila e o trigger da auditoria. Os testes em `tests/integration/database-constraints.test.ts` verificam essas garantias diretamente no banco.
