import type { Permission } from "@/lib/auth/permissions";

/**
 * Catálogo dos módulos do CRM: alimenta a navegação e o nome da seção no
 * cabeçalho. Um módulo só é marcado como "available" quando está funcional de
 * ponta a ponta — nunca apenas visual. Módulos "planned" aparecem com o selo
 * da etapa prevista (o histórico de etapas está no README).
 */

export type ModuleIcon =
  | "dashboard"
  | "leads"
  | "patients"
  | "agenda"
  | "procedures"
  | "protocols"
  | "whatsapp"
  | "assistant"
  | "tasks"
  | "team"
  | "audit";

export type ModuleAvailability =
  | { status: "available" }
  | { status: "planned"; stage: number };

export interface AppModule {
  key: string;
  label: string;
  href: string;
  icon: ModuleIcon;
  permission: Permission;
  availability: ModuleAvailability;
  /** Uma frase sobre para que o módulo serve, do ponto de vista da equipe. */
  summary: string;
}

export const MAIN_MODULES: AppModule[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "dashboard",
    permission: "dashboard:view",
    availability: { status: "available" },
    summary: "O dia da clínica em um só lugar: agenda, retornos, ações comerciais e indicadores.",
  },
  {
    key: "leads",
    label: "Leads",
    href: "/leads",
    icon: "leads",
    permission: "leads:read",
    availability: { status: "available" },
    summary: "Cada pessoa interessada, do primeiro contato até virar paciente.",
  },
  {
    key: "patients",
    label: "Pacientes",
    href: "/pacientes",
    icon: "patients",
    permission: "patients:read",
    availability: { status: "available" },
    summary: "Ficha com agenda, procedimentos, protocolos, retornos, mensagens e observações.",
  },
  {
    key: "agenda",
    label: "Agenda",
    href: "/agenda",
    icon: "agenda",
    permission: "appointments:read",
    availability: { status: "available" },
    summary: "Horários por dia, semana e mês, sem conflitos e com histórico de remarcações.",
  },
  {
    key: "protocols",
    label: "Protocolos e retornos",
    href: "/protocolos",
    icon: "protocols",
    permission: "returns:read",
    availability: { status: "available" },
    summary: "Intervalos definidos pela profissional transformados em retornos e lembretes.",
  },
  {
    key: "procedures",
    label: "Procedimentos",
    href: "/procedimentos",
    icon: "procedures",
    permission: "procedures:read",
    availability: { status: "available" },
    summary: "Catálogo de serviços: duração na agenda, preço de referência e intervalo de retorno.",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    href: "/whatsapp",
    icon: "whatsapp",
    permission: "whatsapp:read",
    availability: { status: "available" },
    summary: "Caixa de entrada com o assistente virtual e a equipe, pela API oficial do WhatsApp Business.",
  },
  {
    key: "tasks",
    label: "Tarefas",
    href: "/tarefas",
    icon: "tasks",
    permission: "tasks:work",
    availability: { status: "available" },
    summary: "Conversas encaminhadas, oportunidades qualificadas e contatos de acompanhamento.",
  },
  {
    key: "assistant",
    label: "Assistente virtual",
    href: "/assistente",
    icon: "assistant",
    permission: "knowledge:read",
    availability: { status: "available" },
    summary: "Base de conhecimento aprovada, configurações, modelos da Meta, consentimentos e métricas.",
  },
];

export const ADMIN_MODULES: AppModule[] = [
  {
    key: "team",
    label: "Equipe",
    href: "/equipe",
    icon: "team",
    permission: "users:manage",
    availability: { status: "available" },
    summary: "Contas de acesso, perfis de permissão e senhas provisórias.",
  },
  {
    key: "audit",
    label: "Auditoria",
    href: "/auditoria",
    icon: "audit",
    permission: "audit:read",
    availability: { status: "available" },
    summary: "Quem fez o quê e quando: acessos, alterações e consultas a dados sensíveis.",
  },
];
