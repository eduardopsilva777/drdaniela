import type { Permission } from "@/lib/auth/permissions";

/**
 * Catálogo dos módulos do CRM: alimenta a navegação, o painel de implantação
 * e as páginas de módulos ainda não entregues. Um módulo só é marcado como
 * "available" quando está funcional de ponta a ponta — nunca apenas visual.
 */

export type ModuleIcon =
  | "dashboard"
  | "leads"
  | "patients"
  | "agenda"
  | "protocols"
  | "whatsapp"
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
  /** O que o módulo entrega quando estiver concluído. */
  scope: string[];
}

export const MAIN_MODULES: AppModule[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "dashboard",
    permission: "dashboard:view",
    // A página inicial já existe; os indicadores chegam na etapa 6 (ver ROLLOUT_STAGES).
    availability: { status: "available" },
    summary: "O dia da clínica em um só lugar: leads, agenda, retornos e conversão.",
    scope: [],
  },
  {
    key: "leads",
    label: "Leads",
    href: "/leads",
    icon: "leads",
    permission: "leads:read",
    availability: { status: "planned", stage: 2 },
    summary: "Acompanhe cada pessoa interessada do primeiro contato até virar paciente.",
    scope: [
      "Cadastro com nome, telefone, origem e interesse",
      "Funil: Novo, Em atendimento, Agendado, Convertido e Perdido",
      "Busca, filtros e mudança de status",
      "Histórico de interações de cada lead",
      "Conversão do lead em paciente",
    ],
  },
  {
    key: "patients",
    label: "Pacientes",
    href: "/pacientes",
    icon: "patients",
    permission: "patients:read",
    availability: { status: "planned", stage: 3 },
    summary: "Ficha de cada paciente com todo o histórico de relacionamento com a clínica.",
    scope: [
      "Cadastro e edição de pacientes",
      "Histórico de agendamentos, procedimentos e mensagens",
      "Observações clínicas visíveis só para profissionais, com registro de cada acesso",
    ],
  },
  {
    key: "agenda",
    label: "Agenda",
    href: "/agenda",
    icon: "agenda",
    permission: "appointments:read",
    availability: { status: "planned", stage: 4 },
    summary: "Horários da clínica por dia e por semana, sem conflitos.",
    scope: [
      "Visualização diária e semanal",
      "Criar, editar e cancelar agendamentos",
      "Vínculo com paciente e procedimento",
      "Status: Agendado, Confirmado, Concluído e Cancelado",
      "Bloqueio de horários sobrepostos — a regra já está ativa no banco de dados",
    ],
  },
  {
    key: "protocols",
    label: "Protocolos e retornos",
    href: "/protocolos",
    icon: "protocols",
    permission: "returns:read",
    availability: { status: "planned", stage: 5 },
    summary: "Intervalos de retorno definidos pela profissional, transformados em lembretes.",
    scope: [
      "Cadastro de procedimentos",
      "Protocolos com intervalos de retorno definidos pela profissional",
      "Vínculo de protocolos aos pacientes e registro das datas realizadas",
      "Lembretes de retornos pendentes e próximos",
    ],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    href: "/whatsapp",
    icon: "whatsapp",
    permission: "whatsapp:read",
    availability: { status: "planned", stage: 7 },
    summary: "Conversas com pacientes e leads registradas junto ao histórico de cada um.",
    scope: [
      "Estrutura pronta para a API oficial do WhatsApp Business",
      "Registro de conversas, mensagens, status de entrega e leitura",
      "Recebimento de eventos por webhook com verificação de assinatura",
      "Envio real habilitado após a definição do provedor e das credenciais",
    ],
  },
];

export const ADMIN_MODULES: AppModule[] = [
  {
    key: "audit",
    label: "Auditoria",
    href: "/auditoria",
    icon: "audit",
    permission: "audit:read",
    availability: { status: "available" },
    summary: "Quem acessou o sistema e quando: entradas, saídas e tentativas bloqueadas.",
    scope: [],
  },
];

export interface RolloutStage {
  stage: number;
  title: string;
  detail: string;
  status: "available" | "planned";
}

/** Etapas de implantação do sistema, na ordem de entrega. */
export const ROLLOUT_STAGES: RolloutStage[] = [
  {
    stage: 1,
    title: "Fundação",
    detail: "Acesso seguro, perfis de permissão, auditoria e banco de dados",
    status: "available",
  },
  {
    stage: 2,
    title: "Leads e funil comercial",
    detail: "Cadastro, funil, interações e conversão em paciente",
    status: "planned",
  },
  {
    stage: 3,
    title: "Pacientes",
    detail: "Ficha, históricos e observações clínicas com acesso restrito",
    status: "planned",
  },
  {
    stage: 4,
    title: "Agenda",
    detail: "Visões diária e semanal, status e bloqueio de conflitos",
    status: "planned",
  },
  {
    stage: 5,
    title: "Protocolos e retornos",
    detail: "Intervalos definidos pela profissional e lembretes",
    status: "planned",
  },
  {
    stage: 6,
    title: "Indicadores do dashboard",
    detail: "Leads novos, agenda do dia, retornos e conversão",
    status: "planned",
  },
  {
    stage: 7,
    title: "WhatsApp",
    detail: "Estrutura de mensagens pronta para a API oficial",
    status: "planned",
  },
  {
    stage: 8,
    title: "LGPD e equipe",
    detail: "Gestão de usuários, exportação e anonimização de dados",
    status: "planned",
  },
];

export function findModule(key: string): AppModule | undefined {
  return [...MAIN_MODULES, ...ADMIN_MODULES].find((module) => module.key === key);
}
