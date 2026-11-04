import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_CONFIG } from "@/lib/assistant-config";
import { messageContext, openText } from "@/server/crypto/content-cipher";
import { getContentKeyring } from "@/server/crypto/content-key";

import { createTestDb, createTestPatient, createTestUser, resetDatabase } from "./helpers";

/**
 * Rotas públicas (sem sessão) que validam a própria credencial: webhook da
 * Meta (assinatura) e processamento da fila de lembretes (CRON_SECRET).
 */

const db = createTestDb();
const APP_SECRET = "segredo-do-app-meta-para-testes";
const VERIFY_TOKEN = "token-de-verificacao-dos-testes";
const CRON_SECRET = "segredo-do-cron-para-testes-0123456789";

let webhook: typeof import("@/app/api/webhooks/whatsapp/route");
let jobs: typeof import("@/app/api/jobs/reminders/route");
let exportRoute: typeof import("@/app/api/pacientes/[id]/exportar/route");

beforeAll(async () => {
  // A configuração é lida na primeira chamada; as rotas usam o banco de testes.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.WHATSAPP_PROVIDER = "development";
  webhook = await import("@/app/api/webhooks/whatsapp/route");
  jobs = await import("@/app/api/jobs/reminders/route");
  exportRoute = await import("@/app/api/pacientes/[id]/exportar/route");
});

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

function signedRequest(body: string, signatureSecret = APP_SECRET) {
  const signature = `sha256=${createHmac("sha256", signatureSecret).update(body, "utf8").digest("hex")}`;
  return new Request("http://localhost/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body,
  });
}

const inbound = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ wa_id: "5511987650000", profile: { name: "Contato" } }],
            messages: [{ id: "wamid.ROUTE1", from: "5511987650000", timestamp: "1793710800", type: "text", text: { body: "Oi" } }],
          },
        },
      ],
    },
  ],
});

describe("webhook do WhatsApp", () => {
  it("verificação do endpoint exige o token configurado", async () => {
    const ok = await webhook.GET(
      new NextRequest(`http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42`),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");

    const denied = await webhook.GET(
      new NextRequest("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42"),
    );
    expect(denied.status).toBe(403);
  });

  it("rejeita assinatura inválida sem processar nada", async () => {
    const response = await webhook.POST(signedRequest(inbound, "segredo-de-um-atacante"));
    expect(response.status).toBe(401);
    expect(await db.whatsAppMessage.count()).toBe(0);
    expect(await db.webhookEvent.count()).toBe(0);
  });

  it("processa evento assinado uma única vez", async () => {
    const first = await webhook.POST(signedRequest(inbound));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: 1, processed: 1 });

    const again = await webhook.POST(signedRequest(inbound));
    expect(await again.json()).toMatchObject({ processed: 0, duplicates: 1 });
    expect(await db.whatsAppMessage.count()).toBe(1);
  });

  it("valida a assinatura sobre os bytes brutos (texto com acentos)", async () => {
    const body = inbound.replace("Oi", "Olá, tudo bem? Ção");
    const response = await webhook.POST(signedRequest(body));
    expect(await response.json()).toMatchObject({ processed: 1 });
    const message = await db.whatsAppMessage.findFirstOrThrow();
    expect(openText(message.body, messageContext(message.conversationId), getContentKeyring())).toBe("Olá, tudo bem? Ção");
  });

  it("JSON inválido é recusado; formato desconhecido é confirmado e ignorado", async () => {
    expect((await webhook.POST(signedRequest("{nao-e-json"))).status).toBe(400);
    const unknown = await webhook.POST(signedRequest(JSON.stringify({ object: "page", entry: [] })));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ignored: true });
  });
});

describe("exportação de dados do paciente", () => {
  it("recusa navegação vinda de outro site antes de qualquer processamento", async () => {
    const request = new Request("http://localhost/api/pacientes/0192f0c5-5a8e-7c4e-9a8e-3f1d2b3c4d5e/exportar", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    const response = await exportRoute.GET(request, {
      params: Promise.resolve({ id: "0192f0c5-5a8e-7c4e-9a8e-3f1d2b3c4d5e" }),
    });
    expect(response.status).toBe(403);
    expect(await db.auditLog.count({ where: { action: "patient.export" } })).toBe(0);
  });
});

describe("processamento agendado da fila de lembretes", () => {
  function cronRequest(token?: string) {
    return new Request("http://localhost/api/jobs/reminders", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it("exige o segredo do agendador", async () => {
    expect((await jobs.POST(cronRequest())).status).toBe(401);
    expect((await jobs.POST(cronRequest("segredo-errado-com-mesmo-tamanho-0000"))).status).toBe(401);
  });

  it("processa os lembretes vencidos e registra na auditoria", async () => {
    const professional = await createTestUser(db, { role: "PROFESSIONAL" });
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const appointment = await db.appointment.create({
      data: { patientId: patient.id, professionalId: professional.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) },
    });
    await db.reminder.create({
      data: { kind: "APPOINTMENT", patientId: patient.id, appointmentId: appointment.id, scheduledFor: new Date(Date.now() - 60_000) },
    });

    // O teste usa o relógio real: libera mensagens proativas o dia todo para não depender da hora.
    await db.assistantSettings.create({
      data: {
        id: "default",
        config: {
          ...DEFAULT_ASSISTANT_CONFIG,
          proactive: { ...DEFAULT_ASSISTANT_CONFIG.proactive, allowedWeekdays: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59" },
        },
      },
    });

    const response = await jobs.POST(cronRequest(CRON_SECRET));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reminders: { claimed: 1, simulated: 1 } });

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "automation.run" } });
    expect(audit.metadata).toMatchObject({ reminders: 1, source: "cron" });
  });
});
