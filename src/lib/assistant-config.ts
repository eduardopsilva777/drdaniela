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

const personaText = (max: number) => z.string().trim().max(max, { error: `Use no máximo ${max} caracteres.` });

export const FORMALITY_LEVELS = ["informal", "balanced", "formal"] as const;
export type FormalityLevel = (typeof FORMALITY_LEVELS)[number];

export const FORMALITY_LABELS: Record<FormalityLevel, string> = {
  informal: "Descontraída (próxima, linguagem do dia a dia)",
  balanced: "Equilibrada (cordial e profissional)",
  formal: "Formal (\"senhor\"/\"senhora\", sem gírias)",
};

/**
 * Identidade e comportamento da IA generativa (motor "agente"). A equipe
 * descreve QUEM a assistente é e COMO conversa — nunca as frases prontas: cada
 * resposta é gerada na hora, a partir desta configuração, do contexto do
 * contato, da base aprovada e das ferramentas do CRM. As regras de segurança do
 * sistema (não inventar fatos, não orientar clinicamente, confirmação explícita)
 * prevalecem sobre qualquer texto daqui.
 */
export const assistantPersonaSchema = z.object({
  personality: personaText(1500).min(10, { error: "Descreva a personalidade em uma ou duas frases." }),
  toneOfVoice: personaText(300),
  formality: z.enum(FORMALITY_LEVELS),
  communicationStyle: personaText(600),
  businessGoals: personaText(1000),
  newContactApproach: personaText(600),
  questionStyle: personaText(500),
  extraLimits: personaText(1000),
  handoffRules: personaText(800),
});

export type AssistantPersona = z.output<typeof assistantPersonaSchema>;

/** Limites de custo e de comportamento da IA generativa. */
export const assistantAgentSchema = z.object({
  /** Tamanho máximo de cada resposta enviada ao contato. */
  maxReplyChars: z.number().int().min(200).max(1500),
  /** Mensagens recentes enviadas ao modelo a cada turno (o resto fica nas notas da conversa). */
  historyMessages: z.number().int().min(4).max(40),
  /** Chamadas ao modelo por mensagem recebida (cada uso de ferramenta pede uma nova chamada). */
  maxModelCallsPerTurn: z.number().int().min(2).max(8),
  /** Preços do catálogo de procedimentos podem ser informados (senão, só os da base aprovada). */
  shareCatalogPrices: z.boolean(),
  /** Gasto máximo estimado por mês (US$). Atingido, o atendimento segue pelo motor por regras. */
  monthlyBudgetUsd: z.number().min(1).max(10_000),
  followUp: z.object({
    /** Mensagem de acompanhamento gerada pela IA quando o contato para de responder (só dentro da janela de 24h). */
    enabled: z.boolean(),
    /** Horas de silêncio do contato antes do acompanhamento. */
    nudgeAfterHours: z.number().int().min(1).max(20),
    /** Dias sem resposta para avisar a equipe sobre o lead parado (fora da janela, só modelo aprovado). */
    staleLeadDays: z.number().int().min(1).max(30),
  }),
});

export type AssistantAgentSettings = z.output<typeof assistantAgentSchema>;

/** Horários por dia da semana (índice 0 = domingo … 6 = sábado). */
const weeklyHoursSchema = z.array(z.array(timeRangeSchema).max(3)).length(7);

export const assistantConfigSchema = z.object({
  /** Liga/desliga o assistente para todas as conversas. */
  enabled: z.boolean(),
  assistantName: z.string().trim().min(2).max(60),
  clinicName: z.string().trim().min(2).max(80),
  /** Horário em que a equipe responde (texto livre, usado em {horario_equipe}). Vazio = não informar. */
  teamHoursText: z.string().trim().max(120),
  /** Identidade e comportamento da IA generativa (ignorados pelos motores por regras e guiado). */
  persona: assistantPersonaSchema,
  agent: assistantAgentSchema,
  /**
   * Textos usados pelos motores por regras e guiado e, na IA generativa, só nas
   * mensagens de segurança (urgência, descadastro, falha) e de consentimento.
   */
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

export const DEFAULT_ASSISTANT_PERSONA: AssistantPersona = {
  personality:
    "Você é a assistente virtual da clínica. É acolhedora, simpática, inteligente e profissional. Conversa naturalmente, sem parecer um robô, entende o que cada pessoa procura e conduz o atendimento com empatia. Nunca inventa informações e sabe quando encaminhar para a equipe.",
  toneOfVoice: "Caloroso, elegante e próximo, sem exageros nem bajulação.",
  formality: "balanced",
  communicationStyle:
    "Mensagens curtas, como numa conversa de WhatsApp: em geral até três frases e no máximo uma pergunta por vez. Emojis com moderação (no máximo um por mensagem). Sem listas longas nem textos de propaganda.",
  businessGoals:
    "Entender o que cada pessoa procura, esclarecer dúvidas com as informações aprovadas e, quando fizer sentido, convidar para uma avaliação. Registrar o interesse para a equipe acompanhar as oportunidades.",
  newContactApproach:
    "Acolha, apresente-se como assistente virtual da clínica e descubra com naturalidade o nome e o interesse da pessoa, sem interrogatório.",
  questionStyle:
    "Pergunte só o que ajuda a avançar o atendimento, uma coisa de cada vez, e nunca repita perguntas já respondidas.",
  extraLimits: "Não comente concorrentes. Não ofereça descontos, brindes ou condições que não estejam na base aprovada.",
  handoffRules:
    "Encaminhe para a equipe quando a pessoa pedir, em qualquer dúvida de saúde, reclamação ou insatisfação, negociação de valores fora do que está aprovado, ou quando você não tiver a informação.",
};

export const DEFAULT_ASSISTANT_AGENT: AssistantAgentSettings = {
  maxReplyChars: 700,
  historyMessages: 16,
  maxModelCallsPerTurn: 5,
  shareCatalogPrices: false,
  monthlyBudgetUsd: 50,
  followUp: { enabled: false, nudgeAfterHours: 4, staleLeadDays: 3 },
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
  persona: DEFAULT_ASSISTANT_PERSONA,
  agent: DEFAULT_ASSISTANT_AGENT,
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
    persona: { ...DEFAULT_ASSISTANT_PERSONA, ...(value.persona ?? {}) },
    agent: {
      ...DEFAULT_ASSISTANT_AGENT,
      ...(value.agent ?? {}),
      followUp: { ...DEFAULT_ASSISTANT_AGENT.followUp, ...(value.agent?.followUp ?? {}) },
    },
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
