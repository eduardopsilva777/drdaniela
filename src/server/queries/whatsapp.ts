import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { phoneDigits } from "@/lib/phone";
import type { INBOX_FILTERS } from "@/lib/validation/assistant";
import { requirePermission } from "@/server/auth/dal";
import { messageContext, openText } from "@/server/crypto/content-cipher";
import { getContentKeyring } from "@/server/crypto/content-key";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/errors";

/** Conversas do WhatsApp (lista e histórico), com a permissão conferida junto ao dado. */

type InboxFilter = (typeof INBOX_FILTERS)[number];

function searchWhere(search: string | undefined): Prisma.WhatsAppConversationWhereInput {
  if (!search) return {};
  const digits = phoneDigits(search);
  return {
    OR: [
      { contactName: { contains: search, mode: "insensitive" } },
      { patient: { fullName: { contains: search, mode: "insensitive" } } },
      { lead: { name: { contains: search, mode: "insensitive" } } },
      ...(digits.length >= 3 ? [{ contactPhone: { contains: digits } }] : []),
    ],
  };
}

const FILTER_WHERE: Record<InboxFilter, Prisma.WhatsAppConversationWhereInput> = {
  todas: {},
  equipe: { mode: "HUMAN" },
  assistente: { mode: "ASSISTANT" },
  "nao-lidas": { unreadCount: { gt: 0 } },
  descadastrados: { optedOutAt: { not: null } },
};

export async function listConversations(search: string | undefined, filter: InboxFilter = "todas") {
  await requirePermission("whatsapp:read");
  const db = getDb();
  const keyring = getContentKeyring();
  const [conversations, counts] = await Promise.all([
    db.whatsAppConversation.findMany({
      where: { ...searchWhere(search), ...FILTER_WHERE[filter] },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        contactName: true,
        contactPhone: true,
        unreadCount: true,
        lastMessageAt: true,
        mode: true,
        optedOutAt: true,
        patient: { select: { id: true, fullName: true } },
        lead: { select: { id: true, name: true } },
        _count: { select: { tasks: { where: { kind: "HANDOFF", status: "OPEN" } } } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, direction: true, origin: true, status: true, type: true, createdAt: true },
        },
      },
    }),
    Promise.all([
      db.whatsAppConversation.count({ where: FILTER_WHERE.equipe }),
      db.whatsAppConversation.count({ where: FILTER_WHERE["nao-lidas"] }),
      db.whatsAppConversation.count({ where: { tasks: { some: { kind: "HANDOFF", status: "OPEN" } } } }),
    ]),
  ]);
  const [human, unread, waiting] = counts;
  return {
    counts: { human, unread, waiting },
    items: conversations.map((conversation) => ({
      ...conversation,
      awaitingTeam: conversation._count.tasks > 0,
      messages: conversation.messages.map((message) => ({
        ...message,
        body: openText(message.body, messageContext(conversation.id), keyring),
      })),
    })),
  };
}

export type ConversationListItem = Awaited<ReturnType<typeof listConversations>>["items"][number];

export async function getConversationDetail(id: string) {
  await requirePermission("whatsapp:read");
  const db = getDb();
  const keyring = getContentKeyring();
  const conversation = await db.whatsAppConversation.findUnique({
    where: { id },
    select: {
      id: true,
      contactName: true,
      contactPhone: true,
      unreadCount: true,
      lastInboundAt: true,
      mode: true,
      handoffAt: true,
      handoffReason: true,
      optedOutAt: true,
      patient: { select: { id: true, fullName: true, whatsappOptIn: true, marketingOptIn: true, isActive: true } },
      lead: { select: { id: true, name: true, whatsappOptIn: true, status: true } },
      tasks: {
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, title: true, details: true, urgent: true, createdAt: true },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          direction: true,
          origin: true,
          type: true,
          body: true,
          templateName: true,
          provider: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
          errorMessage: true,
          createdAt: true,
          sentBy: { select: { name: true } },
          replyOfRun: { select: { intent: true, outcome: true, sourceEntryIds: true, flags: true, engine: true } },
          knowledgeGaps: { where: { reason: "NEGATIVE_FEEDBACK" }, select: { id: true, status: true } },
        },
      },
    },
  });
  if (!conversation) throw new NotFoundError("Conversa");

  const sourceIds = [...new Set(conversation.messages.flatMap((message) => message.replyOfRun?.sourceEntryIds ?? []))];
  const sources = sourceIds.length
    ? await db.knowledgeEntry.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, publishedVersion: { select: { title: true } } },
      })
    : [];
  const sourceTitles = new Map(sources.map((source) => [source.id, source.publishedVersion?.title ?? "Entrada arquivada"]));

  return {
    ...conversation,
    messages: [...conversation.messages].reverse().map((message) => ({
      ...message,
      body: openText(message.body, messageContext(conversation.id), keyring),
      sources: (message.replyOfRun?.sourceEntryIds ?? []).map((sourceId) => sourceTitles.get(sourceId) ?? "Entrada removida"),
      reported: message.knowledgeGaps.length > 0,
    })),
  };
}

export type ConversationDetail = Awaited<ReturnType<typeof getConversationDetail>>;
