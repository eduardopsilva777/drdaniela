# Fluxos comerciais

Código: [`src/server/services/leads.ts`](../src/server/services/leads.ts), [`src/server/queries/leads.ts`](../src/server/queries/leads.ts), [`src/server/queries/dashboard.ts`](../src/server/queries/dashboard.ts). Testes: [`tests/integration/leads.test.ts`](../tests/integration/leads.test.ts).

## Etapas do funil

| Etapa | Significado | Como se entra |
| --- | --- | --- |
| **Novo** | Contato recém-chegado, ainda sem conversa | Cadastro do lead |
| **Em atendimento** | A equipe está conversando | Primeiro contato registrado (ligação, mensagem, e-mail, atendimento) — automático; ou manualmente |
| **Agendado** | Tem avaliação/procedimento marcado | Ao criar um agendamento para o lead — automático; ou manualmente |
| **Convertido** | Virou paciente | **Somente** pela conversão (cria/vincula o cadastro do paciente) |
| **Perdido** | Saiu do funil | Manualmente, **com motivo obrigatório** |

Regras:

- Mudanças de etapa usam **atualização condicional**: se outra pessoa mudou a etapa no meio do caminho, nada é sobrescrito e a interface pede para atualizar.
- Cada mudança gera uma interação `STATUS_CHANGE` (de → para, autor, data) e um registro de auditoria.
- `peak_status` guarda a etapa mais avançada já atingida (Perdido não conta como avanço) — é a base do gráfico de conversão por etapa.
- Lead com agendamento cancelado (ou falta), sem outro horário ativo, **volta de Agendado para Em atendimento** automaticamente.
- Lead convertido não volta ao funil e não pode ser excluído (faz parte do histórico do paciente).

## Cadastro e duplicidade

- Telefone normalizado em E.164 (números sem DDI são tratados como brasileiros). `(11) 98765-4321`, `11987654321` e `+55 11 98765 4321` são o mesmo contato.
- **Um lead por telefone** (índice único). A tentativa de cadastrar um telefone existente mostra o lead já cadastrado (link).
- Telefone que já é de um paciente não vira lead novo: a interface leva à ficha do paciente.
- Campos comerciais (interesse, observações) **não devem conter informações de saúde** — a interface avisa; informação clínica vai para as observações restritas do paciente.
- Consentimento de WhatsApp é marcado só com autorização explícita, e a data fica registrada.

## Interações e próximas ações

- Tipos registráveis: ligação, mensagem, e-mail, atendimento presencial e nota (com direção: a clínica procurou / o contato procurou).
- Data retroativa é permitida; data no futuro não (para isso existe a próxima ação).
- **Registrar um contato conclui a próxima ação pendente**; uma nova pode ser agendada no mesmo formulário.
- A linha do tempo mostra tudo em ordem cronológica inversa, com autor.

## Conversão em paciente

Transacional e protegida contra duplicidade:

1. Se já existe paciente com o mesmo telefone, a opção padrão é **vincular** ao cadastro existente; criar um novo exige confirmar que é outra pessoa (ex.: telefone do responsável).
2. Cria (ou vincula) o paciente levando origem, complemento da origem, e-mail e consentimento de WhatsApp (mantém a data original do consentimento, se houver).
3. Marca o lead como Convertido com atualização condicional — duas conversões simultâneas do mesmo lead resultam em **um** paciente.
4. Interações, agendamentos e conversas do lead passam a aparecer na ficha do paciente.
5. Agendamentos futuros do lead ganham lembrete (se o paciente autorizou o WhatsApp).

## Exclusão (LGPD)

“Excluir” apaga o lead e suas interações de forma definitiva — para atender pedidos de eliminação de dados. Exige o perfil Profissional ou Administração, é auditado e é bloqueado para leads convertidos ou com agendamentos (nesses casos, use “Perdido”).

## Indicadores do dashboard

Todos calculados direto do banco, no fuso da clínica.

| Indicador | Definição |
| --- | --- |
| Leads novos | Leads criados no período; variação contra o período anterior de mesma duração |
| Taxa de conversão | **Coorte**: dos leads criados no período, a fração que hoje está Convertida |
| Convertidos no período | Conversões (`converted_at`) ocorridas no período, independentemente de quando o lead chegou |
| Conversão por etapa | Dos leads criados no período, quantos atingiram cada etapa (`peak_status`), inclusive os depois perdidos |
| Origem dos leads | Leads criados no período por origem, do maior para o menor |
| Leads em atendimento / totais | Situação atual (não dependem do período) |
| Agendamentos hoje / próximos 7 dias | Não cancelados hoje / agendados ou confirmados nos próximos 7 dias |
| Retornos pendentes / atrasados | Retornos `PENDING` / com data prevista anterior a hoje |
| Pacientes ativos | Cadastros ativos |
| Procedimentos realizados | Registros de procedimento realizados no período; variação contra o período anterior |

Os períodos (7, 30, 90 dias, mês atual) terminam hoje; em períodos longos o gráfico de evolução agrupa por semana.
