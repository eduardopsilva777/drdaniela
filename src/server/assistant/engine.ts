import type { AssistantOutcome } from "@/generated/prisma/enums";
import { fillTemplate, type AssistantConfig, type AssistantMessages } from "@/lib/assistant-config";

import { checkGroundedAnswer } from "./guard";
import { classifyIntent } from "./rules-model";
import { clearFlow, type AppointmentOption, type AssistantState, type AssistantStep, type StoredSlot } from "./state";
import {
  detectConsentKeyword,
  extractName,
  normalizeText,
  parseOptionNumber,
  parseSchedulePreference,
  parseYesNo,
  PERIOD_LABELS,
  type SchedulePreference,
} from "./text";
import { INFORMATIONAL_INTENTS, type AssistantModel, type Expectation, type HistoryMessage, type Interpretation, type KnowledgePassage } from "./types";

/**
 * Orquestrador do atendimento (sem banco: todo efeito passa pelas "portas").
 *
 * Regras de segurança aplicadas aqui, e não no modelo de linguagem:
 * - Descadastro (PARAR, SAIR…) é processado sempre, inclusive no atendimento humano.
 * - Agendar, remarcar e cancelar só depois de "SIM" explícito, e a confirmação
 *   só é enviada depois que o sistema gravou com sucesso.
 * - Preços, procedimentos e orientações vêm só da base aprovada (com checagem).
 * - Perguntas de saúde, urgências, pedidos de atendimento humano e erros vão
 *   para a equipe.
 */

export interface ContactContext {
  kind: "patient" | "lead" | "unknown";
  /** Primeiro nome já cadastrado (paciente ou lead). */
  firstName: string | null;
  /** Mais de um paciente ativo com o mesmo telefone: não agir sobre agendamentos sem a equipe. */
  ambiguous: boolean;
  remindersConsent: boolean;
  optedOut: boolean;
}

export interface SlotOffer {
  slots: StoredSlot[];
  matchedPreference: boolean;
  procedureName: string;
}

export type PortResult = { ok: true } | { ok: false; reason: "conflict" | "unavailable" | "error" };

export interface TurnPorts {
  searchKnowledge(text: string, intent?: string): Promise<KnowledgePassage[]>;
  matchProcedure(text: string): Promise<{ id: string; name: string } | null>;
  /** null: agendamento pelo assistente desativado ou não configurado. */
  findSlots(request: { preference: SchedulePreference; reschedule?: AppointmentOption }): Promise<SlotOffer | null>;
  /** Cria ou atualiza o lead do contato (sem duplicar). false quando o contato já é paciente. */
  ensureLead(data: { name: string; interest: string | null; procedureId: string | null }): Promise<boolean>;
  book(slot: StoredSlot): Promise<PortResult>;
  listUpcomingAppointments(): Promise<AppointmentOption[]>;
  reschedule(appointmentId: string, slot: StoredSlot): Promise<PortResult>;
  cancelAppointment(appointmentId: string): Promise<PortResult>;
  optOut(): Promise<void>;
  optIn(): Promise<void>;
  grantRemindersConsent(): Promise<void>;
  handoff(reason: string, options: { urgent: boolean }): Promise<void>;
  registerQualifiedLead(summary: {
    nextStep: "schedule" | "contact";
    interest: string | null;
    answers: Record<string, string>;
  }): Promise<void>;
  recordGap(reason: "NO_ANSWER" | "BLOCKED_ANSWER", question: string): Promise<void>;
}

export interface TurnInput {
  /** Mensagem(ns) sem resposta, como recebidas (usadas só localmente). */
  text: string;
  /** A mesma mensagem com dados pessoais mascarados (enviada ao motor e às pendências). */
  maskedText: string;
  history: HistoryMessage[];
  mode: "ASSISTANT" | "HUMAN";
  now: Date;
  today: string;
  todayLabel: string;
  config: AssistantConfig;
  contact: ContactContext;
  state: AssistantState;
}

export interface TurnResult {
  reply: string | null;
  state: AssistantState;
  outcome: AssistantOutcome;
  intent: string | null;
  confidence: number | null;
  sourceIds: string[];
  flags: string[];
}

const EXPECTATIONS: Partial<Record<AssistantStep, Expectation>> = {
  ask_name: "name",
  ask_question: "free_text",
  ask_next_step: "option",
  ask_preference: "preference",
  choose_slot: "option",
  confirm_slot: "yes_no",
  choose_appointment: "option",
  confirm_cancel: "yes_no",
  confirm_handoff: "yes_no",
  ask_consent: "yes_no",
  clarify_cancel: "option",
  confirm_reschedule_existing: "yes_no",
  confirm_new_booking: "yes_no",
};

const QUESTION_START = /^(qual|quais|como|quando|onde|quanto|quantos|quantas|voces|vcs|tem|pode|posso|e possivel|existe|fazem|aceitam|atendem|trabalham)\b/;

const CONSENT_GRANTED_TEXT =
  "Combinado! Você vai receber por aqui os lembretes e avisos dos seus atendimentos. Para parar, envie PARAR.";

class Turn {
  readonly input: TurnInput;
  state: AssistantState;
  private readonly parts: string[] = [];
  private outcome: AssistantOutcome = "SILENT";
  intent: string | null = null;
  confidence: number | null = null;
  sourceIds: string[] = [];
  readonly flags = new Set<string>();

  constructor(input: TurnInput) {
    this.input = input;
    this.state = structuredClone(input.state);
  }

  get config() {
    return this.input.config;
  }

  firstName(): string {
    const name = this.state.name ?? this.input.contact.firstName ?? "";
    return name.split(/\s+/)[0] ?? "";
  }

  vars(extra: Record<string, string | null | undefined> = {}) {
    return {
      assistente: this.config.assistantName,
      clinica: this.config.clinicName,
      nome: this.firstName(),
      horario_equipe: this.config.teamHoursText ? `Nossa equipe atende ${this.config.teamHoursText}.` : "",
      ...extra,
    };
  }

  say(text: string) {
    const trimmed = text.trim();
    if (trimmed) this.parts.push(trimmed);
  }

  message(key: keyof AssistantMessages, extra: Record<string, string | null | undefined> = {}) {
    this.say(fillTemplate(this.config.messages[key], this.vars(extra)));
  }

  /** Na primeira resposta da conversa o assistente se apresenta (nunca como a Dra. Daniela). */
  introduceIfNeeded() {
    if (this.state.greeted) return;
    this.state.greeted = true;
    this.parts.unshift(fillTemplate(this.config.messages.intro, this.vars()));
  }

  resetFlow() {
    this.state = clearFlow(this.state);
  }

  finish(outcome: AssistantOutcome): TurnResult {
    this.outcome = outcome;
    if (this.parts.length > 0 && outcome !== "OPT_OUT" && outcome !== "OPT_IN") this.introduceIfNeeded();
    this.state.updatedAt = this.input.now.toISOString();
    return {
      reply: this.parts.length > 0 ? this.parts.join("\n\n") : null,
      state: this.state,
      outcome: this.outcome,
      intent: this.intent,
      confidence: this.confidence,
      sourceIds: this.sourceIds,
      flags: [...this.flags],
    };
  }
}

function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(date);
  return `${weekday}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

function numbered(options: string[]): string {
  return options.map((option, index) => `${index + 1}. ${option}`).join("\n");
}

function isQuestion(text: string): boolean {
  return text.includes("?") || QUESTION_START.test(normalizeText(text));
}

/** Escolha de horário por texto ("terça às 14h", "o de sexta"), quando há uma única correspondência. */
function matchSlotByText(text: string, slots: StoredSlot[], today: string): StoredSlot | null {
  const message = normalizeText(text);
  const preference = parseSchedulePreference(text, today);
  const time = /\b(\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|horas)?\b/.exec(message);
  const candidates = slots.filter((slot) => {
    if (preference.date && slot.dateKey !== preference.date) return false;
    if (preference.weekday !== undefined && new Date(`${slot.dateKey}T12:00:00Z`).getUTCDay() !== preference.weekday) {
      return false;
    }
    if (time && /h|:/.test(time[0])) {
      const wanted = `${time[1]!.padStart(2, "0")}:${time[2] ?? "00"}`;
      if (slot.time !== wanted) return false;
    }
    return true;
  });
  const hasCriteria = Boolean(preference.date || preference.weekday !== undefined || (time && /h|:/.test(time[0])));
  return hasCriteria && candidates.length === 1 ? candidates[0]! : null;
}

// -----------------------------------------------------------------------------
// Ações compostas
// -----------------------------------------------------------------------------

async function optOut(turn: Turn, ports: TurnPorts): Promise<TurnResult> {
  await ports.optOut();
  turn.resetFlow();
  turn.message("optOutConfirmation");
  return turn.finish("OPT_OUT");
}

async function optIn(turn: Turn, ports: TurnPorts): Promise<TurnResult> {
  await ports.optIn();
  turn.message("optInConfirmation");
  return turn.finish("OPT_IN");
}

async function handoff(
  turn: Turn,
  ports: TurnPorts,
  reason: string,
  options: { urgent?: boolean; message?: keyof AssistantMessages; prefix?: string } = {},
): Promise<TurnResult> {
  await ports.handoff(reason, { urgent: options.urgent ?? false });
  turn.resetFlow();
  if (options.prefix) turn.say(options.prefix);
  turn.message(options.message ?? "handoff");
  return turn.finish("HANDOFF");
}

async function noAnswer(turn: Turn, ports: TurnPorts, reason: "NO_ANSWER" | "BLOCKED_ANSWER"): Promise<TurnResult> {
  await ports.recordGap(reason, turn.input.maskedText);
  turn.state.unknownCount += 1;
  if (turn.state.unknownCount >= turn.config.limits.maxUnknownBeforeHandoff) {
    turn.state.unknownCount = 0;
    return handoff(turn, ports, "Perguntas sem resposta na base aprovada", {
      prefix: "Não encontrei essa informação nas orientações aprovadas pela clínica.",
    });
  }
  turn.message("noAnswer");
  turn.state.step = "confirm_handoff";
  return turn.finish("NO_ANSWER");
}

async function notUnderstood(turn: Turn, ports: TurnPorts): Promise<TurnResult> {
  turn.state.unknownCount += 1;
  if (turn.state.unknownCount >= turn.config.limits.maxUnknownBeforeHandoff) {
    turn.state.unknownCount = 0;
    return handoff(turn, ports, "O assistente não entendeu as mensagens");
  }
  turn.message("notUnderstood");
  return turn.finish("ASKED");
}

/** Próxima pergunta de cadastro/qualificação (uma por vez) ou o próximo passo. */
function continueQualification(turn: Turn): boolean {
  const { state, config, input } = turn;
  if (input.contact.kind === "patient") return false;
  if (!state.name && !input.contact.firstName) {
    turn.message("askName");
    state.step = "ask_name";
    return true;
  }
  const questions = config.qualification;
  while (state.questionIndex < questions.length) {
    const question = questions[state.questionIndex]!;
    const alreadyKnown =
      (question.field === "interest" && Boolean(state.interest)) || Boolean(state.answers[question.id]);
    if (!alreadyKnown) {
      turn.say(question.question);
      state.step = "ask_question";
      return true;
    }
    state.questionIndex += 1;
  }
  state.qualified = true;
  if (!state.nextStepAsked) {
    state.nextStepAsked = true;
    turn.say(`${fillTemplate(config.messages.askNextStep, turn.vars())}\n1. Agendar\n2. Receber contato da equipe`);
    state.step = "ask_next_step";
    return true;
  }
  return false;
}

async function registerQualified(turn: Turn, ports: TurnPorts, nextStep: "schedule" | "contact") {
  if (turn.state.leadRegistered || turn.input.contact.kind === "patient") return;
  turn.state.leadRegistered = true;
  await ports.registerQualifiedLead({ nextStep, interest: turn.state.interest, answers: turn.state.answers });
}

async function offerSlots(
  turn: Turn,
  ports: TurnPorts,
  preference: SchedulePreference,
  reschedule?: AppointmentOption,
): Promise<TurnResult> {
  const offer = await ports.findSlots({ preference, reschedule });
  if (!offer) {
    return handoff(turn, ports, reschedule ? "Quer remarcar um horário" : "Quer agendar um horário", {
      prefix: "Vou pedir para a equipe verificar os horários disponíveis com você.",
    });
  }
  if (offer.slots.length === 0) {
    return handoff(turn, ports, "Sem horários disponíveis no período configurado", {
      prefix: "No momento não encontrei horários disponíveis nos próximos dias.",
    });
  }
  const { state } = turn;
  state.offeredSlots = offer.slots;
  state.selectedSlot = null;
  state.bookingProcedureName = offer.procedureName;
  state.step = "choose_slot";
  const what = reschedule ? "para remarcar" : `para ${offer.procedureName}`;
  const header = offer.matchedPreference
    ? `Tenho estes horários disponíveis ${what}:`
    : `Não encontrei horário no período que você pediu. Estas são as opções mais próximas ${what}:`;
  turn.say(`${header}\n${numbered(offer.slots.map((slot) => slot.label))}\nResponda com o número da opção que preferir.`);
  return turn.finish("OFFERED_SLOTS");
}

function askSlotConfirmation(turn: Turn, slot: StoredSlot): TurnResult {
  turn.state.selectedSlot = slot;
  turn.state.step = "confirm_slot";
  turn.say(
    turn.state.flow === "rescheduling"
      ? `Confirma a remarcação para ${slot.label}? Responda SIM para confirmar ou NÃO para ver outras opções.`
      : `Confirma ${turn.state.bookingProcedureName ?? "o atendimento"} em ${slot.label}? Responda SIM para confirmar ou NÃO para ver outras opções.`,
  );
  return turn.finish("AWAITING_CONFIRMATION");
}

async function executeSlot(turn: Turn, ports: TurnPorts): Promise<TurnResult> {
  const { state, input, config } = turn;
  const slot = state.selectedSlot;
  if (!slot) return notUnderstood(turn, ports);
  const rescheduling = state.flow === "rescheduling" && state.target;
  const result = rescheduling ? await ports.reschedule(state.target!.id, slot) : await ports.book(slot);

  if (result.ok) {
    const values = {
      data: formatDateLabel(slot.dateKey),
      hora: slot.time,
      procedimento: state.bookingProcedureName ?? "",
    };
    turn.message(rescheduling ? "rescheduled" : "bookingConfirmed", values);
    turn.resetFlow();
    if (config.askReminderConsent && !input.contact.remindersConsent && !input.contact.optedOut && !state.consentAsked) {
      turn.state.consentAsked = true;
      turn.message("consentQuestion");
      turn.state.step = "ask_consent";
    }
    return turn.finish(rescheduling ? "RESCHEDULED" : "BOOKED");
  }

  if (result.reason === "conflict") {
    turn.flags.add("booking_conflict");
    turn.say("Esse horário acabou de ser ocupado.");
    return offerSlots(turn, ports, {}, rescheduling ? state.target! : undefined);
  }
  turn.flags.add("booking_error");
  return handoff(turn, ports, rescheduling ? "Falha ao remarcar pelo assistente" : "Falha ao agendar pelo assistente", {
    prefix: "Não consegui concluir isso agora.",
  });
}

async function startBooking(turn: Turn, ports: TurnPorts, preference: SchedulePreference): Promise<TurnResult> {
  const { state, input } = turn;
  if (input.contact.ambiguous) return handoff(turn, ports, "Telefone compartilhado por mais de um paciente");
  state.flow = "booking";
  if (input.contact.kind === "unknown" && !state.name) {
    state.step = "ask_name";
    turn.message("askName");
    return turn.finish("ASKED");
  }
  if (input.contact.kind !== "patient" && state.name) {
    await ports.ensureLead({ name: state.name, interest: state.interest, procedureId: state.procedureId });
  }
  await registerQualified(turn, ports, "schedule");

  const upcoming = await ports.listUpcomingAppointments();
  if (upcoming.length > 0) {
    const existing = upcoming[0]!;
    state.target = existing;
    state.step = "confirm_reschedule_existing";
    turn.say(`Você já tem um horário marcado: ${existing.label}. Quer remarcar esse horário? Responda SIM ou NÃO.`);
    return turn.finish("AWAITING_CONFIRMATION");
  }
  return offerSlots(turn, ports, preference);
}

async function startReschedule(turn: Turn, ports: TurnPorts, preference: SchedulePreference): Promise<TurnResult> {
  if (turn.input.contact.ambiguous) return handoff(turn, ports, "Telefone compartilhado por mais de um paciente");
  const upcoming = await ports.listUpcomingAppointments();
  if (upcoming.length === 0) {
    turn.resetFlow();
    turn.state.step = "confirm_new_booking";
    turn.say("Não encontrei agendamentos futuros no seu cadastro. Quer agendar um horário? Responda SIM ou NÃO.");
    return turn.finish("ASKED");
  }
  turn.state.flow = "rescheduling";
  if (upcoming.length === 1) {
    turn.state.target = upcoming[0]!;
    return offerSlots(turn, ports, preference, upcoming[0]!);
  }
  turn.state.appointmentOptions = upcoming.slice(0, 5);
  turn.state.step = "choose_appointment";
  turn.say(`Qual agendamento você quer remarcar?\n${numbered(turn.state.appointmentOptions.map((item) => item.label))}\nResponda com o número.`);
  return turn.finish("ASKED");
}

function askCancelConfirmation(turn: Turn, target: AppointmentOption): TurnResult {
  turn.state.target = target;
  turn.state.step = "confirm_cancel";
  turn.say(`Confirma o cancelamento do agendamento de ${target.label}? Responda SIM para cancelar ou NÃO para manter.`);
  return turn.finish("AWAITING_CONFIRMATION");
}

async function startCancel(turn: Turn, ports: TurnPorts): Promise<TurnResult> {
  if (turn.input.contact.ambiguous) return handoff(turn, ports, "Telefone compartilhado por mais de um paciente");
  const upcoming = await ports.listUpcomingAppointments();
  if (upcoming.length === 0) {
    turn.resetFlow();
    turn.say("Não encontrei agendamentos futuros no seu cadastro.");
    return turn.finish("ANSWERED");
  }
  turn.state.flow = "cancelling";
  if (upcoming.length === 1) return askCancelConfirmation(turn, upcoming[0]!);
  turn.state.appointmentOptions = upcoming.slice(0, 5);
  turn.state.step = "choose_appointment";
  turn.say(`Qual agendamento você quer cancelar?\n${numbered(turn.state.appointmentOptions.map((item) => item.label))}\nResponda com o número.`);
  return turn.finish("ASKED");
}

async function executeCancel(turn: Turn, ports: TurnPorts): Promise<TurnResult> {
  const target = turn.state.target;
  if (!target) return notUnderstood(turn, ports);
  const result = await ports.cancelAppointment(target.id);
  if (!result.ok) {
    turn.flags.add("cancel_error");
    return handoff(turn, ports, "Falha ao cancelar pelo assistente", { prefix: "Não consegui concluir o cancelamento agora." });
  }
  turn.resetFlow();
  turn.message("appointmentCancelled", { data: target.dateLabel, hora: target.time });
  return turn.finish("APPOINTMENT_CANCELLED");
}

/** Lembra a pergunta pendente depois de responder uma dúvida no meio do fluxo. */
function repromptPendingStep(turn: Turn) {
  const { state } = turn;
  switch (state.step) {
    case "choose_slot":
      turn.say("Se quiser, escolha um dos horários que enviei respondendo com o número.");
      break;
    case "confirm_slot":
      if (state.selectedSlot) turn.say(`Posso confirmar o horário de ${state.selectedSlot.label}? Responda SIM ou NÃO.`);
      break;
    case "confirm_cancel":
      if (state.target) turn.say(`Ainda quer cancelar o agendamento de ${state.target.label}? Responda SIM ou NÃO.`);
      break;
    default:
      break;
  }
}

// -----------------------------------------------------------------------------
// Etapas pendentes (respostas esperadas)
// -----------------------------------------------------------------------------

async function handlePendingStep(turn: Turn, ports: TurnPorts): Promise<TurnResult | null> {
  const { state, input } = turn;
  const { text } = input;
  const yesNo = parseYesNo(text);

  switch (state.step) {
    case "clarify_cancel": {
      const message = normalizeText(text);
      const option = parseOptionNumber(text, 2);
      if (option === 1 || /\b(agendamento|consulta|horario|avaliacao)\b/.test(message)) return startCancel(turn, ports);
      if (option === 2 || /\b(mensagens?|parar|receber)\b/.test(message)) return optOut(turn, ports);
      state.step = null;
      return null;
    }
    case "ask_name": {
      const intent = classifyIntent(normalizeText(text));
      const looksLikeRequest = intent !== "other" && intent !== "greeting" && intent !== "affirm";
      const procedure = looksLikeRequest ? null : await ports.matchProcedure(text);
      const name = looksLikeRequest || procedure ? null : extractName(text, true);
      if (!name) {
        state.step = null;
        return null;
      }
      state.name = name;
      state.step = null;
      await ports.ensureLead({ name, interest: state.interest, procedureId: state.procedureId });
      if (state.flow === "booking") return startBooking(turn, ports, {});
      turn.say(`Prazer, ${turn.firstName()}!`);
      if (continueQualification(turn)) return turn.finish("ASKED");
      turn.say("Como posso te ajudar?");
      return turn.finish("ASKED");
    }
    case "ask_question": {
      const question = turn.config.qualification[state.questionIndex];
      if (!question || isQuestion(text)) {
        state.step = null;
        return null;
      }
      const answer = input.maskedText.trim().slice(0, 200);
      if (question.field === "interest") {
        const procedure = await ports.matchProcedure(text);
        state.interest = (procedure?.name ?? answer).slice(0, 200);
        state.procedureId = procedure?.id ?? state.procedureId;
        if (state.name) await ports.ensureLead({ name: state.name, interest: state.interest, procedureId: state.procedureId });
      } else if (question.field === "preferred_period") {
        const period = parseSchedulePreference(text, input.today).period;
        state.answers[question.id] = period ? PERIOD_LABELS[period] : answer;
      } else {
        state.answers[question.id] = answer;
      }
      state.questionIndex += 1;
      state.step = null;
      if (continueQualification(turn)) return turn.finish("ASKED");
      turn.say("Anotado! Como posso te ajudar?");
      return turn.finish("ASKED");
    }
    case "ask_next_step": {
      const message = normalizeText(text);
      const option = parseOptionNumber(text, 2);
      if (option === 1 || yesNo === true || /\b(agendar|marcar|avaliacao|horario)\b/.test(message)) {
        state.step = null;
        return startBooking(turn, ports, parseSchedulePreference(text, input.today));
      }
      if (option === 2 || /\b(contato|equipe|ligar|liguem|me liga|retorno|aguardar)\b/.test(message)) {
        state.step = null;
        await registerQualified(turn, ports, "contact");
        turn.message("teamWillContact");
        return turn.finish("ANSWERED");
      }
      if (yesNo === false) {
        state.step = null;
        turn.say("Tudo bem! Se quiser agendar depois, é só me chamar. Posso ajudar com mais alguma coisa?");
        return turn.finish("ANSWERED");
      }
      state.step = null;
      return null;
    }
    case "ask_preference": {
      const preference = parseSchedulePreference(text, input.today);
      if (preference.date || preference.period || preference.weekday !== undefined || yesNo === true) {
        state.step = null;
        return offerSlots(turn, ports, preference, state.flow === "rescheduling" ? (state.target ?? undefined) : undefined);
      }
      state.step = null;
      return null;
    }
    case "choose_slot": {
      const option = parseOptionNumber(text, state.offeredSlots.length);
      const slot = option ? state.offeredSlots[option - 1] : matchSlotByText(text, state.offeredSlots, input.today);
      if (slot) return askSlotConfirmation(turn, slot);
      if (yesNo === false) {
        state.step = "ask_preference";
        turn.say("Sem problemas. Qual dia ou período fica melhor para você?");
        return turn.finish("ASKED");
      }
      const preference = parseSchedulePreference(text, input.today);
      if (preference.date || preference.period || preference.weekday !== undefined) {
        return offerSlots(turn, ports, preference, state.flow === "rescheduling" ? (state.target ?? undefined) : undefined);
      }
      return null;
    }
    case "confirm_slot": {
      if (yesNo === true) return executeSlot(turn, ports);
      if (yesNo === false) {
        state.selectedSlot = null;
        state.step = "ask_preference";
        turn.say("Sem problemas. Qual dia ou período fica melhor para você?");
        return turn.finish("ASKED");
      }
      return null;
    }
    case "choose_appointment": {
      const option = parseOptionNumber(text, state.appointmentOptions.length);
      if (!option) return null;
      const target = state.appointmentOptions[option - 1]!;
      state.appointmentOptions = [];
      if (state.flow === "cancelling") return askCancelConfirmation(turn, target);
      state.target = target;
      return offerSlots(turn, ports, parseSchedulePreference(text, input.today), target);
    }
    case "confirm_cancel": {
      if (yesNo === true) return executeCancel(turn, ports);
      if (yesNo === false) {
        turn.resetFlow();
        turn.say("Tudo bem, seu horário continua marcado.");
        return turn.finish("ANSWERED");
      }
      return null;
    }
    case "confirm_handoff": {
      if (yesNo === true) return handoff(turn, ports, "Pediu a equipe após pergunta sem resposta aprovada");
      state.step = null;
      if (yesNo === false) {
        turn.say("Tudo bem! Posso ajudar com mais alguma coisa?");
        return turn.finish("ANSWERED");
      }
      return null;
    }
    case "ask_consent": {
      state.step = null;
      if (yesNo === true) {
        await ports.grantRemindersConsent();
        turn.say(CONSENT_GRANTED_TEXT);
        return turn.finish("ANSWERED");
      }
      if (yesNo === false) {
        turn.say("Tudo bem, não vou enviar lembretes automáticos. Se precisar de algo, é só chamar.");
        return turn.finish("ANSWERED");
      }
      return null;
    }
    case "confirm_reschedule_existing": {
      if (yesNo === true && state.target) {
        state.flow = "rescheduling";
        return offerSlots(turn, ports, {}, state.target);
      }
      if (yesNo === false) {
        turn.resetFlow();
        turn.say("Tudo bem, seu horário continua marcado. Posso ajudar com mais alguma coisa?");
        return turn.finish("ANSWERED");
      }
      return null;
    }
    case "confirm_new_booking": {
      state.step = null;
      if (yesNo === true) return startBooking(turn, ports, {});
      if (yesNo === false) {
        turn.say("Tudo bem! Se precisar, é só chamar.");
        return turn.finish("ANSWERED");
      }
      return null;
    }
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Turno completo
// -----------------------------------------------------------------------------

function preferenceFrom(interpretation: Interpretation, text: string, today: string): SchedulePreference {
  const parsed = parseSchedulePreference(text, today);
  return {
    period: interpretation.entities.period ?? parsed.period,
    date: interpretation.entities.date ?? parsed.date,
    weekday: interpretation.entities.weekday ?? parsed.weekday,
  };
}

async function answerFromKnowledge(
  turn: Turn,
  ports: TurnPorts,
  interpretation: Interpretation,
  passages: KnowledgePassage[],
): Promise<TurnResult> {
  const { answer } = interpretation;
  if (answer.found) {
    const sources = passages.filter((passage) => answer.sourceIds.includes(passage.id));
    const guard = checkGroundedAnswer(answer.text, sources);
    if (guard.ok) {
      turn.say(answer.text);
      turn.sourceIds = sources.map((source) => source.id);
      turn.state.unknownCount = 0;
      if (turn.state.step) {
        repromptPendingStep(turn);
      } else if (turn.state.flow === "idle") {
        continueQualification(turn);
      }
      return turn.finish("ANSWERED");
    }
    turn.flags.add(`guard:${guard.reason}`);
    return noAnswer(turn, ports, "BLOCKED_ANSWER");
  }
  if (interpretation.intent === "other" && !isQuestion(turn.input.text)) return notUnderstood(turn, ports);
  return noAnswer(turn, ports, "NO_ANSWER");
}

export async function runTurn(input: TurnInput, ports: TurnPorts, model: AssistantModel): Promise<TurnResult> {
  const turn = new Turn(input);
  const { text } = input;

  // 1. Consentimento: vale sempre, inclusive com a equipe atendendo.
  const keyword = detectConsentKeyword(text);
  if (keyword === "opt_out") return optOut(turn, ports);
  if (keyword === "opt_in") return optIn(turn, ports);

  if (input.mode === "HUMAN") {
    turn.flags.add("human_mode");
    return turn.finish("SILENT");
  }

  if (keyword === "ambiguous_cancel") {
    const upcoming = await ports.listUpcomingAppointments();
    if (upcoming.length === 0 && turn.state.flow === "idle") return optOut(turn, ports);
    turn.state.step = "clarify_cancel";
    turn.say("Você quer cancelar um agendamento ou parar de receber mensagens automáticas da clínica?\n1. Cancelar agendamento\n2. Parar de receber mensagens");
    return turn.finish("ASKED");
  }

  // 2. Resposta a uma pergunta pendente (sim/não, número da opção, nome…).
  const pending = await handlePendingStep(turn, ports);
  if (pending) return pending;

  // 3. Interpretação (motor por regras ou Claude) com as entradas aprovadas recuperadas.
  const passages = await ports.searchKnowledge(input.maskedText);
  const options =
    turn.state.step === "choose_slot"
      ? turn.state.offeredSlots.map((slot) => slot.label)
      : turn.state.step === "choose_appointment"
        ? turn.state.appointmentOptions.map((item) => item.label)
        : [];
  const interpretation = await model.interpret({
    text: input.maskedText,
    history: input.history,
    passages,
    expecting: turn.state.step ? (EXPECTATIONS[turn.state.step] ?? null) : null,
    options,
    today: input.today,
    todayLabel: input.todayLabel,
    clinicName: input.config.clinicName,
    assistantName: input.config.assistantName,
  });
  turn.intent = interpretation.intent;
  turn.confidence = interpretation.confidence;

  // Saúde e pedidos de atendimento humano têm prioridade sobre qualquer fluxo.
  if (interpretation.flags.urgent) {
    turn.flags.add("urgent_health");
    return handoff(turn, ports, "Possível urgência de saúde relatada pelo contato", { urgent: true, message: "urgentHealth" });
  }
  if (interpretation.flags.clinical) {
    turn.flags.add("clinical_question");
    return handoff(turn, ports, "Pergunta de saúde: só a equipe responde", { message: "clinicalDeflection" });
  }
  if (interpretation.intent === "human" || interpretation.flags.wantsHuman) {
    return handoff(turn, ports, "Pediu para falar com a equipe");
  }
  if (interpretation.intent === "opt_out") return optOut(turn, ports);
  if (interpretation.intent === "opt_in") return optIn(turn, ports);

  // Escolha de opção reconhecida pelo motor (ex.: "pode ser a de terça").
  if (interpretation.entities.optionNumber && turn.state.step === "choose_slot") {
    const slot = turn.state.offeredSlots[interpretation.entities.optionNumber - 1];
    if (slot) return askSlotConfirmation(turn, slot);
  }

  // Dados citados espontaneamente (nome, procedimento de interesse): o lead é
  // criado/atualizado só quando algo novo foi informado.
  let leadChanged = false;
  if (interpretation.entities.name && !turn.state.name && input.contact.kind !== "patient") {
    turn.state.name = interpretation.entities.name;
    leadChanged = true;
  }
  if (!turn.state.procedureId) {
    const procedure = await ports.matchProcedure(interpretation.entities.procedure ?? text);
    if (procedure) {
      turn.state.procedureId = procedure.id;
      turn.state.interest ??= procedure.name;
      leadChanged = true;
    }
  }
  if (leadChanged && turn.state.name && input.contact.kind !== "patient") {
    await ports.ensureLead({ name: turn.state.name, interest: turn.state.interest, procedureId: turn.state.procedureId });
  }

  const preference = preferenceFrom(interpretation, text, input.today);
  switch (interpretation.intent) {
    case "schedule":
      return startBooking(turn, ports, preference);
    case "reschedule":
      return startReschedule(turn, ports, preference);
    case "cancel_appointment":
      return startCancel(turn, ports);
    case "greeting": {
      if (!turn.state.greeted) {
        turn.state.greeted = true;
        turn.message("greeting");
      } else {
        turn.say(`Olá${turn.firstName() ? `, ${turn.firstName()}` : ""}! Como posso te ajudar?`);
      }
      if (input.contact.kind === "unknown" && !turn.state.name) {
        turn.message("askName");
        turn.state.step = "ask_name";
      }
      return turn.finish("ASKED");
    }
    case "thanks":
      turn.message("closing");
      return turn.finish("ANSWERED");
    case "affirm":
    case "deny":
      turn.say("Certo! Como posso te ajudar?");
      return turn.finish("ASKED");
    default:
      break;
  }

  if (INFORMATIONAL_INTENTS.has(interpretation.intent)) {
    return answerFromKnowledge(turn, ports, interpretation, passages);
  }
  return notUnderstood(turn, ports);
}
