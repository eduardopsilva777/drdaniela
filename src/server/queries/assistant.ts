import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AssistantFilters, TaskFilters } from "@/lib/validation/assistant";
import { requirePermission } from "@/server/auth/dal";
import { KNOWLEDGE_GAP_CONTEXT, openText } from "@/server/crypto/content-cipher";
import { getContentKeyring } from "@/server/crypto/content-key";
import { getDb } from "@/server/db";
import { ASSISTANT_USER_ID } from "@/server/services/assistant-actor";

/** Consultas da área do assistente virtual (cada uma confere a permissão junto ao dado). */

export const ASSISTANT_PAGE_SIZE = 25;

const DAY = 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Visão geral: métricas de atendimento
// -----------------------------------------------------------------------------

async function medianResponseSeconds(from: Date): Promise<{ assistant: number | null; team: number | null }> {
  const rows = await getDb().$queryRaw<Array<{ responder: string; median: number | null; turns: bigint }>>`
    WITH ordered AS (
      SELECT "id", "conversation_id", "direction", "created_at",
             LAG("direction") OVER (PARTITION BY "conversation_id" ORDER BY "created_at") AS "previous_direction"
      FROM "whatsapp_messages"
      WHERE "created_at" >= ${new Date(from.getTime() - DAY)}
    ),
    turns AS (
      SELECT o."conversation_id", o."created_at"
      FROM ordered o
      WHERE o."direction" = 'INBOUND'
        AND o."created_at" >= ${from}
        AND o."previous_direction" IS DISTINCT FROM 'INBOUND'
    )
    SELECT CASE WHEN r."origin" = 'STAFF' THEN 'team' ELSE 'assistant' END AS "responder",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r."created_at" - t."created_at"))) AS "median",
           COUNT(*) AS "turns"
    FROM turns t
    JOIN LATERAL (
      SELECT m."created_at", m."origin"
      FROM "whatsapp_messages" m
      WHERE m."conversation_id" = t."conversation_id"
        AND m."direction" = 'OUTBOUND'
        AND m."origin" IN ('ASSISTANT', 'SYSTEM', 'STAFF')
        AND m."created_at" > t."created_at"
      ORDER BY m."created_at" ASC
      LIMIT 1
    ) r ON TRUE
    GROUP BY 1`;
  const byResponder = new Map(rows.map((row) => [row.responder, row.median === null ? null : Number(row.median)]));
  return { assistant: byResponder.get("assistant") ?? null, team: byResponder.get("team") ?? null };
}

export async function getAssistantOverview(periodDays: number) {
  await requirePermission("assistant:monitor");
  const db = getDb();
  const from = new Date(Date.now() - periodDays * DAY);
  const since = { gte: from };

  const capturedLeadIds = (
    await db.auditLog.findMany({
      where: { action: "lead.create", actorId: ASSISTANT_USER_ID, createdAt: since },
      select: { entityId: true },
    })
  ).flatMap((entry) => (entry.entityId ? [entry.entityId] : []));

  const [
    conversationsStarted,
    inboundMessages,
    assistantReplies,
    qualified,
    converted,
    bookings,
    reschedules,
    handoffs,
    noAnswers,
    optOuts,
    followUpMessages,
    followUpTasks,
    returnsScheduled,
    openTasks,
    openGaps,
    responseTimes,
  ] = await Promise.all([
    db.whatsAppConversation.count({ where: { createdAt: since } }),
    db.whatsAppMessage.count({ where: { direction: "INBOUND", createdAt: since } }),
    db.whatsAppMessage.count({ where: { origin: "ASSISTANT", createdAt: since } }),
    db.lead.count({ where: { id: { in: capturedLeadIds }, peakStatus: { in: ["IN_PROGRESS", "SCHEDULED", "CONVERTED"] } } }),
    db.lead.count({ where: { id: { in: capturedLeadIds }, status: "CONVERTED" } }),
    db.auditLog.count({ where: { action: "appointment.create", actorId: ASSISTANT_USER_ID, createdAt: since } }),
    db.auditLog.count({ where: { action: "appointment.reschedule", actorId: ASSISTANT_USER_ID, createdAt: since } }),
    db.assistantRun.count({ where: { outcome: "HANDOFF", createdAt: since } }),
    db.assistantRun.count({ where: { outcome: "NO_ANSWER", createdAt: since } }),
    db.consentEvent.count({ where: { purpose: "WHATSAPP", granted: false, source: { not: "STAFF" }, createdAt: since } }),
    db.whatsAppMessage.count({ where: { origin: "FOLLOW_UP", status: { not: "FAILED" }, createdAt: since } }),
    db.staffTask.count({ where: { kind: "FOLLOW_UP", createdAt: since } }),
    db.patientReturn.count({
      where: {
        status: { in: ["SCHEDULED", "COMPLETED"] },
        updatedAt: since,
        reminders: { some: { followUpRuleId: { not: null }, status: "SENT" } },
      },
    }),
    db.staffTask.count({ where: { status: "OPEN" } }),
    db.knowledgeGap.count({ where: { status: "OPEN" } }),
    medianResponseSeconds(from),
  ]);

  return {
    periodDays,
    conversationsStarted,
    inboundMessages,
    assistantReplies,
    leadsCaptured: capturedLeadIds.length,
    qualified,
    converted,
    bookings,
    reschedules,
    handoffs,
    noAnswers,
    optOuts,
    followUpMessages,
    followUpTasks,
    returnsScheduled,
    openTasks,
    openGaps,
    responseTimes,
  };
}

// -----------------------------------------------------------------------------
// Consumo da IA generativa
// -----------------------------------------------------------------------------

export async function getAiUsageOverview(periodDays: number, monthStart: Date) {
  await requirePermission("assistant:monitor");
  const db = getDb();
  const from = new Date(Date.now() - periodDays * DAY);
  const withModel = { createdAt: { gte: from }, modelCalls: { gt: 0 } };

  const [period, month, errors, tools, followUps] = await Promise.all([
    db.assistantRun.aggregate({
      where: withModel,
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, modelCalls: true, costMicros: true },
      _avg: { modelLatencyMs: true },
      _count: { _all: true },
    }),
    db.assistantRun.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { costMicros: true } }),
    db.assistantRun.groupBy({
      by: ["errorCode"],
      where: { createdAt: { gte: from }, errorCode: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { errorCode: "desc" } },
      take: 6,
    }),
    db.$queryRaw<Array<{ tool: string; uses: bigint }>>`
      SELECT t."tool", COUNT(*) AS "uses"
      FROM "assistant_runs" r, UNNEST(r."tool_calls") AS t("tool")
      WHERE r."created_at" >= ${from}
      GROUP BY t."tool"
      ORDER BY "uses" DESC
      LIMIT 8`,
    db.assistantRun.groupBy({ by: ["status"], where: { kind: "FOLLOW_UP", createdAt: { gte: from } }, _count: { _all: true } }),
  ]);

  return {
    turns: period._count._all,
    modelCalls: period._sum.modelCalls ?? 0,
    inputTokens: period._sum.inputTokens ?? 0,
    outputTokens: period._sum.outputTokens ?? 0,
    cacheReadTokens: period._sum.cacheReadTokens ?? 0,
    cacheWriteTokens: period._sum.cacheWriteTokens ?? 0,
    costMicros: period._sum.costMicros ?? 0,
    avgModelLatencyMs: period._avg.modelLatencyMs,
    monthCostMicros: month._sum.costMicros ?? 0,
    errors: errors.map((row) => ({ code: row.errorCode ?? "—", count: row._count._all })),
    tools: tools.map((row) => ({ tool: row.tool, uses: Number(row.uses) })),
    followUps: Object.fromEntries(followUps.map((row) => [row.status, row._count._all])) as Partial<Record<string, number>>,
  };
}

// -----------------------------------------------------------------------------
// Base de conhecimento
// -----------------------------------------------------------------------------

function knowledgeWhere(filters: AssistantFilters): Prisma.KnowledgeEntryWhereInput {
  const conditions: Prisma.KnowledgeEntryWhereInput[] = [{ isArchived: filters.situacao === "arquivadas" }];
  if (filters.categoria) conditions.push({ category: filters.categoria });
  if (filters.situacao === "publicadas") conditions.push({ publishedVersionId: { not: null } });
  if (filters.situacao === "revisao") conditions.push({ versions: { some: { status: "IN_REVIEW" } } });
  if (filters.situacao === "rascunhos") conditions.push({ versions: { some: { status: "DRAFT" } } });
  if (filters.busca) {
    conditions.push({
      versions: {
        some: {
          OR: [
            { title: { contains: filters.busca, mode: "insensitive" } },
            { content: { contains: filters.busca, mode: "insensitive" } },
            { keywords: { contains: filters.busca, mode: "insensitive" } },
          ],
        },
      },
    });
  }
  return { AND: conditions };
}

export async function listKnowledgeEntries(filters: AssistantFilters) {
  await requirePermission("knowledge:read");
  const db = getDb();
  const where = knowledgeWhere(filters);
  const [total, entries, pendingReview] = await Promise.all([
    db.knowledgeEntry.count({ where }),
    db.knowledgeEntry.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (filters.pagina - 1) * ASSISTANT_PAGE_SIZE,
      take: ASSISTANT_PAGE_SIZE,
      select: {
        id: true,
        category: true,
        isArchived: true,
        updatedAt: true,
        procedure: { select: { id: true, name: true } },
        publishedVersion: { select: { id: true, version: true, title: true, content: true, keywords: true, reviewedAt: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            version: true,
            title: true,
            content: true,
            keywords: true,
            status: true,
            createdAt: true,
            author: { select: { name: true } },
          },
        },
      },
    }),
    db.knowledgeEntryVersion.count({ where: { status: "IN_REVIEW", entry: { isArchived: false } } }),
  ]);
  return { total, pendingReview, entries };
}

export type KnowledgeListEntry = Awaited<ReturnType<typeof listKnowledgeEntries>>["entries"][number];

export async function getKnowledgeHistory(entryId: string) {
  await requirePermission("knowledge:read");
  return getDb().knowledgeEntryVersion.findMany({
    where: { entryId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      title: true,
      content: true,
      keywords: true,
      status: true,
      changeNote: true,
      reviewNote: true,
      createdAt: true,
      reviewedAt: true,
      author: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  });
}

export async function listKnowledgeGaps(page: number) {
  await requirePermission("knowledge:read");
  const db = getDb();
  const keyring = getContentKeyring();
  const where: Prisma.KnowledgeGapWhereInput = { status: "OPEN" };
  const [total, gaps] = await Promise.all([
    db.knowledgeGap.count({ where }),
    db.knowledgeGap.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ASSISTANT_PAGE_SIZE,
      take: ASSISTANT_PAGE_SIZE,
      select: {
        id: true,
        question: true,
        reason: true,
        feedbackNote: true,
        createdAt: true,
        conversationId: true,
        resolvedEntryId: true,
        reportedBy: { select: { name: true } },
      },
    }),
  ]);
  return {
    total,
    gaps: gaps.map((gap) => ({ ...gap, question: openText(gap.question, KNOWLEDGE_GAP_CONTEXT, keyring) ?? "" })),
  };
}

// -----------------------------------------------------------------------------
// Modelos, consentimentos e registros de automação
// -----------------------------------------------------------------------------

export async function listMessageTemplates() {
  await requirePermission("whatsapp:read");
  return getDb().messageTemplate.findMany({
    orderBy: [{ usage: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      usage: true,
      body: true,
      parameters: true,
      status: true,
      statusSource: true,
      statusUpdatedAt: true,
      rejectionReason: true,
      _count: { select: { followUpRules: true } },
    },
  });
}

export async function getConsentOverview(page: number) {
  await requirePermission("whatsapp:read");
  const db = getDb();
  const [optedOut, total, events] = await Promise.all([
    db.whatsAppConversation.findMany({
      where: { optedOutAt: { not: null } },
      orderBy: { optedOutAt: "desc" },
      take: 50,
      select: {
        id: true,
        contactPhone: true,
        contactName: true,
        optedOutAt: true,
        patient: { select: { id: true, fullName: true } },
        lead: { select: { id: true, name: true } },
      },
    }),
    db.consentEvent.count(),
    db.consentEvent.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ASSISTANT_PAGE_SIZE,
      take: ASSISTANT_PAGE_SIZE,
      select: {
        id: true,
        phone: true,
        purpose: true,
        granted: true,
        source: true,
        evidence: true,
        createdAt: true,
        actor: { select: { name: true } },
        patient: { select: { id: true, fullName: true } },
        lead: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { optedOut, total, events };
}

export async function getAutomationLogs() {
  await requirePermission("assistant:monitor");
  const db = getDb();
  const [runs, failedMessages, webhookErrors, failedReminders, pending] = await Promise.all([
    db.assistantRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        engine: true,
        intent: true,
        outcome: true,
        flags: true,
        latencyMs: true,
        attempts: true,
        kind: true,
        toolCalls: true,
        modelCalls: true,
        costMicros: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        conversation: {
          select: {
            id: true,
            contactPhone: true,
            contactName: true,
            patient: { select: { fullName: true } },
            lead: { select: { name: true } },
          },
        },
      },
    }),
    db.whatsAppMessage.findMany({
      where: { direction: "OUTBOUND", status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        origin: true,
        templateName: true,
        errorCode: true,
        errorMessage: true,
        attempts: true,
        createdAt: true,
        conversation: { select: { id: true, contactPhone: true } },
      },
    }),
    db.webhookEvent.findMany({
      where: { errorMessage: { not: null } },
      orderBy: { receivedAt: "desc" },
      take: 20,
      select: { id: true, kind: true, errorMessage: true, processedAt: true, receivedAt: true },
    }),
    db.reminder.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        kind: true,
        lastError: true,
        attempts: true,
        updatedAt: true,
        patient: { select: { id: true, fullName: true } },
        lead: { select: { id: true, name: true } },
      },
    }),
    Promise.all([
      db.assistantRun.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      db.whatsAppMessage.count({ where: { direction: "OUTBOUND", status: "PENDING", attempts: { gte: 1 } } }),
      db.reminder.count({ where: { status: "PENDING", scheduledFor: { lte: new Date() } } }),
    ]),
  ]);
  const [pendingRuns, pendingRetries, dueReminders] = pending;
  return { runs, failedMessages, webhookErrors, failedReminders, pendingRuns, pendingRetries, dueReminders };
}

// -----------------------------------------------------------------------------
// Tarefas da equipe
// -----------------------------------------------------------------------------

export async function listTasks(filters: TaskFilters) {
  await requirePermission("tasks:work");
  const db = getDb();
  const where: Prisma.StaffTaskWhereInput = {
    status: filters.situacao === "abertas" ? "OPEN" : { in: ["DONE", "CANCELLED"] },
    ...(filters.tipo ? { kind: filters.tipo } : {}),
  };
  const [total, tasks, counts] = await Promise.all([
    db.staffTask.count({ where }),
    db.staffTask.findMany({
      where,
      orderBy: filters.situacao === "abertas" ? [{ urgent: "desc" }, { dueAt: "asc" }] : [{ completedAt: "desc" }],
      skip: (filters.pagina - 1) * ASSISTANT_PAGE_SIZE,
      take: ASSISTANT_PAGE_SIZE,
      select: {
        id: true,
        kind: true,
        status: true,
        title: true,
        details: true,
        urgent: true,
        dueAt: true,
        createdAt: true,
        completedAt: true,
        completedBy: { select: { name: true } },
        conversationId: true,
        lead: { select: { id: true, name: true } },
        patient: { select: { id: true, fullName: true } },
      },
    }),
    db.staffTask.groupBy({ by: ["kind"], where: { status: "OPEN" }, _count: { _all: true } }),
  ]);
  return {
    total,
    tasks,
    openByKind: Object.fromEntries(counts.map((row) => [row.kind, row._count._all])) as Partial<Record<string, number>>,
  };
}

/** Para o painel inicial: tarefas abertas e conversas aguardando a equipe. */
export async function getOpenWorkSummary() {
  await requirePermission("tasks:work");
  const db = getDb();
  const [openTasks, urgent, handoffs] = await Promise.all([
    db.staffTask.count({ where: { status: "OPEN" } }),
    db.staffTask.count({ where: { status: "OPEN", urgent: true } }),
    db.staffTask.count({ where: { status: "OPEN", kind: "HANDOFF" } }),
  ]);
  return { openTasks, urgent, handoffs };
}
