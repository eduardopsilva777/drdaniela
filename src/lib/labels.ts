import type {
  AppointmentEventType,
  AppointmentStatus,
  AssistantOutcome,
  ConsentPurpose,
  ConsentSource,
  ConversationMode,
  FollowUpAction,
  InteractionType,
  KnowledgeCategory,
  KnowledgeGapReason,
  KnowledgeVersionStatus,
  LeadPriority,
  LeadSource,
  LeadStatus,
  MessageOrigin,
  MessageStatus,
  NoteVisibility,
  PatientProtocolStatus,
  ProtocolStepAnchor,
  ProtocolStepKind,
  ReminderChannel,
  ReminderKind,
  ReminderStatus,
  ReturnKind,
  ReturnStatus,
  TaskKind,
  TaskStatus,
  TemplateCategory,
  TemplateStatus,
  TemplateUsage,
} from "@/generated/prisma/enums";

/** Rótulos em português e tons de cor dos valores de domínio (isomórfico). */

export type Tone = "neutral" | "primary" | "warning" | "info" | "success" | "danger" | "muted";

export const LEAD_STATUS_ORDER: LeadStatus[] = ["NEW", "IN_PROGRESS", "SCHEDULED", "CONVERTED", "LOST"];
/** Etapas "abertas" do funil, na ordem em que um lead avança. */
export const FUNNEL_STAGES: LeadStatus[] = ["NEW", "IN_PROGRESS", "SCHEDULED", "CONVERTED"];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "Novo",
  IN_PROGRESS: "Em atendimento",
  SCHEDULED: "Agendado",
  CONVERTED: "Convertido",
  LOST: "Perdido",
};

export const LEAD_STATUS_TONES: Record<LeadStatus, Tone> = {
  NEW: "neutral",
  IN_PROGRESS: "warning",
  SCHEDULED: "info",
  CONVERTED: "success",
  LOST: "danger",
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  INSTAGRAM: "Instagram",
  WHATSAPP: "WhatsApp",
  FACEBOOK: "Facebook",
  GOOGLE: "Google",
  WEBSITE: "Site",
  REFERRAL: "Indicação",
  WALK_IN: "Presencial",
  OTHER: "Outra",
};

export const LEAD_PRIORITY_LABELS: Record<LeadPriority, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
};

export const LEAD_PRIORITY_TONES: Record<LeadPriority, Tone> = {
  LOW: "muted",
  MEDIUM: "neutral",
  HIGH: "primary",
};

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  NOTE: "Nota",
  CALL: "Ligação",
  WHATSAPP: "Mensagem",
  EMAIL: "E-mail",
  IN_PERSON: "Atendimento presencial",
  STATUS_CHANGE: "Mudança de etapa",
  SYSTEM: "Registro automático",
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Não compareceu",
};

export const APPOINTMENT_STATUS_TONES: Record<AppointmentStatus, Tone> = {
  SCHEDULED: "info",
  CONFIRMED: "primary",
  COMPLETED: "success",
  CANCELLED: "muted",
  NO_SHOW: "danger",
};

export const APPOINTMENT_EVENT_LABELS: Record<AppointmentEventType, string> = {
  CREATED: "Agendamento criado",
  RESCHEDULED: "Reagendado",
  STATUS_CHANGED: "Status alterado",
  UPDATED: "Dados alterados",
};

export const RETURN_KIND_LABELS: Record<ReturnKind, string> = {
  SESSION: "Sessão",
  REVIEW: "Revisão",
  MAINTENANCE: "Manutenção",
  CUSTOM: "Retorno",
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  PENDING: "Pendente",
  SCHEDULED: "Agendado",
  COMPLETED: "Compareceu",
  MISSED: "Não compareceu",
  CANCELLED: "Cancelado",
};

export const RETURN_STATUS_TONES: Record<ReturnStatus, Tone> = {
  PENDING: "warning",
  SCHEDULED: "info",
  COMPLETED: "success",
  MISSED: "danger",
  CANCELLED: "muted",
};

export const PROTOCOL_STEP_KIND_LABELS: Record<ProtocolStepKind, string> = {
  SESSION: "Sessão",
  REVIEW: "Revisão",
  MAINTENANCE: "Manutenção",
};

export const PROTOCOL_ANCHOR_LABELS: Record<ProtocolStepAnchor, string> = {
  START: "após o início",
  PREVIOUS: "após a etapa anterior",
};

export const PATIENT_PROTOCOL_STATUS_LABELS: Record<PatientProtocolStatus, string> = {
  ACTIVE: "Em andamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

export const PATIENT_PROTOCOL_STATUS_TONES: Record<PatientProtocolStatus, Tone> = {
  ACTIVE: "primary",
  COMPLETED: "success",
  CANCELLED: "muted",
};

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  RETURN: "Retorno",
  APPOINTMENT: "Agendamento",
};

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  PENDING: "Pendente",
  PROCESSING: "Processando",
  SENT: "Enviado",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  PAUSED: "Pausado",
};

export const REMINDER_STATUS_TONES: Record<ReminderStatus, Tone> = {
  PENDING: "warning",
  PROCESSING: "info",
  SENT: "success",
  FAILED: "danger",
  CANCELLED: "muted",
  PAUSED: "neutral",
};

export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel, string> = {
  WHATSAPP: "WhatsApp",
  TASK: "Tarefa da equipe",
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  PENDING: "Enviando",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falhou",
  RECEIVED: "Recebida",
  SIMULATED: "Simulada",
};

export const NOTE_VISIBILITY_LABELS: Record<NoteVisibility, string> = {
  CLINICAL: "Clínica (restrita)",
  ADMINISTRATIVE: "Administrativa",
};

// -----------------------------------------------------------------------------
// Assistente virtual, base de conhecimento, modelos, consentimentos e tarefas
// -----------------------------------------------------------------------------

export const CONVERSATION_MODE_LABELS: Record<ConversationMode, string> = {
  ASSISTANT: "Assistente virtual",
  HUMAN: "Equipe",
};

export const MESSAGE_ORIGIN_LABELS: Record<MessageOrigin, string> = {
  CONTACT: "Contato",
  STAFF: "Equipe",
  ASSISTANT: "Assistente virtual",
  REMINDER: "Lembrete automático",
  FOLLOW_UP: "Acompanhamento automático",
  SYSTEM: "Aviso automático",
};

export const ASSISTANT_OUTCOME_LABELS: Record<AssistantOutcome, string> = {
  ANSWERED: "Respondeu com a base aprovada",
  ASKED: "Fez uma pergunta",
  OFFERED_SLOTS: "Ofereceu horários",
  AWAITING_CONFIRMATION: "Aguardando confirmação",
  BOOKED: "Agendou",
  RESCHEDULED: "Remarcou",
  APPOINTMENT_CANCELLED: "Cancelou agendamento",
  HANDOFF: "Encaminhou para a equipe",
  NO_ANSWER: "Sem resposta aprovada",
  OPT_OUT: "Descadastro",
  OPT_IN: "Recadastro",
  SILENT: "Não respondeu",
  ERROR: "Erro",
};

export const ASSISTANT_OUTCOME_TONES: Record<AssistantOutcome, Tone> = {
  ANSWERED: "success",
  ASKED: "neutral",
  OFFERED_SLOTS: "info",
  AWAITING_CONFIRMATION: "info",
  BOOKED: "success",
  RESCHEDULED: "success",
  APPOINTMENT_CANCELLED: "muted",
  HANDOFF: "warning",
  NO_ANSWER: "warning",
  OPT_OUT: "danger",
  OPT_IN: "success",
  SILENT: "muted",
  ERROR: "danger",
};

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  SERVICE: "Serviços e procedimentos",
  PRICING: "Preços e condições",
  CLINIC_INFO: "Horários, endereço e contato",
  POLICY: "Políticas da clínica",
  FAQ: "Perguntas frequentes",
  SCHEDULING: "Agendamento e preparo",
};

export const KNOWLEDGE_VERSION_STATUS_LABELS: Record<KnowledgeVersionStatus, string> = {
  DRAFT: "Rascunho",
  IN_REVIEW: "Aguardando aprovação",
  APPROVED: "Aprovada",
  REJECTED: "Recusada",
  SUPERSEDED: "Substituída",
};

export const KNOWLEDGE_VERSION_STATUS_TONES: Record<KnowledgeVersionStatus, Tone> = {
  DRAFT: "muted",
  IN_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUPERSEDED: "neutral",
};

export const KNOWLEDGE_GAP_REASON_LABELS: Record<KnowledgeGapReason, string> = {
  NO_ANSWER: "Sem resposta na base",
  NEGATIVE_FEEDBACK: "Avaliada negativamente",
  BLOCKED_ANSWER: "Resposta bloqueada na checagem",
};

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  DRAFT: "Rascunho (não enviado à Meta)",
  PENDING: "Em análise na Meta",
  APPROVED: "Aprovado",
  REJECTED: "Recusado",
  PAUSED: "Pausado pela Meta",
  DISABLED: "Desativado",
};

export const TEMPLATE_STATUS_TONES: Record<TemplateStatus, Tone> = {
  DRAFT: "muted",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  PAUSED: "warning",
  DISABLED: "muted",
};

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  UTILITY: "Utilidade (transacional)",
  MARKETING: "Marketing (exige consentimento de marketing)",
};

export const TEMPLATE_USAGE_LABELS: Record<TemplateUsage, string> = {
  APPOINTMENT_REMINDER: "Lembrete de agendamento",
  RETURN_REMINDER: "Lembrete de retorno (padrão)",
  FOLLOW_UP: "Acompanhamento de protocolo",
};

/** O que preenche cada parâmetro de um modelo ({{1}}, {{2}}…), na ordem. */
export const TEMPLATE_PARAMETERS = [
  "patient_name",
  "procedure_name",
  "due_date",
  "appointment_date",
  "appointment_time",
  "clinic_name",
] as const;

export type TemplateParameter = (typeof TEMPLATE_PARAMETERS)[number];

export const TEMPLATE_PARAMETER_LABELS: Record<TemplateParameter, string> = {
  patient_name: "Primeiro nome do paciente",
  procedure_name: "Procedimento",
  due_date: "Data prevista do retorno",
  appointment_date: "Data do agendamento",
  appointment_time: "Horário do agendamento",
  clinic_name: "Nome da clínica",
};

export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  WHATSAPP: "Lembretes e avisos pelo WhatsApp",
  MARKETING: "Mensagens promocionais",
};

export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  STAFF: "Registrado pela equipe",
  CONTACT_KEYWORD: "Palavra-chave do contato",
  ASSISTANT: "Resposta ao assistente virtual",
};

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  HANDOFF: "Atender conversa",
  QUALIFIED_LEAD: "Oportunidade qualificada",
  FOLLOW_UP: "Acompanhamento de protocolo",
  AUTOMATION_FAILURE: "Falha de automação",
};

export const TASK_KIND_TONES: Record<TaskKind, Tone> = {
  HANDOFF: "primary",
  QUALIFIED_LEAD: "success",
  FOLLOW_UP: "info",
  AUTOMATION_FAILURE: "danger",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Aberta",
  DONE: "Concluída",
  CANCELLED: "Cancelada",
};

export const FOLLOW_UP_ACTION_LABELS: Record<FollowUpAction, string> = {
  MESSAGE: "Mensagem pelo WhatsApp (modelo aprovado)",
  TASK: "Tarefa para a equipe",
};
