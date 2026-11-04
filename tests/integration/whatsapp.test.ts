import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { messageContext, openText } from "@/server/crypto/content-cipher";
import { getContentKeyring } from "@/server/crypto/content-key";
import { DomainError } from "@/server/errors";
import {
  markConversationRead,
  openConversationFor,
  processWebhookPayload,
  sendTextMessage,
  simulateInboundMessage,
} from "@/server/services/whatsapp";
import { DevelopmentWhatsAppProvider } from "@/server/whatsapp/development-provider";
import { webhookPayloadSchema } from "@/server/whatsapp/webhook";
import type { WhatsAppProvider } from "@/server/whatsapp/types";

import { CLOCK, createTeam, createTestDb, createTestPatient, resetDatabase } from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const TIMESTAMP = String(Math.floor(CLOCK.now!.getTime() / 1000));

function inboundPayload(from: string, id: string, body = "Olá, quero agendar") {
  return webhookPayloadSchema.parse({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              contacts: [{ wa_id: from, profile: { name: "Contato Demo" } }],
              messages: [{ id, from, timestamp: TIMESTAMP, type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  });
}

function statusPayload(id: string, status: "sent" | "delivered" | "read" | "failed", offsetSeconds = 0) {
  return webhookPayloadSchema.parse({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: { statuses: [{ id, status, timestamp: String(Number(TIMESTAMP) + offsetSeconds), recipient_id: "5511987654321" }] },
          },
        ],
      },
    ],
  });
}

const cloudLike: WhatsAppProvider = {
  name: "cloud_api",
  sendText: async () => ({ providerMessageId: "wamid.TEST", status: "SENT" }),
  sendTemplate: async () => ({ providerMessageId: "wamid.TEST2", status: "SENT" }),
};

describe("webhook da API oficial", () => {
  it("registra a mensagem recebida na conversa do paciente e ignora reentregas", async () => {
    const patient = await createTestPatient(db, { phone: "+5511987654321" });

    const first = await processWebhookPayload(db, inboundPayload("5511987654321", "wamid.IN1"));
    expect(first).toMatchObject({ received: 1, processed: 1, duplicates: 0 });

    const conversation = await db.whatsAppConversation.findFirstOrThrow({ include: { messages: true } });
    expect(conversation).toMatchObject({ contactPhone: "+5511987654321", patientId: patient.id, unreadCount: 1, contactName: "Contato Demo" });
    expect(conversation.lastInboundAt).toEqual(new Date(Number(TIMESTAMP) * 1000));
    expect(conversation.messages[0]).toMatchObject({ direction: "INBOUND", status: "RECEIVED", origin: "CONTACT" });
    const keyring = getContentKeyring();
    if (keyring) expect(conversation.messages[0]!.body).not.toContain("agendar");
    expect(openText(conversation.messages[0]!.body, messageContext(conversation.id), keyring)).toBe("Olá, quero agendar");

    const again = await processWebhookPayload(db, inboundPayload("5511987654321", "wamid.IN1"));
    expect(again).toMatchObject({ processed: 0, duplicates: 1 });
    expect(await db.whatsAppMessage.count()).toBe(1);

    // O registro do webhook não guarda o payload bruto.
    const event = await db.webhookEvent.findFirstOrThrow();
    expect(event).toMatchObject({ eventKey: "msg:wamid.IN1", kind: "message", signatureValid: true });
    expect(Object.keys(event)).not.toContain("payload");
  });

  it("status só avançam (enviada → entregue → lida) e eventos atrasados são ignorados", async () => {
    const conversation = await db.whatsAppConversation.create({ data: { contactPhone: "+5511987654321" } });
    const message = await db.whatsAppMessage.create({
      data: { conversationId: conversation.id, direction: "OUTBOUND", provider: "cloud_api", providerMessageId: "wamid.OUT", status: "SENT" },
    });

    await processWebhookPayload(db, statusPayload("wamid.OUT", "delivered", 5));
    await processWebhookPayload(db, statusPayload("wamid.OUT", "read", 10));
    await processWebhookPayload(db, statusPayload("wamid.OUT", "delivered", 5)); // reentrega
    await processWebhookPayload(db, statusPayload("wamid.OUT", "failed", 20)); // depois de lida: ignorado

    const stored = await db.whatsAppMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.status).toBe("READ");
    expect(stored.deliveredAt).not.toBeNull();
    expect(stored.readAt).not.toBeNull();
  });

  it("evento que falhou é reprocessado na próxima entrega (não conta como duplicado)", async () => {
    // Número fora do padrão E.164 (começa com 0): o processamento falha.
    const first = await processWebhookPayload(db, inboundPayload("0123456789", "wamid.BAD"));
    expect(first).toMatchObject({ failed: 1, processed: 0 });
    const event = await db.webhookEvent.findFirstOrThrow();
    expect(event.processedAt).toBeNull();
    expect(event.errorMessage).toBeTruthy();

    const second = await processWebhookPayload(db, inboundPayload("0123456789", "wamid.BAD"));
    expect(second).toMatchObject({ failed: 1, duplicates: 0 });
  });
});

describe("envio de mensagens", () => {
  it("sem integração, recusa o envio com explicação", async () => {
    const team = await createTeam(db);
    const conversation = await db.whatsAppConversation.create({ data: { contactPhone: "+5511987654321" } });
    const error = await sendTextMessage(db, null, team.asReception, conversation.id, "Oi").catch((caught: unknown) => caught);
    expect((error as DomainError).code).toBe("whatsapp_disabled");
  });

  it("respeita a janela de 24 horas do WhatsApp", async () => {
    const team = await createTeam(db);
    const conversation = await db.whatsAppConversation.create({
      data: { contactPhone: "+5511987654321", lastInboundAt: new Date(CLOCK.now!.getTime() - 25 * 60 * 60 * 1000) },
    });
    const error = await sendTextMessage(db, cloudLike, team.asReception, conversation.id, "Oi", CLOCK.now).catch(
      (caught: unknown) => caught,
    );
    expect((error as DomainError).code).toBe("outside_service_window");
    expect(await db.whatsAppMessage.count()).toBe(0);
  });

  it("no desenvolvimento: simula a mensagem recebida e registra a resposta como SIMULADA", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db, { phone: "+5511987654321" });
    const provider = new DevelopmentWhatsAppProvider();
    const { id } = await openConversationFor(db, team.asReception, { patientId: patient.id });

    await simulateInboundMessage(db, provider, team.asReception, id, "Bom dia!", CLOCK.now);
    const result = await sendTextMessage(db, provider, team.asReception, id, "Bom dia! Como posso ajudar?", CLOCK.now);
    expect(result.status).toBe("SIMULATED");

    const messages = await db.whatsAppMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
    expect(messages.map((message) => [message.direction, message.status])).toEqual([
      ["INBOUND", "RECEIVED"],
      ["OUTBOUND", "SIMULATED"],
    ]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "whatsapp.message.send" } });
    expect(audit.metadata).toEqual({ simulated: true });

    await markConversationRead(db, team.asReception, id);
    expect((await db.whatsAppConversation.findUniqueOrThrow({ where: { id } })).unreadCount).toBe(0);
  });

  it("a simulação de mensagem recebida não existe fora do modo de desenvolvimento", async () => {
    const team = await createTeam(db);
    const conversation = await db.whatsAppConversation.create({ data: { contactPhone: "+5511987654321" } });
    await expect(simulateInboundMessage(db, cloudLike, team.asReception, conversation.id, "Oi")).rejects.toThrow(
      /desenvolvimento/,
    );
  });
});
