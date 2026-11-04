# Agendamentos

Código: [`src/server/services/appointments.ts`](../src/server/services/appointments.ts), [`src/app/(app)/agenda/page.tsx`](../src/app/(app)/agenda/page.tsx), [`src/components/agenda/`](../src/components/agenda). Testes: [`tests/integration/appointments.test.ts`](../tests/integration/appointments.test.ts).

## Visões e uso

- **Dia, semana (segunda a domingo) e mês**, com navegação anterior/hoje/próximo e filtros por profissional e status — tudo na URL (pode ser compartilhado e sobrevive ao recarregar).
- Clique em um horário livre (dia/semana) para agendar naquele horário; clique em um atendimento para ver detalhes, histórico e ações.
- Atendimentos simultâneos de profissionais diferentes aparecem lado a lado. A faixa visível é 07:00–21:00, ampliada automaticamente se houver atendimento fora dela.
- No celular, a semana vira uma lista por dia. Cancelados ficam ocultos por padrão (use o filtro de status para vê-los).

## Quem pode ser agendado

- **Paciente ativo**, ou **lead** ainda não convertido e não perdido (avaliação antes da conversão). Lead já convertido é agendado como o paciente.
- Profissional = conta ativa com perfil Profissional ou Administração.
- Um agendamento pode atender um **retorno pendente** do paciente (o retorno passa a “Agendado”).

## Regras de horário (validadas no servidor)

- Horários informados no **fuso da clínica** (`APP_TIMEZONE`, padrão São Paulo) e gravados em UTC.
- Não se agenda em **dia que já passou** (hoje é permitido, para registrar encaixes) nem a mais de **2 anos**.
- O atendimento termina no **mesmo dia** (pode terminar exatamente à meia-noite).
- **Sem conflito** para a mesma profissional, em duas camadas:
  1. Dentro da transação, as gravações da agenda de cada profissional são **serializadas** (*advisory lock* do PostgreSQL) e o conflito é checado com mensagem clara (“esta agenda já tem atendimento das 09:00 às 10:00 em 04/11”).
  2. A restrição `EXCLUDE USING gist` do banco garante a regra mesmo em caso de falha da camada anterior.
  Horários encostados (10:00–11:00 e 11:00–12:00) são permitidos; cancelados e faltas liberam o horário.

## Status e transições

| De \ Para | Agendado | Confirmado | Concluído | Cancelado | Não compareceu |
| --- | :---: | :---: | :---: | :---: | :---: |
| **Agendado** | — | ✓ | ✓¹ | ✓² | ✓¹ |
| **Confirmado** | ✓ | — | ✓¹ | ✓² | ✓¹ |
| Concluído, Cancelado, Não compareceu | finais | | | | |

¹ Só a partir do horário de início (tolerância de 15 minutos).
² Motivo obrigatório.

Mudanças usam atualização condicional (duas pessoas mudando ao mesmo tempo não se sobrescrevem). Cada mudança gera um evento no histórico e um registro de auditoria.

Efeitos automáticos:

- **Concluído com procedimento** → registra o procedimento realizado no histórico do paciente (e, se atendia um retorno de protocolo, liga o registro à etapa).
- **Concluído / Não compareceu** com retorno vinculado → retorno “Compareceu” / “Não compareceu”; etapas encadeadas do protocolo são recalculadas a partir da data real.
- **Cancelado** com retorno vinculado → o retorno volta a ficar pendente (com lembrete, se houver consentimento).
- **Cancelado / Não compareceu** de lead sem outro horário ativo → o lead volta para “Em atendimento”.
- Concluído, cancelado ou falta → lembretes pendentes do agendamento são cancelados.

## Reagendar × remarcar

- **Reagendar** (agendamentos ativos): muda o horário do **mesmo** agendamento. O horário anterior fica no histórico, o status volta para “Agendado” (o novo horário precisa ser confirmado) e o lembrete é substituído.
- **Remarcar** (cancelados ou faltas): cria um **novo** agendamento ligado ao original (“remarcado de/para”). Cada original só pode ser remarcado uma vez.

## Lembretes de agendamento

Para pacientes que autorizaram o WhatsApp, um lembrete é criado `REMINDER_APPOINTMENT_HOURS_BEFORE` horas antes (padrão 24 h). Se o agendamento é feito em cima da hora, o lembrete sai imediatamente, desde que faltem pelo menos 2 horas. Detalhes da fila em [protocolos-e-retornos.md](protocolos-e-retornos.md#fila-de-lembretes).
