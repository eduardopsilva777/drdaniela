import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Webhooks da Cloud API: verificação de assinatura e leitura do payload.
 * Funções puras (sem banco) para facilitar os testes.
 */

/**
 * Valida o cabeçalho X-Hub-Signature-256 ("sha256=<hex>") contra o corpo BRUTO
 * da requisição (de preferência os bytes recebidos, sem decodificar), com
 * comparação em tempo constante.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const received = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(received.toLowerCase(), "hex"), Buffer.from(expected, "hex"));
}

/** Verificação do endpoint (GET) feita pela Meta ao configurar o webhook. */
export function verifySubscription(
  params: URLSearchParams,
  verifyToken: string,
): { ok: true; challenge: string } | { ok: false } {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge) return { ok: false };
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, challenge };
}

const inboundMessageSchema = z.object({
  id: z.string().min(1).max(128),
  from: z.string().regex(/^\d{8,15}$/),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string(),
  text: z.object({ body: z.string().max(4096) }).optional(),
});

const statusSchema = z.object({
  id: z.string().min(1).max(128),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string().regex(/^\d+$/),
  recipient_id: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
});

const changeSchema = z.object({
  field: z.string(),
  value: z.object({
    messaging_product: z.string().optional(),
    contacts: z
      .array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().max(120).optional() }).optional() }))
      .optional(),
    messages: z.array(inboundMessageSchema).optional(),
    statuses: z.array(statusSchema).optional(),
    // Campo "message_template_status_update": situação dos modelos na Meta.
    event: z.string().max(40).optional(),
    message_template_id: z.union([z.string(), z.number()]).optional(),
    message_template_name: z.string().max(512).optional(),
    message_template_language: z.string().max(15).optional(),
    reason: z.string().max(300).nullable().optional(),
  }),
});

export const webhookPayloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({ id: z.string(), time: z.number().optional(), changes: z.array(changeSchema) })),
});

export type WebhookPayload = z.output<typeof webhookPayloadSchema>;

export interface InboundMessageEvent {
  kind: "message";
  providerMessageId: string;
  from: string;
  contactName: string | null;
  receivedAt: Date;
  type: string;
  body: string | null;
}

export interface StatusEvent {
  kind: "status";
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  occurredAt: Date;
  errorCode: string | null;
  errorTitle: string | null;
}

export interface TemplateStatusEvent {
  kind: "template_status";
  name: string;
  language: string | null;
  event: string;
  reason: string | null;
  metaTemplateId: string | null;
  /** Momento do evento (segundos), para distinguir mudanças repetidas (ex.: pausado → aprovado de novo). */
  time: number | null;
}

export type WebhookEventData = InboundMessageEvent | StatusEvent | TemplateStatusEvent;

/** Achata o payload em eventos individuais (mensagens recebidas e atualizações de status). */
export function extractWebhookEvents(payload: WebhookPayload): WebhookEventData[] {
  const events: WebhookEventData[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field === "message_template_status_update") {
        const value = change.value;
        if (value.message_template_name && value.event) {
          events.push({
            kind: "template_status",
            name: value.message_template_name,
            language: value.message_template_language ?? null,
            event: value.event,
            reason: value.reason ?? null,
            metaTemplateId: value.message_template_id !== undefined ? String(value.message_template_id) : null,
            time: entry.time ?? null,
          });
        }
        continue;
      }
      if (change.field !== "messages") continue;
      const names = new Map<string, string>();
      for (const contact of change.value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) names.set(contact.wa_id, contact.profile.name);
      }
      for (const message of change.value.messages ?? []) {
        events.push({
          kind: "message",
          providerMessageId: message.id,
          from: message.from,
          contactName: names.get(message.from) ?? null,
          receivedAt: new Date(Number(message.timestamp) * 1000),
          type: message.type,
          body: message.type === "text" ? (message.text?.body ?? null) : null,
        });
      }
      for (const status of change.value.statuses ?? []) {
        events.push({
          kind: "status",
          providerMessageId: status.id,
          status: status.status,
          occurredAt: new Date(Number(status.timestamp) * 1000),
          errorCode: status.errors?.[0]?.code !== undefined ? String(status.errors[0].code) : null,
          errorTitle: status.errors?.[0]?.title?.slice(0, 200) ?? null,
        });
      }
    }
  }
  return events;
}

/** Chave de deduplicação: reentregas do mesmo evento não são processadas de novo. */
export function webhookEventKey(event: WebhookEventData): string {
  if (event.kind === "message") return `msg:${event.providerMessageId}`;
  if (event.kind === "status") return `status:${event.providerMessageId}:${event.status}`;
  return `template:${event.metaTemplateId ?? event.name}:${event.language ?? ""}:${event.event}:${event.time ?? ""}`.slice(0, 128);
}

const STATUS_RANK = { sent: 1, delivered: 2, read: 3 } as const;

/** Status só avançam (enviada → entregue → lida); "falhou" é terminal. */
export function nextMessageStatus(
  current: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED" | "SIMULATED",
  incoming: StatusEvent["status"],
): "SENT" | "DELIVERED" | "READ" | "FAILED" | null {
  if (current === "FAILED" || current === "RECEIVED" || current === "SIMULATED") return null;
  if (incoming === "failed") return current === "READ" || current === "DELIVERED" ? null : "FAILED";
  const currentRank = current === "PENDING" ? 0 : STATUS_RANK[current.toLowerCase() as keyof typeof STATUS_RANK];
  if (STATUS_RANK[incoming] <= currentRank) return null;
  return incoming.toUpperCase() as "SENT" | "DELIVERED" | "READ";
}
