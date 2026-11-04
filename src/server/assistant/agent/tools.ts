import { createHash } from "node:crypto";

import { z } from "zod";

import { isDateKey } from "@/lib/datetime";
import { formatBRL } from "@/lib/money";
import { logger } from "@/server/logger";
import { maskSensitiveText } from "@/server/logging/redact";

import type { PortResult, TurnPorts } from "../engine";
import type { AppointmentOption, AssistantState, PendingAction, StoredSlot } from "../state";
import { isExplicitConfirmation, normalizeText } from "../text";
import type { KnowledgePassage } from "../types";

import type { AgentToolCall, AgentToolResult, AgentToolSpec } from "./types";

/**
 * Ferramentas do CRM disponíveis para a IA generativa. Regras:
 *
 * - Lista fechada: só os nomes abaixo existem; argumentos validados (Zod) antes
 *   de qualquer efeito, mesmo com o schema estrito do provedor.
 * - A IA nunca vê nem informa identificadores internos: horários, agendamentos,
 *   retornos e entradas da base são referências curtas (S1, A1, R1, K1) válidas
 *   só para ESTE contato e ESTE turno — um agendamento de outra pessoa não tem
 *   referência e não pode ser alcançado.
 * - Agendar, remarcar e cancelar exigem proposta + confirmação explícita do
 *   contato em mensagem posterior (conferida pelo servidor).
 * - Todo efeito passa pelas portas (`AgentPorts`), que aplicam as regras e a
 *   auditoria dos serviços do CRM com o ator "Assistente virtual".
 */

export type ReturnResponse = "wants_to_schedule" | "wants_team_contact" | "not_now" | "not_interested";

export interface ServiceInfo {
  name: string;
  category: string | null;
  durationMinutes: number;
  /** Preço do catálogo em centavos — só enviado ao modelo quando a clínica autoriza. */
  priceCents: number | null;
}

export interface ReturnOption {
  id: string;
  /** Ex.: "Segunda sessão — Bioestimulador de colágeno". */
  label: string;
  dueDateLabel: string;
}

/** Portas do motor agente: as do motor guiado e as que só a IA generativa usa. */
export interface AgentPorts extends TurnPorts {
  listServices(): Promise<{ services: ServiceInfo[]; bookableProcedure: string | null }>;
  confirmAttendance(appointmentId: string): Promise<PortResult>;
  /** Observação na linha do tempo do lead (texto já mascarado). false: não há lead. */
  addLeadNote(note: string): Promise<boolean>;
  registerOpportunity(input: { nextStep: "schedule" | "team_contact" | "thinking"; interest: string | null; summary: string }): Promise<boolean>;
  createStaffTask(input: { title: string; details: string; urgent: boolean; dedupeKey: string }): Promise<boolean>;
  recordReturnResponse(returnId: string, response: ReturnResponse, returnLabel: string): Promise<void>;
  /** Outros cadastros (leads ou pacientes) com o mesmo nome e telefone diferente. */
  countPossibleDuplicates(name: string): Promise<number>;
}

export interface ToolboxContext {
  kind: "reply" | "follow_up";
  now: Date;
  today: string;
  conversationId: string;
  /** Mensagem(ns) do contato sendo respondidas (só local; nunca registradas). */
  contactText: string;
  inboundMessageId: string | null;
  contactKind: "patient" | "lead" | "unknown";
  ambiguousContact: boolean;
  shareCatalogPrices: boolean;
  bookingEnabled: boolean;
  /** Validade de uma proposta pendente (horas). */
  pendingTtlHours: number;
  /** Notas da conversa no início do turno (resumo para a equipe em transferências). */
  memory: string | null;
}

const ACTION_TOOLS = new Set([
  "register_lead",
  "update_lead",
  "register_opportunity",
  "propose_booking",
  "propose_reschedule",
  "propose_cancellation",
  "confirm_pending_action",
  "discard_pending_action",
  "confirm_attendance",
  "create_staff_task",
  "request_human",
  "record_return_response",
  "opt_out_contact",
  "list_my_appointments",
]);

const MAX_TOOL_CALLS_PER_TURN = 12;
const MAX_TASKS_PER_TURN = 2;

// -----------------------------------------------------------------------------
// Definições (JSON Schema estrito para o provedor + Zod para o servidor)
// -----------------------------------------------------------------------------

const objectSchema = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const str = (description: string) => ({ type: "string", description });
const ref = (letter: string, description: string) => ({ type: "string", description: `${description} (ex.: ${letter}1).` });

const periodEnum = { type: "string", enum: ["", "morning", "afternoon", "evening"], description: "Período do dia; vazio se não houver preferência." };

const TOOL_DEFINITIONS = {
  search_knowledge: {
    description:
      "Busca na base de conhecimento APROVADA pela clínica (serviços, preços autorizados, condições de pagamento, endereço, horários, políticas, preparo, perguntas frequentes). Use quando a pergunta não estiver coberta pelas entradas já enviadas. Fatos sobre a clínica só podem vir daqui ou de outras ferramentas.",
    schema: objectSchema({ query: str("O que procurar, em poucas palavras (ex.: 'valor botox', 'estacionamento').") }),
    input: z.object({ query: z.string().trim().min(2).max(300) }).strict(),
  },
  list_services: {
    description:
      "Lista os procedimentos ativos do catálogo da clínica (nome, categoria, duração e, só se a clínica autorizar, preço) e qual atendimento pode ser agendado por você.",
    schema: objectSchema({}),
    input: z.object({}).strict(),
  },
  check_availability: {
    description:
      "Consulta horários REALMENTE livres na agenda. purpose='new' para um agendamento novo; purpose='reschedule' com appointment_ref para remarcar um agendamento do contato. Devolve referências S1, S2… que você apresenta ao contato. Nunca ofereça horários que não vieram daqui.",
    schema: objectSchema({
      purpose: { type: "string", enum: ["new", "reschedule"], description: "new = agendamento novo; reschedule = remarcar." },
      appointment_ref: ref("A", "Agendamento a remarcar; vazio para agendamento novo"),
      date: str("Data desejada AAAA-MM-DD, resolvida a partir da data de hoje; vazio se não houver."),
      period: periodEnum,
      weekday: { type: "integer", description: "Dia da semana desejado (0 = domingo … 6 = sábado); -1 se não houver." },
    }),
    input: z
      .object({
        purpose: z.enum(["new", "reschedule"]),
        appointment_ref: z.string().max(4),
        date: z.string().max(10),
        period: z.enum(["", "morning", "afternoon", "evening"]),
        weekday: z.number().int().min(-1).max(6),
      })
      .strict(),
  },
  register_lead: {
    description:
      "Cadastra (ou completa) o contato como lead no CRM, sem duplicar: o telefone já identifica a pessoa. Use quando souber o nome que a pessoa usa. Pacientes já cadastrados não precisam. Não peça dados além do nome e do interesse.",
    schema: objectSchema({
      name: str("Nome que a pessoa informou (como ela quer ser chamada)."),
      interest: str("Procedimento ou assunto de interesse, se já souber; vazio caso contrário."),
    }),
    input: z.object({ name: z.string().trim().min(2).max(60), interest: z.string().trim().max(200) }).strict(),
  },
  update_lead: {
    description:
      "Atualiza informações do lead deste contato: interesse, período preferido e uma observação comercial curta (sem dados de saúde) na linha do tempo.",
    schema: objectSchema({
      interest: str("Novo interesse; vazio para manter."),
      preferred_period: periodEnum,
      note: str("Observação comercial curta para a equipe; vazio se não houver."),
    }),
    input: z
      .object({
        interest: z.string().trim().max(200),
        preferred_period: z.enum(["", "morning", "afternoon", "evening"]),
        note: z.string().trim().max(400),
      })
      .strict(),
  },
  register_opportunity: {
    description:
      "Registra uma oportunidade qualificada: a pessoa quer agendar, quer contato da equipe ou ficou de pensar após se interessar. Move o lead para 'Em atendimento' e avisa a equipe. Uma vez por conversa. O resumo é objetivo e sem dados de saúde.",
    schema: objectSchema({
      next_step: { type: "string", enum: ["schedule", "team_contact", "thinking"], description: "Próximo passo combinado." },
      summary: str("Resumo para a equipe em até 3 frases: interesse, dúvidas/objeções e o que foi combinado."),
    }),
    input: z.object({ next_step: z.enum(["schedule", "team_contact", "thinking"]), summary: z.string().trim().min(5).max(500) }).strict(),
  },
  list_my_appointments: {
    description: "Lista os agendamentos futuros DESTE contato (referências A1, A2…).",
    schema: objectSchema({}),
    input: z.object({}).strict(),
  },
  propose_booking: {
    description:
      "Prepara o agendamento de um horário oferecido (S#). NÃO agenda: depois disso, pergunte ao contato se pode confirmar. Exige o contato cadastrado (register_lead). return_ref: retorno previsto (R#) que esta consulta atende, se for o caso.",
    schema: objectSchema({ slot_ref: ref("S", "Horário escolhido"), return_ref: ref("R", "Retorno previsto atendido; vazio se não for o caso") }),
    input: z.object({ slot_ref: z.string().max(4), return_ref: z.string().max(4) }).strict(),
  },
  propose_reschedule: {
    description:
      "Prepara a remarcação de um agendamento do contato (A#) para um horário (S#) obtido com check_availability(purpose='reschedule'). NÃO remarca: pergunte ao contato se pode confirmar.",
    schema: objectSchema({ appointment_ref: ref("A", "Agendamento a remarcar"), slot_ref: ref("S", "Novo horário") }),
    input: z.object({ appointment_ref: z.string().max(4), slot_ref: z.string().max(4) }).strict(),
  },
  propose_cancellation: {
    description: "Prepara o cancelamento de um agendamento do contato (A#). NÃO cancela: pergunte ao contato se confirma o cancelamento.",
    schema: objectSchema({ appointment_ref: ref("A", "Agendamento a cancelar") }),
    input: z.object({ appointment_ref: z.string().max(4) }).strict(),
  },
  confirm_pending_action: {
    description:
      "Executa a ação pendente (agendar, remarcar ou cancelar) SOMENTE quando o contato acabou de confirmar explicitamente, na mensagem atual, a proposta enviada antes. O servidor confere a confirmação; se recusar, pergunte de novo de forma clara.",
    schema: objectSchema({}),
    input: z.object({}).strict(),
  },
  discard_pending_action: {
    description: "Descarta a ação pendente quando o contato desistiu ou quer outra opção.",
    schema: objectSchema({}),
    input: z.object({}).strict(),
  },
  confirm_attendance: {
    description: "Registra que o contato confirmou presença em um agendamento dele (A#), quando ele disser isso explicitamente.",
    schema: objectSchema({ appointment_ref: ref("A", "Agendamento confirmado") }),
    input: z.object({ appointment_ref: z.string().max(4) }).strict(),
  },
  create_staff_task: {
    description:
      "Cria uma tarefa para a equipe quando a pessoa pede algo que só a equipe resolve e nenhuma outra ferramenta cobre (ex.: enviar orçamento personalizado, retornar ligação). Sem dados de saúde.",
    schema: objectSchema({
      title: str("Título curto da tarefa."),
      details: str("O que a equipe precisa fazer e o contexto mínimo."),
      urgent: { type: "boolean", description: "true só se a equipe precisa agir hoje." },
    }),
    input: z.object({ title: z.string().trim().min(3).max(120), details: z.string().trim().max(400), urgent: z.boolean() }).strict(),
  },
  save_conversation_notes: {
    description:
      "Substitui as notas da conversa (memória de longo prazo deste contato): interesse, preferências de horário, objeções, combinados e próximo passo. Escreva o conjunto completo e atualizado, em até 6 linhas curtas, sem dados de saúde, documentos ou telefones.",
    schema: objectSchema({ notes: str("Notas completas e atualizadas.") }),
    input: z.object({ notes: z.string().trim().max(800) }).strict(),
  },
  request_human: {
    description:
      "Transfere a conversa para a equipe: as respostas automáticas param e a equipe recebe uma tarefa com o motivo e o resumo. Use quando a pessoa pedir, houver reclamação, insatisfação, situação delicada, dúvida de saúde ou algo que você não consegue resolver.",
    schema: objectSchema({
      reason: str("Motivo objetivo para a equipe (sem dados de saúde detalhados)."),
      urgent: { type: "boolean", description: "true para reclamação grave ou possível problema de saúde." },
    }),
    input: z.object({ reason: z.string().trim().min(3).max(200), urgent: z.boolean() }).strict(),
  },
  record_return_response: {
    description:
      "Registra a resposta do contato ao convite de retorno previsto (R#). A necessidade de renovar é decisão da profissional: você só registra a resposta (a equipe é avisada quando precisa agir).",
    schema: objectSchema({
      return_ref: ref("R", "Retorno previsto"),
      response: {
        type: "string",
        enum: ["wants_to_schedule", "wants_team_contact", "not_now", "not_interested"],
        description: "Resposta da pessoa ao convite.",
      },
    }),
    input: z
      .object({ return_ref: z.string().max(4), response: z.enum(["wants_to_schedule", "wants_team_contact", "not_now", "not_interested"]) })
      .strict(),
  },
  opt_out_contact: {
    description: "Descadastra o número de mensagens automáticas, quando a pessoa pedir para não receber mais mensagens da clínica.",
    schema: objectSchema({}),
    input: z.object({}).strict(),
  },
} as const;

export type AgentToolName = keyof typeof TOOL_DEFINITIONS;

const FOLLOW_UP_TOOLS: AgentToolName[] = ["search_knowledge", "list_services", "check_availability", "save_conversation_notes"];

export function agentToolSpecs(kind: "reply" | "follow_up"): AgentToolSpec[] {
  const names = kind === "follow_up" ? FOLLOW_UP_TOOLS : (Object.keys(TOOL_DEFINITIONS) as AgentToolName[]);
  return names.map((name) => ({ name, description: TOOL_DEFINITIONS[name].description, inputSchema: TOOL_DEFINITIONS[name].schema }));
}

// -----------------------------------------------------------------------------
// Execução
// -----------------------------------------------------------------------------

/** O que o servidor efetivamente fez neste turno (base do texto final, do resultado e da checagem). */
export interface ExecutedActions {
  booked: { slot: StoredSlot; procedureName: string | null } | null;
  rescheduled: { slot: StoredSlot; appointment: AppointmentOption } | null;
  cancelled: AppointmentOption | null;
  attendanceConfirmed: boolean;
  handoff: { reason: string; urgent: boolean } | null;
  optedOut: boolean;
  leadRegistered: boolean;
  opportunity: boolean;
  proposed: PendingAction | null;
  offeredSlots: boolean;
  tasks: number;
  /** Falha ao gravar uma ação confirmada: a conversa vai para a equipe. */
  executionError: string | null;
  knowledgeSearched: boolean;
}

type ToolOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

const fail = (error: string): ToolOutcome => ({ ok: false, error });
const ok = (data: Record<string, unknown>): ToolOutcome => ({ ok: true, data });

function parseRef(value: string, letter: string): number | null {
  const match = new RegExp(`^${letter}(\\d{1,2})$`, "i").exec(value.trim());
  return match ? Number(match[1]) : null;
}

function cleanPersonName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}' -]{2,60}$/u.test(name)) return null;
  return name
    .split(" ")
    .map((part) => (part.length > 2 ? part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1) : part))
    .join(" ");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export class AgentToolbox {
  readonly context: ToolboxContext;
  private readonly ports: AgentPorts;
  /** Estado da conversa (cópia): horários oferecidos, proposta pendente, dados coletados. */
  state: AssistantState;
  /** Notas da conversa: `undefined` = não alteradas neste turno. */
  memory: string | undefined;
  readonly knowledge: KnowledgePassage[];
  readonly appointments: AppointmentOption[];
  readonly returns: ReturnOption[];
  readonly toolCalls: string[] = [];
  /** Saídas das ferramentas (fatos que a resposta pode citar). */
  readonly facts: string[] = [];
  readonly done: ExecutedActions = {
    booked: null,
    rescheduled: null,
    cancelled: null,
    attendanceConfirmed: false,
    handoff: null,
    optedOut: false,
    leadRegistered: false,
    opportunity: false,
    proposed: null,
    offeredSlots: false,
    tasks: 0,
    executionError: null,
    knowledgeSearched: false,
  };

  constructor(
    context: ToolboxContext,
    ports: AgentPorts,
    seed: { state: AssistantState; knowledge: KnowledgePassage[]; appointments: AppointmentOption[]; returns: ReturnOption[] },
  ) {
    this.context = context;
    this.ports = ports;
    this.state = structuredClone(seed.state);
    this.knowledge = [...seed.knowledge];
    this.appointments = [...seed.appointments];
    this.returns = [...seed.returns];
  }

  /** Referência K# de uma entrada (adiciona se ainda não estiver na lista). */
  knowledgeRef(passage: KnowledgePassage): string {
    let index = this.knowledge.findIndex((item) => item.id === passage.id);
    if (index < 0) {
      this.knowledge.push(passage);
      index = this.knowledge.length - 1;
    }
    return `K${index + 1}`;
  }

  /** Ids das entradas a partir das referências citadas pelo modelo (ignora as inválidas). */
  resolveKnowledgeRefs(refs: string[]): string[] {
    const ids = refs.flatMap((value) => {
      const index = parseRef(value, "K");
      const passage = index ? this.knowledge[index - 1] : undefined;
      return passage ? [passage.id] : [];
    });
    return [...new Set(ids)];
  }

  /** Resumo para a tarefa da equipe numa transferência: as notas mais recentes da conversa. */
  handoffSummary(): string | null {
    const notes = this.memory ?? this.context.memory;
    return notes ? `Resumo da conversa: ${notes}` : null;
  }

  /** Houve efeito que não pode ser repetido às cegas numa nova tentativa do turno. */
  hasCriticalEffects(): boolean {
    const done = this.done;
    return Boolean(done.booked || done.rescheduled || done.cancelled || done.attendanceConfirmed || done.optedOut || done.handoff);
  }

  async execute(call: AgentToolCall): Promise<AgentToolResult> {
    this.toolCalls.push(call.name);
    let outcome: ToolOutcome;
    try {
      outcome = await this.dispatch(call);
    } catch (error) {
      // Falha inesperada de uma porta (ex.: banco): a IA recebe um erro genérico,
      // sem detalhes internos, e o orquestrador encaminha a conversa para a equipe.
      logger.error("assistant.agent.tool_failed", { tool: call.name, err: error });
      this.done.executionError ??= `tool:${call.name}`;
      outcome = fail("Falha interna ao executar esta ação. Não tente de novo: avise que a equipe vai continuar o atendimento.");
    }
    const content = JSON.stringify(outcome.ok ? outcome.data : { erro: outcome.error });
    if (outcome.ok) this.facts.push(content);
    return { type: "tool_result", toolCallId: call.id, content, isError: !outcome.ok };
  }

  private async dispatch(call: AgentToolCall): Promise<ToolOutcome> {
    if (!(call.name in TOOL_DEFINITIONS)) return fail(`Ferramenta inexistente: ${call.name}.`);
    const name = call.name as AgentToolName;
    if (this.context.kind === "follow_up" && !FOLLOW_UP_TOOLS.includes(name)) {
      return fail("Ferramenta indisponível em mensagens de acompanhamento.");
    }
    if (this.toolCalls.length > MAX_TOOL_CALLS_PER_TURN) {
      return fail("Limite de ferramentas deste turno atingido. Responda agora ao contato.");
    }
    if (this.done.optedOut && ACTION_TOOLS.has(name)) return fail("O contato foi descadastrado neste turno. Apenas responda.");

    const definition = TOOL_DEFINITIONS[name];
    const parsed = definition.input.safeParse(call.input);
    if (!parsed.success) return fail("Argumentos inválidos para esta ferramenta. Confira o formato e tente de novo.");
    const input = parsed.data as Record<string, unknown>;

    switch (name) {
      case "search_knowledge":
        return this.searchKnowledge(input.query as string);
      case "list_services":
        return this.listServices();
      case "check_availability":
        return this.checkAvailability(input as z.output<(typeof TOOL_DEFINITIONS)["check_availability"]["input"]>);
      case "register_lead":
        return this.registerLead(input.name as string, input.interest as string);
      case "update_lead":
        return this.updateLead(input as z.output<(typeof TOOL_DEFINITIONS)["update_lead"]["input"]>);
      case "register_opportunity":
        return this.registerOpportunity(input.next_step as "schedule" | "team_contact" | "thinking", input.summary as string);
      case "list_my_appointments":
        return ok({ agendamentos: this.appointmentList() });
      case "propose_booking":
        return this.proposeBooking(input.slot_ref as string, input.return_ref as string);
      case "propose_reschedule":
        return this.proposeReschedule(input.appointment_ref as string, input.slot_ref as string);
      case "propose_cancellation":
        return this.proposeCancellation(input.appointment_ref as string);
      case "confirm_pending_action":
        return this.confirmPendingAction();
      case "discard_pending_action":
        this.state.pendingAction = null;
        return ok({ status: "descartada" });
      case "confirm_attendance":
        return this.confirmAttendance(input.appointment_ref as string);
      case "create_staff_task":
        return this.createStaffTask(input.title as string, input.details as string, input.urgent as boolean);
      case "save_conversation_notes":
        this.memory = maskSensitiveText(input.notes as string).slice(0, 800);
        return ok({ status: "notas_salvas" });
      case "request_human":
        return this.requestHuman(input.reason as string, input.urgent as boolean);
      case "record_return_response":
        return this.recordReturnResponse(input.return_ref as string, input.response as ReturnResponse);
      case "opt_out_contact":
        await this.ports.optOut();
        this.done.optedOut = true;
        this.state.pendingAction = null;
        return ok({ status: "descadastrado", instrucao: "Confirme ao contato que ele não receberá mais mensagens automáticas." });
    }
  }

  private appointmentList() {
    return this.appointments.map((appointment, index) => ({ ref: `A${index + 1}`, quando: appointment.label }));
  }

  private appointmentByRef(value: string): AppointmentOption | null {
    const index = parseRef(value, "A");
    return index ? (this.appointments[index - 1] ?? null) : null;
  }

  private slotByRef(value: string): StoredSlot | null {
    const index = parseRef(value, "S");
    return index ? (this.state.offeredSlots[index - 1] ?? null) : null;
  }

  private returnByRef(value: string): ReturnOption | null {
    const index = parseRef(value, "R");
    return index ? (this.returns[index - 1] ?? null) : null;
  }

  private hasSubject(): boolean {
    return this.context.contactKind !== "unknown" || this.done.leadRegistered;
  }

  private async searchKnowledge(query: string): Promise<ToolOutcome> {
    this.done.knowledgeSearched = true;
    const passages = (await this.ports.searchKnowledge(maskSensitiveText(query))).slice(0, 5);
    if (passages.length === 0) {
      return ok({ encontrado: false, instrucao: "Nada aprovado sobre isso. Diga que vai confirmar com a equipe; não invente." });
    }
    return ok({
      encontrado: true,
      entradas: passages.map((passage) => ({ ref: this.knowledgeRef(passage), titulo: passage.title, texto: passage.content })),
    });
  }

  private async listServices(): Promise<ToolOutcome> {
    const { services, bookableProcedure } = await this.ports.listServices();
    return ok({
      procedimentos: services.map((service) => ({
        nome: service.name,
        ...(service.category ? { categoria: service.category } : {}),
        duracao_minutos: service.durationMinutes,
        ...(this.context.shareCatalogPrices && service.priceCents !== null ? { preco: formatBRL(service.priceCents) } : {}),
      })),
      precos:
        this.context.shareCatalogPrices
          ? "Preços do catálogo autorizados pela clínica."
          : "Preços só os da base aprovada (search_knowledge).",
      agendavel_por_voce: this.context.bookingEnabled ? bookableProcedure : null,
    });
  }

  private async checkAvailability(input: {
    purpose: "new" | "reschedule";
    appointment_ref: string;
    date: string;
    period: "" | "morning" | "afternoon" | "evening";
    weekday: number;
  }): Promise<ToolOutcome> {
    if (this.context.ambiguousContact) {
      return fail("Este telefone pertence a mais de um paciente: a agenda precisa ser tratada pela equipe (use request_human).");
    }
    let target: AppointmentOption | null = null;
    if (input.purpose === "reschedule") {
      target = this.appointmentByRef(input.appointment_ref);
      if (!target) return fail("Agendamento não encontrado. Use list_my_appointments e informe a referência A#.");
    }
    const preference = {
      ...(input.date && isDateKey(input.date) && input.date >= this.context.today ? { date: input.date } : {}),
      ...(input.period ? { period: input.period } : {}),
      ...(input.weekday >= 0 ? { weekday: input.weekday } : {}),
    };
    const offer = await this.ports.findSlots({ preference, reschedule: target ?? undefined });
    if (!offer) {
      return ok({
        disponivel: false,
        motivo: "O agendamento pelo assistente não está ativo. Ofereça que a equipe combine o horário (request_human ou register_opportunity).",
      });
    }
    const slots = offer.slots.map((slot) => ({ ...slot, forAppointmentId: target?.id ?? null }));
    this.state.offeredSlots = slots;
    this.state.bookingProcedureName = target ? null : offer.procedureName;
    if (slots.length === 0) {
      return ok({ disponivel: false, motivo: "Não há horários livres no período de agendamento configurado. Ofereça o contato da equipe." });
    }
    this.done.offeredSlots = true;
    return ok({
      disponivel: true,
      atendimento: target ? `remarcação de ${target.label}` : offer.procedureName,
      corresponde_a_preferencia: offer.matchedPreference,
      horarios: slots.map((slot, index) => ({ ref: `S${index + 1}`, quando: slot.label })),
    });
  }

  private async registerLead(rawName: string, interest: string): Promise<ToolOutcome> {
    if (this.context.contactKind === "patient") return ok({ status: "ja_e_paciente" });
    const name = cleanPersonName(rawName);
    if (!name) return fail("Nome inválido: use só o nome que a pessoa informou.");
    const procedure = interest ? await this.ports.matchProcedure(interest) : null;
    const nextInterest = interest ? maskSensitiveText(procedure?.name ?? interest).slice(0, 200) : this.state.interest;
    const created = await this.ports.ensureLead({ name, interest: nextInterest, procedureId: procedure?.id ?? this.state.procedureId });
    if (!created) return ok({ status: "ja_e_paciente" });
    this.state.name ??= name;
    if (nextInterest) this.state.interest ??= nextInterest;
    if (procedure) this.state.procedureId ??= procedure.id;
    const wasKnown = this.context.contactKind === "lead" || this.done.leadRegistered;
    this.done.leadRegistered = true;
    const duplicates = await this.ports.countPossibleDuplicates(name);
    if (duplicates > 0) {
      await this.ports.createStaffTask({
        title: `Possível cadastro duplicado: ${name.split(" ")[0]}`,
        details: "Lead do WhatsApp com o mesmo nome de outro cadastro e telefone diferente. Confira e unifique se for a mesma pessoa.",
        urgent: false,
        dedupeKey: `duplicate:${this.context.conversationId}`,
      });
    }
    return ok({ status: wasKnown ? "atualizado" : "cadastrado", ...(duplicates > 0 ? { possivel_duplicidade: "equipe avisada" } : {}) });
  }

  private async updateLead(input: { interest: string; preferred_period: string; note: string }): Promise<ToolOutcome> {
    if (this.context.contactKind === "patient") return fail("O contato já é paciente: registre informações com save_conversation_notes.");
    if (!this.hasSubject() || !this.state.name) return fail("O contato ainda não está cadastrado: use register_lead com o nome.");
    const changed: string[] = [];
    if (input.interest) {
      const procedure = await this.ports.matchProcedure(input.interest);
      this.state.interest = maskSensitiveText(procedure?.name ?? input.interest).slice(0, 200);
      if (procedure) this.state.procedureId = procedure.id;
      await this.ports.ensureLead({ name: this.state.name, interest: this.state.interest, procedureId: this.state.procedureId });
      changed.push("interesse");
    }
    if (input.preferred_period) {
      this.state.answers.periodo = { morning: "manhã", afternoon: "tarde", evening: "noite" }[input.preferred_period] ?? "";
      changed.push("período preferido");
    }
    if (input.note) {
      const saved = await this.ports.addLeadNote(maskSensitiveText(input.note).slice(0, 400));
      if (saved) changed.push("observação");
    }
    return ok({ status: changed.length > 0 ? "atualizado" : "sem_alteracoes", campos: changed });
  }

  private async registerOpportunity(nextStep: "schedule" | "team_contact" | "thinking", summary: string): Promise<ToolOutcome> {
    if (this.context.contactKind === "patient") {
      if (nextStep === "team_contact") {
        await this.ports.createStaffTask({
          title: "Paciente pediu contato da equipe",
          details: maskSensitiveText(summary).slice(0, 400),
          urgent: false,
          dedupeKey: `patient-contact:${this.context.conversationId}`,
        });
      }
      return ok({ status: "registrado_para_paciente" });
    }
    if (!this.hasSubject()) return fail("Cadastre o contato primeiro (register_lead com o nome).");
    if (this.state.leadRegistered) return ok({ status: "ja_registrada" });
    const registered = await this.ports.registerOpportunity({
      nextStep,
      interest: this.state.interest,
      summary: maskSensitiveText(summary).slice(0, 500),
    });
    if (!registered) return fail("Lead não encontrado para registrar a oportunidade.");
    this.state.leadRegistered = true;
    this.state.qualified = true;
    this.done.opportunity = true;
    return ok({ status: "registrada", etapa_do_funil: "Em atendimento", equipe_avisada: true });
  }

  private pendingFor(type: PendingAction["type"], fields: Partial<PendingAction>): PendingAction {
    return {
      type,
      slot: null,
      appointment: null,
      returnId: null,
      procedureName: null,
      ...fields,
      proposedAt: this.context.now.toISOString(),
      proposedForMessageId: this.context.inboundMessageId,
    };
  }

  private async proposeBooking(slotRef: string, returnRef: string): Promise<ToolOutcome> {
    if (this.context.ambiguousContact) return fail("Telefone compartilhado por mais de um paciente: use request_human.");
    if (!this.hasSubject()) return fail("Antes de agendar, cadastre o contato com register_lead (precisa do nome).");
    const slot = this.slotByRef(slotRef);
    if (!slot || slot.forAppointmentId !== null) {
      return fail("Horário inválido: use uma referência S# devolvida por check_availability(purpose='new').");
    }
    let returnId: string | null = null;
    if (returnRef) {
      const option = this.returnByRef(returnRef);
      if (!option || this.context.contactKind !== "patient") return fail("Retorno inválido para este contato.");
      returnId = option.id;
    }
    const pending = this.pendingFor("book", { slot, returnId, procedureName: this.state.bookingProcedureName });
    this.state.pendingAction = pending;
    this.done.proposed = pending;
    return ok({
      status: "aguardando_confirmacao",
      proposta: `${pending.procedureName ?? "Atendimento"} em ${slot.label}`,
      instrucao: "Ainda NÃO está agendado. Pergunte ao contato se pode confirmar este horário e aguarde a resposta.",
    });
  }

  private async proposeReschedule(appointmentRef: string, slotRef: string): Promise<ToolOutcome> {
    if (this.context.ambiguousContact) return fail("Telefone compartilhado por mais de um paciente: use request_human.");
    const appointment = this.appointmentByRef(appointmentRef);
    if (!appointment) return fail("Agendamento não encontrado entre os do contato (use list_my_appointments).");
    const slot = this.slotByRef(slotRef);
    if (!slot || slot.forAppointmentId !== appointment.id) {
      return fail("Horário inválido: consulte check_availability(purpose='reschedule') para este agendamento e use uma referência S# devolvida.");
    }
    const pending = this.pendingFor("reschedule", { slot, appointment });
    this.state.pendingAction = pending;
    this.done.proposed = pending;
    return ok({
      status: "aguardando_confirmacao",
      proposta: `remarcar ${appointment.label} para ${slot.label}`,
      instrucao: "Ainda NÃO foi remarcado. Pergunte ao contato se confirma a remarcação e aguarde a resposta.",
    });
  }

  private async proposeCancellation(appointmentRef: string): Promise<ToolOutcome> {
    if (this.context.ambiguousContact) return fail("Telefone compartilhado por mais de um paciente: use request_human.");
    const appointment = this.appointmentByRef(appointmentRef);
    if (!appointment) return fail("Agendamento não encontrado entre os do contato (use list_my_appointments).");
    const pending = this.pendingFor("cancel", { appointment });
    this.state.pendingAction = pending;
    this.done.proposed = pending;
    return ok({
      status: "aguardando_confirmacao",
      proposta: `cancelar ${appointment.label}`,
      instrucao: "Ainda NÃO foi cancelado. Pergunte ao contato se confirma o cancelamento e aguarde a resposta.",
    });
  }

  /**
   * Porta dupla da confirmação: a IA entendeu que o contato confirmou E o texto
   * da mensagem atual é uma confirmação explícita, sem ressalvas. A proposta
   * precisa ser de uma mensagem anterior e ainda estar válida.
   */
  private async confirmPendingAction(): Promise<ToolOutcome> {
    const pending = this.state.pendingAction;
    if (!pending) return fail("Não há ação pendente. Proponha primeiro (propose_booking, propose_reschedule ou propose_cancellation).");
    if (this.context.kind !== "reply" || !this.context.inboundMessageId) return fail("Confirmação só a partir de uma mensagem do contato.");
    if (pending.proposedForMessageId === this.context.inboundMessageId || this.done.proposed) {
      return fail("A proposta acabou de ser feita: pergunte ao contato e aguarde a confirmação dele na próxima mensagem.");
    }
    const age = this.context.now.getTime() - new Date(pending.proposedAt).getTime();
    if (!Number.isFinite(age) || age > this.context.pendingTtlHours * 60 * 60_000) {
      this.state.pendingAction = null;
      return fail("A proposta expirou. Consulte os horários de novo.");
    }
    if (!isExplicitConfirmation(this.context.contactText)) {
      return fail("A mensagem atual não é uma confirmação explícita e sem ressalvas. Pergunte de novo de forma direta (ex.: 'Posso confirmar?').");
    }

    let result: PortResult;
    if (pending.type === "book" && pending.slot) {
      result = await this.ports.book(pending.slot, { returnId: pending.returnId });
    } else if (pending.type === "reschedule" && pending.slot && pending.appointment) {
      result = await this.ports.reschedule(pending.appointment.id, pending.slot);
    } else if (pending.type === "cancel" && pending.appointment) {
      result = await this.ports.cancelAppointment(pending.appointment.id);
    } else {
      this.state.pendingAction = null;
      return fail("Ação pendente inválida. Recomece.");
    }
    this.state.pendingAction = null;

    if (result.ok) {
      if (pending.type === "book") this.done.booked = { slot: pending.slot!, procedureName: pending.procedureName };
      if (pending.type === "reschedule") this.done.rescheduled = { slot: pending.slot!, appointment: pending.appointment! };
      if (pending.type === "cancel") this.done.cancelled = pending.appointment!;
      this.state.offeredSlots = [];
      return ok({
        status: "concluido",
        acao: { book: "agendado", reschedule: "remarcado", cancel: "cancelado" }[pending.type],
        detalhes:
          pending.type === "cancel"
            ? pending.appointment!.label
            : `${pending.procedureName ?? "Atendimento"} em ${pending.slot!.label}`,
      });
    }
    if (result.reason === "conflict") {
      this.state.offeredSlots = [];
      return ok({ status: "horario_indisponivel", instrucao: "O horário acabou de ser ocupado. Consulte check_availability de novo e ofereça outras opções." });
    }
    this.done.executionError = `${pending.type}_failed`;
    return ok({ status: "falhou", instrucao: "Não foi possível concluir. Avise que a equipe vai continuar o atendimento (o sistema já encaminhou)." });
  }

  private async confirmAttendance(appointmentRef: string): Promise<ToolOutcome> {
    const appointment = this.appointmentByRef(appointmentRef);
    if (!appointment) return fail("Agendamento não encontrado entre os do contato.");
    const text = normalizeText(this.context.contactText);
    if (!isExplicitConfirmation(this.context.contactText) && !/\b(confirm\w*|vou (sim|estar|comparecer|la)|estarei|presenca)\b/.test(text)) {
      return fail("O contato não confirmou presença explicitamente nesta mensagem.");
    }
    const result = await this.ports.confirmAttendance(appointment.id);
    if (!result.ok) return fail("Não foi possível registrar a confirmação (o agendamento pode ter mudado).");
    this.done.attendanceConfirmed = true;
    return ok({ status: "presenca_confirmada", agendamento: appointment.label });
  }

  private async createStaffTask(title: string, details: string, urgent: boolean): Promise<ToolOutcome> {
    if (this.done.tasks >= MAX_TASKS_PER_TURN) return fail("Limite de tarefas por mensagem atingido.");
    const created = await this.ports.createStaffTask({
      title: maskSensitiveText(title).slice(0, 120),
      details: maskSensitiveText(details).slice(0, 400),
      urgent,
      dedupeKey: `agent-task:${this.context.conversationId}:${shortHash(normalizeText(title))}`,
    });
    this.done.tasks += 1;
    return ok({ status: created ? "tarefa_criada" : "tarefa_ja_existia" });
  }

  private async requestHuman(reason: string, urgent: boolean): Promise<ToolOutcome> {
    if (!this.done.handoff) {
      const cleanReason = maskSensitiveText(reason).slice(0, 200);
      await this.ports.handoff(cleanReason, { urgent, summary: this.handoffSummary() });
      this.done.handoff = { reason: cleanReason, urgent };
      this.state.pendingAction = null;
    }
    return ok({
      status: "transferido",
      instrucao: "A equipe vai continuar por aqui. Avise o contato com naturalidade; não faça novas perguntas nem prometa prazos.",
    });
  }

  private async recordReturnResponse(returnRef: string, response: ReturnResponse): Promise<ToolOutcome> {
    const option = this.returnByRef(returnRef);
    if (!option || this.context.contactKind !== "patient") return fail("Retorno não encontrado para este contato.");
    await this.ports.recordReturnResponse(option.id, response, option.label);
    return ok({
      status: "registrado",
      ...(response === "wants_to_schedule"
        ? { proximo_passo: "Consulte horários (check_availability) e proponha o agendamento com return_ref." }
        : { proximo_passo: "A equipe foi avisada e decide o acompanhamento." }),
    });
  }
}
