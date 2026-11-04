# Protocolos, retornos e lembretes

Código: [`src/server/services/care-plan.ts`](../src/server/services/care-plan.ts), [`src/lib/protocol-schedule.ts`](../src/lib/protocol-schedule.ts), [`src/server/services/reminders.ts`](../src/server/services/reminders.ts). Testes: [`tests/integration/care-plan.test.ts`](../tests/integration/care-plan.test.ts), [`tests/integration/reminders.test.ts`](../tests/integration/reminders.test.ts), [`tests/unit/crm-lib.test.ts`](../tests/unit/crm-lib.test.ts).

> **Sem recomendação clínica.** Intervalos de retorno e etapas de protocolos são definidos pela profissional responsável. O sistema apenas faz aritmética de datas com esses valores.

## Protocolos (catálogo)

Cadastro em **Protocolos e retornos → Protocolos** (perfis Profissional e Administração):

- Nome, procedimento relacionado, descrição administrativa e etapas ordenadas.
- Cada etapa: nome, tipo (sessão, revisão, manutenção) e intervalo em dias contado **do início** do protocolo ou **da etapa anterior**.
- Editar vale para novas aplicações; retornos já programados mantêm suas datas. Desativar tira o protocolo das novas aplicações sem afetar as existentes.

## Aplicação ao paciente

Na ficha do paciente (aba **Protocolos e retornos**):

1. Escolha o protocolo e a **data de início**. Opcionalmente, registre o procedimento inicial como realizado (somente datas até hoje).
2. Um retorno é criado para cada etapa:
   - “após o início”: `início + intervalo`
   - “após a etapa anterior”: `data prevista da etapa anterior + intervalo`
3. Para pacientes que autorizaram o WhatsApp, cada retorno futuro recebe um lembrete.

Exemplo (início 02/11/2026; etapas +30 do início, +15 da anterior, +180 do início): 02/12/2026, 17/12/2026 e 01/05/2027.

**Recálculo:** quando uma etapa é realizada em data diferente da prevista, as etapas seguintes encadeadas (“após a etapa anterior”) que ainda estão pendentes são recalculadas a partir da data real. Etapas contadas do início não mudam.

O protocolo é **concluído automaticamente** quando não restam retornos em aberto, e pode ser **cancelado** com motivo (cancela retornos pendentes e seus lembretes; retornos já agendados continuam na agenda).

## Retornos

| Situação | Significado | Como muda |
| --- | --- | --- |
| Pendente | Aguardando contato/agendamento | Criação; nova data; agendamento cancelado |
| Agendado | Há um agendamento para ele | Agendar pelo retorno (ou vincular na criação do agendamento) |
| Compareceu | Realizado | Concluir o agendamento, ou registrar manualmente (com a data) |
| Não compareceu | Faltou | Falta no agendamento, ou registro manual; pode receber nova data (volta a Pendente) |
| Cancelado | Não será feito | Manualmente ou pelo cancelamento do protocolo |

- Retornos **agendados** só são resolvidos pela agenda, para agenda e retorno nunca divergirem.
- Retornos avulsos: manualmente na ficha, ou ao registrar um procedimento realizado cujo cadastro tem “intervalo de retorno” (a profissional define o intervalo no procedimento).
- A aba **Retornos** da página reúne a fila de trabalho de todos os pacientes: atrasados, próximos 14 dias, pendentes e resolvidos, com busca por paciente e as mesmas ações da ficha. Pacientes sem autorização de WhatsApp aparecem com o aviso “contato manual”.

## Fila de lembretes

Cada lembrete registra paciente, procedimento, data prevista de envio, canal, status, data de envio, tentativas e o último erro (já sem dados pessoais).

| Estado | Significado |
| --- | --- |
| Pendente | Aguardando o horário de envio (ou a próxima tentativa) |
| Processando | Reservado por um processador da fila |
| Enviado | Aceito pelo provedor — ou **simulado** no modo de desenvolvimento (marcado como tal) |
| Falhou | Tentativas esgotadas ou erro definitivo (ex.: número sem WhatsApp, modelo não configurado) |
| Cancelado | Retorno/agendamento resolvido ou alterado, consentimento revogado, paciente inativado ou pela equipe |

Regras:

- **Só para quem autorizou mensagens pelo WhatsApp** e está ativo. Revogar o consentimento ou inativar o paciente cancela os pendentes.
- **Idempotência:** no máximo um lembrete ativo por retorno e por agendamento (índice parcial único); alterações substituem o lembrete anterior.
- Antecedência: retornos `REMINDER_RETURN_DAYS_BEFORE` dias antes, às 09:00; agendamentos `REMINDER_APPOINTMENT_HOURS_BEFORE` horas antes.
- **Processamento:** `POST /api/jobs/reminders` (agendador, com `Authorization: Bearer $CRON_SECRET`) ou o botão “Processar fila”. Lembretes vencidos são reservados com `FOR UPDATE SKIP LOCKED` — vários processadores ao mesmo tempo nunca enviam o mesmo lembrete duas vezes. Reservas presas por mais de 15 minutos (processo interrompido) voltam para a fila.
- **Antes de enviar**, confere de novo: agendamento ainda ativo e futuro, retorno ainda em aberto, consentimento vigente.
- **Falhas temporárias** (rede, limite da API, instabilidade): até 3 tentativas — a 2ª após 5 min e a 3ª após 30 min (o intervalo seguinte, 2 h, só é usado se o limite de tentativas for aumentado). Falhas definitivas vão direto para “Falhou”; a equipe pode **tentar de novo** depois de corrigir a causa, ou cancelar.
- **Sem integração** (`WHATSAPP_PROVIDER=disabled`): nada é enviado e os lembretes continuam pendentes e visíveis no CRM, para contato manual.
- **Modo de desenvolvimento:** os lembretes são processados como **simulados** — a mensagem aparece na conversa com a marca “Simulada” e nada sai do servidor.

Textos dos lembretes (prévia registrada no CRM; na API oficial, o conteúdo vem do modelo aprovado com estes parâmetros):

- Agendamento: nome, data, horário e procedimento.
- Retorno: nome, procedimento e data prevista — pedindo que o paciente responda para agendar.
