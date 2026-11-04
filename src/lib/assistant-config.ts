import { z } from "zod";

import { isTimeOfDay } from "@/lib/datetime";

/**
 * Configurações do assistente virtual do WhatsApp, editáveis pela equipe
 * (Assistente › Configurações) sem alterar código. Isomórfico: o formulário
 * usa os tipos; o servidor valida tudo de novo antes de gravar.
 *
 * Os textos aceitam marcadores substituídos na hora do envio:
 * {assistente}, {clinica}, {nome}, {data}, {hora}, {procedimento}, {horario_equipe}.
 * Nenhum padrão afirma fatos sobre a clínica (preços, endereço, horários):
 * essas informações vêm só da base de conhecimento aprovada.
 */

const message = (max: number) => z.string().trim().min(2, { error: "Escreva a mensagem." }).max(max);

const timeOfDay = z.string().refine(isTimeOfDay, { error: "Horário inválido (use HH:MM)." });

const timeRangeSchema = z
  .object({ start: timeOfDay, end: timeOfDay })
  .refine((range) => range.start < range.end, { error: "O fim deve ser depois do início." });

export const QUALIFICATION_FIELDS = ["interest", "preferred_period", "how_found", "custom"] as const;
export type QualificationField = (typeof QUALIFICATION_FIELDS)[number];

export const QUALIFICATION_FIELD_LABELS: Record<QualificationField, string> = {
  interest: "Interesse (procedimento ou tratamento)",
  preferred_period: "Período preferido para atendimento",
  how_found: "Como conheceu a clínica",
  custom: "Outra informação (texto livre)",
};

export const qualificationQuestionSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,30}$/, { error: "Use letras minúsculas, números e _." }),
  field: z.enum(QUALIFICATION_FIELDS),
  question: message(200),
});

export type QualificationQuestion = z.output<typeof qualificationQuestionSchema>;

export const assistantMessagesSchema = z.object({
  /** Apresentação curta usada na primeira resposta quando a conversa já começa com uma pergunta. */
  intro: message(200),
  greeting: message(500),
  askName: message(200),
  askNextStep: message(300),
  teamWillContact: message(300),
  handoff: message(400),
  noAnswer: message(400),
  notUnderstood: message(400),
  clinicalDeflection: message(500),
  urgentHealth: message(500),
  optOutConfirmation: message(400),
  optInConfirmation: message(400),
  consentQuestion: message(300),
  bookingConfirmed: message(500),
  rescheduled: message(400),
  appointmentCancelled: message(400),
  closing: message(200),
});

export type AssistantMessages = z.output<typeof assistantMessagesSchema>;

/** Horários por dia da semana (índice 0 = domingo … 6 = sábado). */
const weeklyHoursSchema = z.array(z.array(timeRangeSchema).max(3)).length(7);

export const assistantConfigSchema = z.object({
  /** Liga/desliga o assistente para todas as conversas. */
  enabled: z.boolean(),
  assistantName: z.string().trim().min(2).max(60),
  clinicName: z.string().trim().min(2).max(80),
  /** Horário em que a equipe responde (texto livre, usado em {horario_equipe}). Vazio = não informar. */
  teamHoursText: z.string().trim().max(120),
  messages: assistantMessagesSchema,
  qualification: z.array(qualificationQuestionSchema).max(6),
  /** Pergunta, após agendar, se o contato aceita lembretes pelo WhatsApp (consentimento registrado). */
  askReminderConsent: z.boolean(),
  booking: z.object({
    /** O assistente só agenda quando a clínica ativa e configura esta seção. */
    enabled: z.boolean(),
    /** Procedimento agendado pelo assistente (ex.: avaliação). Duração vem do catálogo. */
    procedureId: z.uuid().nullable(),
    professionalIds: z.array(z.uuid()).max(10),
    weeklyHours: weeklyHoursSchema,
    slotStepMinutes: z.number().int().min(10).max(120),
    /** Antecedência mínima entre a conversa e o horário oferecido. */
    minNoticeHours: z.number().int().min(0).max(168),
    maxDaysAhead: z.number().int().min(1).max(90),
    maxOptions: z.number().int().min(2).max(6),
  }),
  /** Mensagens iniciadas pela clínica (lembretes e acompanhamento). */
  proactive: z.object({
    allowedWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startTime: timeOfDay,
    endTime: timeOfDay,
    maxPerDay: z.number().int().min(1).max(5),
    maxPerWeek: z.number().int().min(1).max(14),
  }),
  limits: z.object({
    /** Respostas automáticas por conversa por hora (proteção contra repetição e outros robôs). */
    maxRepliesPerHour: z.number().int().min(5).max(60),
    /** Mensagens não entendidas seguidas antes de chamar a equipe. */
    maxUnknownBeforeHandoff: z.number().int().min(1).max(5),
    /** Depois disso, um fluxo interrompido (ex.: horários oferecidos) recomeça. */
    stateTtlHours: z.number().int().min(1).max(72),
  }),
});

export type AssistantConfig = z.output<typeof assistantConfigSchema>;

export const DEFAULT_ASSISTANT_MESSAGES: AssistantMessages = {
  intro: "Olá! Eu sou {assistente}, assistente virtual da {clinica}.",
  greeting:
    "Olá! Eu sou {assistente}, assistente virtual da {clinica}. Posso ajudar com informações sobre procedimentos, valores e agendamentos. Se preferir falar com uma pessoa da equipe, é só pedir.",
  askName: "Para eu te atender melhor, como posso te chamar?",
  askNextStep: "Você gostaria de agendar uma avaliação ou prefere que alguém da equipe entre em contato?",
  teamWillContact: "Perfeito, {nome}! Registrei seu interesse e a equipe vai falar com você por aqui. {horario_equipe}",
  handoff: "Vou chamar alguém da equipe para continuar o seu atendimento. Você recebe a resposta por aqui. {horario_equipe}",
  noAnswer:
    "Não encontrei essa informação nas orientações aprovadas pela clínica e prefiro não arriscar uma resposta. Quer que eu peça para alguém da equipe te responder?",
  notUnderstood:
    "Desculpe, não entendi. Posso ajudar com informações sobre procedimentos, valores, horários e agendamentos, ou chamar alguém da equipe.",
  clinicalDeflection:
    "Essa é uma dúvida de saúde que precisa ser avaliada pela profissional, e eu não posso orientar por aqui. Já avisei a equipe para falar com você.",
  urgentHealth:
    "Sinto muito que você esteja passando por isso. Se for uma urgência, procure atendimento médico imediatamente ou ligue para o SAMU (192). Já avisei a equipe da clínica com prioridade.",
  optOutConfirmation:
    "Pronto, você não vai mais receber mensagens automáticas da clínica por aqui. Se mudar de ideia, envie VOLTAR. Se precisar de algo, é só escrever.",
  optInConfirmation:
    "Combinado! Você voltará a receber lembretes e avisos sobre seus atendimentos por aqui. Para parar, envie PARAR.",
  consentQuestion: "Posso te enviar por aqui lembretes e avisos sobre seus atendimentos? Responda SIM ou NÃO.",
  bookingConfirmed:
    "Pronto, {nome}! Seu horário está agendado para {data} às {hora} ({procedimento}). Se precisar remarcar ou cancelar, é só me avisar por aqui.",
  rescheduled: "Pronto! Seu horário foi remarcado para {data} às {hora}.",
  appointmentCancelled:
    "Seu agendamento de {data} às {hora} foi cancelado. Se quiser marcar outro horário, é só me chamar.",
  closing: "Por nada! Se precisar de algo, é só chamar.",
};

/** Seg–sex, 9h–18h: apenas ponto de partida — a clínica ajusta antes de ativar o agendamento. */
const DEFAULT_WEEKLY_HOURS: AssistantConfig["booking"]["weeklyHours"] = [
  [],
  [{ start: "09:00", end: "18:00" }],
  [{ start: "09:00", end: "18:00" }],
  [{ start: "09:00", end: "18:00" }],
  [{ start: "09:00", end: "18:00" }],
  [{ start: "09:00", end: "18:00" }],
  [],
];

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  enabled: true,
  assistantName: "Assistente virtual",
  clinicName: "Clínica Dra. Daniela Zilioli",
  teamHoursText: "",
  messages: DEFAULT_ASSISTANT_MESSAGES,
  qualification: [
    { id: "interesse", field: "interest", question: "Qual procedimento ou tratamento você tem interesse em conhecer?" },
    { id: "periodo", field: "preferred_period", question: "Qual período costuma ser melhor para você: manhã, tarde ou noite?" },
  ],
  askReminderConsent: true,
  booking: {
    enabled: false,
    procedureId: null,
    professionalIds: [],
    weeklyHours: DEFAULT_WEEKLY_HOURS,
    slotStepMinutes: 30,
    minNoticeHours: 12,
    maxDaysAhead: 21,
    maxOptions: 4,
  },
  proactive: {
    allowedWeekdays: [1, 2, 3, 4, 5, 6],
    startTime: "08:00",
    endTime: "20:00",
    maxPerDay: 1,
    maxPerWeek: 3,
  },
  limits: { maxRepliesPerHour: 20, maxUnknownBeforeHandoff: 2, stateTtlHours: 24 },
};

/**
 * Lê a configuração gravada, completando campos ausentes com os padrões
 * (configurações antigas continuam válidas após atualizações do sistema).
 * Se o conteúdo gravado for inválido, usa os padrões — nunca quebra o atendimento.
 */
export function resolveAssistantConfig(stored: unknown): AssistantConfig {
  if (!stored || typeof stored !== "object") return DEFAULT_ASSISTANT_CONFIG;
  const value = stored as Partial<AssistantConfig>;
  const merged = {
    ...DEFAULT_ASSISTANT_CONFIG,
    ...value,
    messages: { ...DEFAULT_ASSISTANT_MESSAGES, ...(value.messages ?? {}) },
    booking: { ...DEFAULT_ASSISTANT_CONFIG.booking, ...(value.booking ?? {}) },
    proactive: { ...DEFAULT_ASSISTANT_CONFIG.proactive, ...(value.proactive ?? {}) },
    limits: { ...DEFAULT_ASSISTANT_CONFIG.limits, ...(value.limits ?? {}) },
  };
  const parsed = assistantConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_ASSISTANT_CONFIG;
}

/** Substitui os marcadores ({nome}, {data}…) e remove os que ficaram sem valor. */
export function fillTemplate(text: string, values: Record<string, string | null | undefined>): string {
  return text
    .replace(/\{([a-z_]+)\}/g, (_, key: string) => values[key]?.trim() ?? "")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/,\s*!/g, "!")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
