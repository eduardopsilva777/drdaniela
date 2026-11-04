/**
 * SEED DE DESENVOLVIMENTO — cria apenas dados FICTÍCIOS.
 *
 * - Recusa-se a rodar com NODE_ENV=production.
 * - Pessoas usam o domínio reservado `.test` (RFC 2606) e o sobrenome "Demo";
 *   procedimentos e protocolos ficam na categoria "Demonstração". Preços e
 *   intervalos são ilustrativos — na clínica, quem define é a profissional.
 * - Usuários são idempotentes (upsert). Os dados do CRM (leads, pacientes,
 *   agenda, retornos, conversas) só são criados se ainda não existirem.
 * - As datas são relativas a "hoje" no fuso da clínica, para a demonstração
 *   sempre mostrar agenda do dia, retornos atrasados e próximos.
 *
 * Uso: npm run db:seed
 */
import { loadEnvConfig } from "@next/env";

import type { Prisma } from "../src/generated/prisma/client";
import type { KnowledgeCategory, LeadSource, LeadStatus } from "../src/generated/prisma/enums";
import { addDaysToKey, dateKeyToDbDate, todayKey, zonedDateTime } from "../src/lib/datetime";
import { DEFAULT_ASSISTANT_CONFIG } from "../src/lib/assistant-config";
import type { StaffRole } from "../src/lib/auth/permissions";
import { recordAudit } from "../src/server/audit";
import { hashPassword } from "../src/server/auth/password";
import { createPrismaClient, type DbClient } from "../src/server/db/prisma";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const TIME_ZONE = process.env.APP_TIMEZONE || "America/Sao_Paulo";

const DEMO_USERS: Array<{ name: string; email: string; role: StaffRole }> = [
  { name: "Helena Demo", email: "admin@demo.test", role: "ADMIN" },
  { name: "Daniela Demo", email: "profissional@demo.test", role: "PROFESSIONAL" },
  { name: "Rafaela Demo", email: "recepcao@demo.test", role: "RECEPTION" },
];

const DEMO_PROCEDURES = [
  { name: "Avaliação estética", durationMinutes: 30, priceCents: null, suggestedReturnDays: null, color: "#bbabdb" },
  { name: "Toxina botulínica", durationMinutes: 30, priceCents: 120000, suggestedReturnDays: 15, color: "#e8abb1" },
  { name: "Preenchimento labial", durationMinutes: 60, priceCents: 180000, suggestedReturnDays: 30, color: "#c9a0b4" },
  { name: "Bioestimulador de colágeno", durationMinutes: 60, priceCents: 250000, suggestedReturnDays: 30, color: "#e3caa4" },
  { name: "Limpeza de pele", durationMinutes: 60, priceCents: 25000, suggestedReturnDays: null, color: "#96c8aa" },
  { name: "Peeling químico", durationMinutes: 45, priceCents: 45000, suggestedReturnDays: null, color: "#9cc3de" },
] as const;

type DemoProcedure = (typeof DEMO_PROCEDURES)[number]["name"];

interface DemoLead {
  name: string;
  phone: string;
  source: LeadSource;
  status: LeadStatus;
  procedure?: DemoProcedure;
  interest?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  createdDaysAgo: number;
  nextActionInDays?: number;
  lostReason?: string;
  owner?: "recepcao" | "profissional";
  optIn?: boolean;
}

const DEMO_LEADS: DemoLead[] = [
  { name: "Bianca Demo", phone: "+5511990010001", source: "INSTAGRAM", status: "NEW", procedure: "Toxina botulínica", priority: "HIGH", createdDaysAgo: 0, nextActionInDays: 0, owner: "recepcao", optIn: true },
  { name: "Carla Demo", phone: "+5511990010002", source: "WHATSAPP", status: "NEW", interest: "Quer saber valores", createdDaysAgo: 1, nextActionInDays: -1, owner: "recepcao" },
  { name: "Denise Demo", phone: "+5511990010003", source: "GOOGLE", status: "NEW", procedure: "Limpeza de pele", createdDaysAgo: 3 },
  { name: "Elisa Demo", phone: "+5511990010004", source: "REFERRAL", status: "IN_PROGRESS", procedure: "Preenchimento labial", priority: "HIGH", createdDaysAgo: 5, nextActionInDays: 1, owner: "profissional", optIn: true },
  { name: "Fernanda Demo", phone: "+5511990010005", source: "INSTAGRAM", status: "IN_PROGRESS", procedure: "Bioestimulador de colágeno", createdDaysAgo: 9, nextActionInDays: -2, owner: "recepcao" },
  { name: "Gabriela Demo", phone: "+5511990010006", source: "WEBSITE", status: "IN_PROGRESS", interest: "Pacote de limpeza de pele", priority: "LOW", createdDaysAgo: 14, nextActionInDays: 3 },
  { name: "Heloísa Demo", phone: "+5511990010007", source: "INSTAGRAM", status: "SCHEDULED", procedure: "Avaliação estética", createdDaysAgo: 6, owner: "recepcao", optIn: true },
  { name: "Isabela Demo", phone: "+5511990010008", source: "FACEBOOK", status: "LOST", procedure: "Toxina botulínica", createdDaysAgo: 20, lostReason: "Preço acima do esperado" },
  { name: "Juliana Demo", phone: "+5511990010009", source: "WALK_IN", status: "LOST", interest: "Peeling", createdDaysAgo: 33, lostReason: "Sem resposta após contatos" },
  { name: "Larissa Demo", phone: "+5511990010010", source: "GOOGLE", status: "NEW", createdDaysAgo: 41 },
  { name: "Marina Demo", phone: "+5511990010011", source: "REFERRAL", status: "IN_PROGRESS", procedure: "Peeling químico", createdDaysAgo: 48, nextActionInDays: 5 },
];

interface DemoPatient {
  fullName: string;
  preferredName?: string;
  phone: string;
  source: LeadSource;
  birthDate?: string;
  optIn: boolean;
  createdDaysAgo: number;
  /** Converte um lead fictício (mantém o histórico comercial). */
  fromLead?: { procedure: DemoProcedure; createdDaysAgo: number };
}

const DEMO_PATIENTS: DemoPatient[] = [
  { fullName: "Ana Paula Demo", preferredName: "Ana", phone: "+5511990020001", source: "INSTAGRAM", birthDate: "1988-03-14", optIn: true, createdDaysAgo: 40, fromLead: { procedure: "Bioestimulador de colágeno", createdDaysAgo: 46 } },
  { fullName: "Beatriz Souza Demo", phone: "+5511990020002", source: "REFERRAL", birthDate: "1992-07-02", optIn: true, createdDaysAgo: 25, fromLead: { procedure: "Toxina botulínica", createdDaysAgo: 30 } },
  { fullName: "Camila Rocha Demo", phone: "+5511990020003", source: "WHATSAPP", birthDate: "1979-11-21", optIn: false, createdDaysAgo: 18, fromLead: { procedure: "Limpeza de pele", createdDaysAgo: 21 } },
  { fullName: "Daniela Lima Demo", phone: "+5511990020004", source: "GOOGLE", optIn: true, createdDaysAgo: 120 },
  { fullName: "Eduarda Martins Demo", phone: "+5511990020005", source: "WALK_IN", birthDate: "1995-01-30", optIn: true, createdDaysAgo: 90 },
  { fullName: "Flávia Costa Demo", phone: "+5511990020006", source: "INSTAGRAM", optIn: false, createdDaysAgo: 60 },
];

function daysAgo(today: string, days: number, time = "10:00"): Date {
  return zonedDateTime(addDaysToKey(today, -days), time, TIME_ZONE);
}

function at(today: string, offsetDays: number, time: string): Date {
  return zonedDateTime(addDaysToKey(today, offsetDays), time, TIME_ZONE);
}

const MINUTE = 60 * 1000;

async function seedUsers(db: DbClient, password: string) {
  const passwordHash = await hashPassword(password);
  const ids: Record<StaffRole, string> = { ADMIN: "", PROFESSIONAL: "", RECEPTION: "" };
  for (const demo of DEMO_USERS) {
    const existing = await db.user.findUnique({ where: { email: demo.email }, select: { id: true } });
    const user = await db.user.upsert({
      where: { email: demo.email },
      create: { ...demo, passwordHash },
      update: { name: demo.name, role: demo.role, isActive: true, passwordHash },
      select: { id: true },
    });
    ids[demo.role] = user.id;
    if (!existing) {
      await recordAudit(db, {
        action: "user.create",
        entityType: "user",
        entityId: user.id,
        metadata: { source: "seed", role: demo.role },
      });
    }
  }
  return ids;
}

async function seedProcedures(db: DbClient) {
  const ids = {} as Record<DemoProcedure, { id: string; durationMinutes: number }>;
  for (const procedure of DEMO_PROCEDURES) {
    const saved = await db.procedure.upsert({
      where: { name: procedure.name },
      create: {
        ...procedure,
        category: "Demonstração",
        description: "Cadastro fictício de desenvolvimento — preço e intervalo ilustrativos.",
      },
      update: {},
      select: { id: true, durationMinutes: true },
    });
    ids[procedure.name] = saved;
  }
  return ids;
}

async function seedCrm(db: DbClient, users: Record<StaffRole, string>, procedures: Awaited<ReturnType<typeof seedProcedures>>) {
  const already = await db.lead.count({ where: { phone: { in: DEMO_LEADS.map((lead) => lead.phone) } } });
  if (already > 0) {
    console.log("  Dados de demonstração do CRM já existem — mantidos como estão.");
    return;
  }

  const now = new Date();
  const today = todayKey(TIME_ZONE, now);
  const owners = { recepcao: users.RECEPTION, profissional: users.PROFESSIONAL };
  const professional = users.PROFESSIONAL;

  // Protocolo de demonstração.
  const protocol = await db.protocol.upsert({
    where: { name: "Bioestimulador — 3 sessões (demonstração)" },
    create: {
      name: "Bioestimulador — 3 sessões (demonstração)",
      description: "Protocolo fictício de desenvolvimento. Intervalos ilustrativos.",
      procedureId: procedures["Bioestimulador de colágeno"].id,
      steps: {
        create: [
          { position: 1, kind: "SESSION", label: "Segunda sessão", offsetDays: 30, relativeTo: "START" },
          { position: 2, kind: "SESSION", label: "Terceira sessão", offsetDays: 30, relativeTo: "PREVIOUS" },
          { position: 3, kind: "REVIEW", label: "Revisão final", offsetDays: 60, relativeTo: "PREVIOUS" },
        ],
      },
    },
    update: {},
    include: { steps: { orderBy: { position: "asc" } } },
  });

  // Leads do funil.
  const leadIds: Record<string, string> = {};
  for (const demo of DEMO_LEADS) {
    const createdAt = daysAgo(today, demo.createdDaysAgo, "11:30");
    const peak: LeadStatus = demo.status === "LOST" ? "IN_PROGRESS" : demo.status;
    const lead = await db.lead.create({
      data: {
        name: demo.name,
        phone: demo.phone,
        email: `${demo.name.split(" ")[0]!.toLowerCase()}@demo.test`,
        source: demo.source,
        status: demo.status,
        peakStatus: peak,
        priority: demo.priority ?? "MEDIUM",
        procedureId: demo.procedure ? procedures[demo.procedure].id : null,
        interest: demo.interest ?? null,
        ownerId: demo.owner ? owners[demo.owner] : null,
        nextActionAt: demo.nextActionInDays !== undefined ? at(today, demo.nextActionInDays, "14:00") : null,
        nextActionNote: demo.nextActionInDays !== undefined ? "Retornar contato (demonstração)" : null,
        lostReason: demo.lostReason ?? null,
        lostAt: demo.status === "LOST" ? daysAgo(today, Math.max(demo.createdDaysAgo - 5, 0)) : null,
        statusChangedAt: daysAgo(today, Math.max(demo.createdDaysAgo - 2, 0)),
        lastContactAt: demo.status === "NEW" ? null : daysAgo(today, Math.max(demo.createdDaysAgo - 1, 0)),
        whatsappOptIn: demo.optIn ?? false,
        whatsappOptInAt: demo.optIn ? createdAt : null,
        createdAt,
        interactions: {
          create: [
            { type: "SYSTEM", content: "Lead cadastrado.", authorId: users.RECEPTION, occurredAt: createdAt },
            ...(demo.status !== "NEW"
              ? [
                  {
                    type: "CALL" as const,
                    direction: "OUTBOUND" as const,
                    content: "Primeiro contato: apresentou interesse e pediu informações (demonstração).",
                    authorId: users.RECEPTION,
                    occurredAt: new Date(createdAt.getTime() + 90 * MINUTE),
                  },
                  {
                    type: "STATUS_CHANGE" as const,
                    fromStatus: "NEW" as const,
                    toStatus: "IN_PROGRESS" as const,
                    authorId: users.RECEPTION,
                    occurredAt: new Date(createdAt.getTime() + 91 * MINUTE),
                  },
                ]
              : []),
            ...(demo.status === "LOST"
              ? [
                  {
                    type: "STATUS_CHANGE" as const,
                    fromStatus: "IN_PROGRESS" as const,
                    toStatus: "LOST" as const,
                    content: `Motivo da perda: ${demo.lostReason}`,
                    authorId: users.RECEPTION,
                    occurredAt: daysAgo(today, Math.max(demo.createdDaysAgo - 5, 0)),
                  },
                ]
              : []),
          ],
        },
      },
    });
    leadIds[demo.name] = lead.id;
  }

  // Lead agendado: avaliação amanhã.
  await db.appointment.create({
    data: {
      leadId: leadIds["Heloísa Demo"]!,
      professionalId: professional,
      procedureId: procedures["Avaliação estética"].id,
      startsAt: at(today, 1, "10:00"),
      endsAt: at(today, 1, "10:30"),
      events: { create: { type: "CREATED", toStatus: "SCHEDULED", actorId: users.RECEPTION } },
    },
  });

  // Pacientes (alguns vindos de leads convertidos).
  const patientIds: Record<string, string> = {};
  for (const demo of DEMO_PATIENTS) {
    const createdAt = daysAgo(today, demo.createdDaysAgo, "15:00");
    const patient = await db.patient.create({
      data: {
        fullName: demo.fullName,
        preferredName: demo.preferredName ?? null,
        phone: demo.phone,
        email: `${demo.fullName.split(" ")[0]!.toLowerCase()}.${demo.phone.slice(-4)}@demo.test`,
        birthDate: demo.birthDate ? dateKeyToDbDate(demo.birthDate) : null,
        source: demo.source,
        whatsappOptIn: demo.optIn,
        whatsappOptInAt: demo.optIn ? createdAt : null,
        createdAt,
      },
    });
    patientIds[demo.fullName] = patient.id;

    if (demo.fromLead) {
      const leadCreatedAt = daysAgo(today, demo.fromLead.createdDaysAgo, "09:30");
      await db.lead.create({
        data: {
          name: demo.fullName,
          phone: demo.phone,
          source: demo.source,
          status: "CONVERTED",
          peakStatus: "CONVERTED",
          procedureId: procedures[demo.fromLead.procedure].id,
          patientId: patient.id,
          convertedAt: createdAt,
          statusChangedAt: createdAt,
          lastContactAt: createdAt,
          ownerId: users.RECEPTION,
          createdAt: leadCreatedAt,
          interactions: {
            create: [
              { patientId: patient.id, type: "SYSTEM", content: "Lead cadastrado.", authorId: users.RECEPTION, occurredAt: leadCreatedAt },
              {
                patientId: patient.id,
                type: "WHATSAPP",
                direction: "INBOUND",
                content: "Pediu informações sobre o procedimento (demonstração).",
                authorId: users.RECEPTION,
                occurredAt: new Date(leadCreatedAt.getTime() + 30 * MINUTE),
              },
              {
                patientId: patient.id,
                type: "STATUS_CHANGE",
                fromStatus: "SCHEDULED",
                toStatus: "CONVERTED",
                content: "Convertido em paciente.",
                authorId: users.RECEPTION,
                occurredAt: createdAt,
              },
            ],
          },
        },
      });
    } else {
      await db.interaction.create({
        data: { patientId: patient.id, type: "SYSTEM", content: "Paciente cadastrado.", authorId: users.RECEPTION, occurredAt: createdAt },
      });
    }
  }

  // Agenda: atendimentos passados (concluídos/ausência), de hoje e dos próximos dias.
  type Slot = {
    patient: string;
    procedure: DemoProcedure;
    day: number;
    time: string;
    status?: "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
    reason?: string;
  };
  const slots: Slot[] = [
    { patient: "Ana Paula Demo", procedure: "Bioestimulador de colágeno", day: -35, time: "10:00", status: "COMPLETED" },
    { patient: "Beatriz Souza Demo", procedure: "Toxina botulínica", day: -20, time: "14:00", status: "COMPLETED" },
    { patient: "Camila Rocha Demo", procedure: "Limpeza de pele", day: -12, time: "09:00", status: "COMPLETED" },
    { patient: "Daniela Lima Demo", procedure: "Peeling químico", day: -6, time: "16:00", status: "NO_SHOW" },
    { patient: "Eduarda Martins Demo", procedure: "Preenchimento labial", day: -3, time: "11:00", status: "COMPLETED" },
    { patient: "Flávia Costa Demo", procedure: "Limpeza de pele", day: 0, time: "09:00", status: "CONFIRMED" },
    { patient: "Beatriz Souza Demo", procedure: "Toxina botulínica", day: 0, time: "11:30", status: "SCHEDULED" },
    { patient: "Eduarda Martins Demo", procedure: "Avaliação estética", day: 0, time: "15:00", status: "SCHEDULED" },
    { patient: "Daniela Lima Demo", procedure: "Peeling químico", day: 2, time: "16:00", status: "CANCELLED", reason: "Viagem (demonstração)" },
    { patient: "Camila Rocha Demo", procedure: "Limpeza de pele", day: 3, time: "10:00", status: "SCHEDULED" },
    { patient: "Ana Paula Demo", procedure: "Bioestimulador de colágeno", day: 6, time: "14:00", status: "SCHEDULED" },
  ];

  for (const slot of slots) {
    const procedure = procedures[slot.procedure];
    const startsAt = at(today, slot.day, slot.time);
    const endsAt = new Date(startsAt.getTime() + procedure.durationMinutes * MINUTE);
    const status = slot.status ?? "SCHEDULED";
    const patientId = patientIds[slot.patient]!;
    const appointment = await db.appointment.create({
      data: {
        patientId,
        professionalId: professional,
        procedureId: procedure.id,
        startsAt,
        endsAt,
        status,
        confirmedAt: status === "CONFIRMED" ? now : null,
        completedAt: status === "COMPLETED" ? endsAt : null,
        cancelledAt: status === "CANCELLED" ? now : null,
        cancellationReason: slot.reason ?? null,
        noShowAt: status === "NO_SHOW" ? endsAt : null,
        events: {
          create: [
            { type: "CREATED", toStatus: "SCHEDULED", actorId: users.RECEPTION, createdAt: new Date(startsAt.getTime() - 7 * 24 * 60 * MINUTE) },
            ...(status !== "SCHEDULED"
              ? [{ type: "STATUS_CHANGED" as const, fromStatus: "SCHEDULED" as const, toStatus: status, reason: slot.reason ?? null, actorId: users.RECEPTION }]
              : []),
          ],
        },
      },
    });
    if (status === "COMPLETED") {
      await db.procedureRecord.create({
        data: { patientId, procedureId: procedure.id, professionalId: professional, appointmentId: appointment.id, performedAt: startsAt },
      });
    }
    const optedIn = DEMO_PATIENTS.find((item) => item.fullName === slot.patient)?.optIn;
    if (optedIn && (status === "SCHEDULED" || status === "CONFIRMED") && startsAt > now) {
      await db.reminder.create({
        data: {
          kind: "APPOINTMENT",
          patientId,
          appointmentId: appointment.id,
          procedureId: procedure.id,
          scheduledFor: new Date(Math.max(now.getTime(), startsAt.getTime() - 24 * 60 * MINUTE)),
        },
      });
    }
  }

  // Protocolo aplicado (Ana Paula): primeira sessão há 35 dias → segunda sessão atrasada.
  const start = addDaysToKey(today, -35);
  const anaId = patientIds["Ana Paula Demo"]!;
  const applied = await db.patientProtocol.create({
    data: { patientId: anaId, protocolId: protocol.id, startedOn: dateKeyToDbDate(start) },
  });
  let previous = start;
  for (const step of protocol.steps) {
    const due = addDaysToKey(step.relativeTo === "START" ? start : previous, step.offsetDays);
    previous = due;
    await db.patientReturn.create({
      data: {
        patientId: anaId,
        procedureId: protocol.procedureId,
        patientProtocolId: applied.id,
        protocolStepId: step.id,
        kind: step.kind,
        title: step.label,
        dueDate: dateKeyToDbDate(due),
      },
    });
  }

  // Retornos avulsos: um próximo (com lembrete) e um atrasado.
  const beatriz = patientIds["Beatriz Souza Demo"]!;
  const upcoming = await db.patientReturn.create({
    data: {
      patientId: beatriz,
      procedureId: procedures["Toxina botulínica"].id,
      kind: "REVIEW",
      title: "Retorno de Toxina botulínica",
      dueDate: dateKeyToDbDate(addDaysToKey(today, 4)),
    },
  });
  await db.reminder.create({
    data: {
      kind: "RETURN",
      patientId: beatriz,
      returnId: upcoming.id,
      procedureId: procedures["Toxina botulínica"].id,
      scheduledFor: at(today, 2, "09:00"),
    },
  });
  await db.patientReturn.create({
    data: {
      patientId: patientIds["Camila Rocha Demo"]!,
      procedureId: procedures["Limpeza de pele"].id,
      kind: "CUSTOM",
      title: "Retorno de manutenção",
      dueDate: dateKeyToDbDate(addDaysToKey(today, -4)),
    },
  });

  // Conversa de WhatsApp SIMULADA (modo de desenvolvimento): nada foi enviado de verdade.
  const conversation = await db.whatsAppConversation.create({
    data: {
      contactPhone: DEMO_PATIENTS[1]!.phone,
      contactName: "Beatriz",
      patientId: beatriz,
      unreadCount: 1,
      lastInboundAt: new Date(now.getTime() - 40 * MINUTE),
      lastMessageAt: new Date(now.getTime() - 40 * MINUTE),
    },
  });
  const messages: Prisma.WhatsAppMessageCreateManyInput[] = [
    {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      type: "TEMPLATE",
      templateName: "lembrete_desenvolvimento",
      body: "Olá, Beatriz! Lembrete do seu horário na clínica (mensagem simulada).",
      provider: "development",
      providerMessageId: `dev-seed-${conversation.id}-1`,
      status: "SIMULATED",
      sentAt: new Date(now.getTime() - 26 * 60 * MINUTE),
      createdAt: new Date(now.getTime() - 26 * 60 * MINUTE),
    },
    {
      conversationId: conversation.id,
      direction: "INBOUND",
      type: "TEXT",
      body: "Oi! Confirmo minha presença. Posso chegar 10 minutos antes?",
      provider: "development",
      providerMessageId: `dev-seed-${conversation.id}-2`,
      status: "RECEIVED",
      receivedAt: new Date(now.getTime() - 40 * MINUTE),
      createdAt: new Date(now.getTime() - 40 * MINUTE),
    },
  ];
  await db.whatsAppMessage.createMany({ data: messages });

  console.log("  Dados de demonstração do CRM criados (leads, pacientes, agenda, protocolo, retornos e conversa).");
}


// -----------------------------------------------------------------------------
// Assistente virtual (dados FICTÍCIOS de desenvolvimento)
// -----------------------------------------------------------------------------

const DEMO_KNOWLEDGE: Array<{
  category: KnowledgeCategory;
  title: string;
  content: string;
  keywords: string;
  procedure?: DemoProcedure;
  status: "APPROVED" | "IN_REVIEW";
}> = [
  {
    category: "CLINIC_INFO",
    title: "Qual o horário de atendimento?",
    content: "Exemplo fictício de desenvolvimento: atendemos de segunda a sexta, das 9h às 18h, e aos sábados, das 9h às 13h.",
    keywords: "horário, funcionamento, abre, fecha, sábado, atendimento",
    status: "APPROVED",
  },
  {
    category: "CLINIC_INFO",
    title: "Onde fica a clínica?",
    content: "Exemplo fictício de desenvolvimento: Rua das Flores, 123, sala 45, Centro. Há estacionamento conveniado no prédio.",
    keywords: "endereço, localização, onde fica, como chegar, estacionamento",
    status: "APPROVED",
  },
  {
    category: "PRICING",
    title: "Quanto custa a avaliação?",
    content:
      "Exemplo fictício de desenvolvimento: a avaliação estética custa R$ 150,00 e o valor é abatido se você fizer um procedimento em até 30 dias.",
    keywords: "valor, preço, avaliação, consulta, quanto custa, primeira consulta",
    procedure: "Avaliação estética",
    status: "APPROVED",
  },
  {
    category: "PRICING",
    title: "Quais as formas de pagamento?",
    content: "Exemplo fictício de desenvolvimento: aceitamos Pix, cartão de débito e cartão de crédito em até 6 vezes sem juros.",
    keywords: "pagamento, pix, cartão, crédito, débito, parcelamento, parcela",
    status: "APPROVED",
  },
  {
    category: "SERVICE",
    title: "Quais procedimentos a clínica oferece?",
    content:
      "Exemplo fictício de desenvolvimento: toxina botulínica, preenchimento labial, bioestimulador de colágeno, limpeza de pele e peeling químico. A indicação de cada um é feita pela Dra. Daniela na avaliação.",
    keywords: "procedimentos, serviços, tratamentos, fazem, oferecem, botox, toxina, preenchimento",
    status: "APPROVED",
  },
  {
    category: "POLICY",
    title: "Qual a política de cancelamento e atrasos?",
    content:
      "Exemplo fictício de desenvolvimento: pedimos aviso com pelo menos 24 horas de antecedência para cancelar ou remarcar. Atrasos acima de 15 minutos podem exigir remarcação.",
    keywords: "cancelamento, cancelar, remarcar, atraso, tolerância, política",
    status: "APPROVED",
  },
  {
    category: "SCHEDULING",
    title: "Como funciona a primeira consulta?",
    content:
      "Exemplo fictício de desenvolvimento: a primeira consulta é uma avaliação de cerca de 30 minutos com a Dra. Daniela, que conversa sobre seus objetivos e indica o que faz sentido para você.",
    keywords: "primeira consulta, avaliação, como funciona, primeira vez",
    procedure: "Avaliação estética",
    status: "APPROVED",
  },
  {
    category: "CLINIC_INFO",
    title: "Vocês atendem aos domingos?",
    content: "Exemplo fictício de desenvolvimento: não atendemos aos domingos e feriados.",
    keywords: "domingo, feriado",
    status: "IN_REVIEW",
  },
];

async function seedAssistant(
  db: DbClient,
  users: Record<StaffRole, string>,
  procedures: Awaited<ReturnType<typeof seedProcedures>>,
) {
  const settings = await db.assistantSettings.findUnique({ where: { id: "default" }, select: { id: true } });
  if (!settings) {
    const config = {
      ...DEFAULT_ASSISTANT_CONFIG,
      teamHoursText: "de segunda a sexta, das 9h às 18h (exemplo fictício)",
      booking: {
        ...DEFAULT_ASSISTANT_CONFIG.booking,
        enabled: true,
        procedureId: procedures["Avaliação estética"].id,
        professionalIds: [users.PROFESSIONAL],
      },
    };
    await db.assistantSettings.create({ data: { id: "default", config, updatedById: users.ADMIN } });
  }

  if ((await db.knowledgeEntry.count()) === 0) {
    const now = new Date();
    for (const item of DEMO_KNOWLEDGE) {
      const entry = await db.knowledgeEntry.create({
        data: { category: item.category, procedureId: item.procedure ? procedures[item.procedure].id : null },
      });
      const version = await db.knowledgeEntryVersion.create({
        data: {
          entryId: entry.id,
          version: 1,
          title: item.title,
          content: item.content,
          keywords: item.keywords,
          status: item.status,
          authorId: users.RECEPTION,
          changeNote: "Conteúdo fictício do seed de desenvolvimento.",
          ...(item.status === "APPROVED" ? { reviewedById: users.PROFESSIONAL, reviewedAt: now } : {}),
        },
      });
      if (item.status === "APPROVED") {
        await db.knowledgeEntry.update({ where: { id: entry.id }, data: { publishedVersionId: version.id } });
      }
    }
  }

  if ((await db.messageTemplate.count()) === 0) {
    const approvedAt = new Date();
    await db.messageTemplate.createMany({
      data: [
        {
          name: "lembrete_agendamento",
          category: "UTILITY",
          usage: "APPOINTMENT_REMINDER",
          body: "Olá, {{1}}! Lembrete do seu horário na clínica em {{2}} às {{3}} ({{4}}). Para remarcar, responda esta mensagem.",
          parameters: ["patient_name", "appointment_date", "appointment_time", "procedure_name"],
          status: "APPROVED",
          statusSource: "manual",
          statusUpdatedAt: approvedAt,
        },
        {
          name: "lembrete_retorno",
          category: "UTILITY",
          usage: "RETURN_REMINDER",
          body: "Olá, {{1}}! O retorno de {{2}} está previsto para {{3}}. Responda esta mensagem para agendar.",
          parameters: ["patient_name", "procedure_name", "due_date"],
          status: "APPROVED",
          statusSource: "manual",
          statusUpdatedAt: approvedAt,
        },
        {
          name: "acompanhamento_retorno",
          category: "UTILITY",
          usage: "FOLLOW_UP",
          body: "Olá, {{1}}! Está chegando a data prevista do seu retorno de {{2}} ({{3}}). Quer agendar uma avaliação? Responda esta mensagem.",
          parameters: ["patient_name", "procedure_name", "due_date"],
          status: "APPROVED",
          statusSource: "manual",
          statusUpdatedAt: approvedAt,
        },
        {
          name: "convite_novidades",
          category: "MARKETING",
          usage: "FOLLOW_UP",
          body: "Olá, {{1}}! Temos novidades na {{2}}. Quer saber mais? Responda esta mensagem.",
          parameters: ["patient_name", "clinic_name"],
          status: "PENDING",
          statusSource: "manual",
          statusUpdatedAt: approvedAt,
        },
      ],
    });
  }

  const protocol = await db.protocol.findUnique({
    where: { name: "Bioestimulador — 3 sessões (demonstração)" },
    select: { id: true, _count: { select: { followUpRules: true } } },
  });
  const followUpTemplate = await db.messageTemplate.findFirst({ where: { name: "acompanhamento_retorno" }, select: { id: true } });
  if (protocol && protocol._count.followUpRules === 0 && followUpTemplate) {
    await db.followUpRule.createMany({
      data: [
        { protocolId: protocol.id, daysBefore: 14, action: "MESSAGE", templateId: followUpTemplate.id },
        { protocolId: protocol.id, daysBefore: 3, action: "MESSAGE", templateId: followUpTemplate.id },
        { protocolId: protocol.id, daysBefore: 0, action: "TASK", taskTitle: "Ligar se o paciente ainda não agendou o retorno" },
      ],
    });
  }
  console.log("  Assistente virtual: configurações, base de conhecimento fictícia, modelos e regras de acompanhamento.");
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("O seed de desenvolvimento não pode ser executado com NODE_ENV=production.");
  }
  // Os telefones fictícios têm formato válido e podem pertencer a pessoas reais:
  // com a API oficial ativa, os lembretes simulados virariam mensagens reais.
  if (process.env.WHATSAPP_PROVIDER === "cloud_api") {
    throw new Error(
      "O seed não pode ser executado com WHATSAPP_PROVIDER=cloud_api: ele cria contatos fictícios com consentimento de WhatsApp. Use um banco separado e o provedor 'development' ou 'disabled'.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");

  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("Defina SEED_USER_PASSWORD (mínimo de 12 caracteres) no arquivo .env.");
  }

  const db = createPrismaClient(databaseUrl);
  try {
    const users = await seedUsers(db, password);
    const procedures = await seedProcedures(db);
    await seedCrm(db, users, procedures);
    await seedAssistant(db, users, procedures);

    console.log("\nSeed concluído — usuários FICTÍCIOS de desenvolvimento:\n");
    for (const demo of DEMO_USERS) {
      console.log(`  ${demo.role.padEnd(13)} ${demo.email}`);
    }
    console.log("\n  Senha: valor de SEED_USER_PASSWORD no seu .env\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
