import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyCloudApiError, CloudApiWhatsAppProvider, toWaId } from "@/server/whatsapp/cloud-api-provider";
import { WhatsAppSendError } from "@/server/whatsapp/types";
import {
  extractWebhookEvents,
  nextMessageStatus,
  verifySubscription,
  verifyWebhookSignature,
  webhookEventKey,
  webhookPayloadSchema,
} from "@/server/whatsapp/webhook";

const SECRET = "app-secret-de-teste-123";

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("assinatura dos webhooks (X-Hub-Signature-256)", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("aceita somente a assinatura do corpo bruto com o segredo correto", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, sign(body).toUpperCase().replace("SHA256=", "sha256="), SECRET)).toBe(true);
    expect(verifyWebhookSignature(`${body} `, sign(body), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, "outro-segredo-qualquer"), SECRET)).toBe(false);
  });

  it("aceita o corpo como bytes (UTF-8 multibyte) e rejeita bytes alterados", () => {
    const bytes = Buffer.from(JSON.stringify({ texto: "Olá, ação" }), "utf8");
    const signature = `sha256=${createHmac("sha256", SECRET).update(bytes).digest("hex")}`;
    expect(verifyWebhookSignature(bytes, signature, SECRET)).toBe(true);
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 2] ^= 1;
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejeita cabeçalhos ausentes ou malformados", () => {
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "sha1=abc", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=xyz", SECRET)).toBe(false);
  });

  it("verificação de assinatura do endpoint (GET da Meta)", () => {
    const params = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "token-verificacao", "hub.challenge": "123" });
    expect(verifySubscription(params, "token-verificacao")).toEqual({ ok: true, challenge: "123" });
    expect(verifySubscription(params, "outro-token-aqui")).toEqual({ ok: false });
    params.set("hub.mode", "unsubscribe");
    expect(verifySubscription(params, "token-verificacao")).toEqual({ ok: false });
  });
});

describe("leitura do payload", () => {
  const payload = webhookPayloadSchema.parse({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              contacts: [{ wa_id: "5511987654321", profile: { name: "Maria" } }],
              messages: [
                { id: "wamid.A", from: "5511987654321", timestamp: "1793710800", type: "text", text: { body: "Oi" } },
                { id: "wamid.B", from: "5511987654321", timestamp: "1793710801", type: "image" },
              ],
              statuses: [{ id: "wamid.C", status: "failed", timestamp: "1793710802", errors: [{ code: 131026, title: "Undeliverable" }] }],
            },
          },
          { field: "account_update", value: {} },
        ],
      },
    ],
  });

  it("transforma o payload em eventos individuais, sem guardar mídia", () => {
    const events = extractWebhookEvents(payload);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ kind: "message", contactName: "Maria", body: "Oi", type: "text" });
    expect(events[1]).toMatchObject({ kind: "message", type: "image", body: null });
    expect(events[2]).toMatchObject({ kind: "status", status: "failed", errorCode: "131026" });
    expect(events.map(webhookEventKey)).toEqual(["msg:wamid.A", "msg:wamid.B", "status:wamid.C:failed"]);
  });

  it("rejeita payloads de outros objetos", () => {
    expect(webhookPayloadSchema.safeParse({ object: "page", entry: [] }).success).toBe(false);
  });

  it("status só avançam; falha é terminal e não sobrescreve entrega/leitura", () => {
    expect(nextMessageStatus("PENDING", "sent")).toBe("SENT");
    expect(nextMessageStatus("SENT", "read")).toBe("READ");
    expect(nextMessageStatus("READ", "delivered")).toBeNull();
    expect(nextMessageStatus("DELIVERED", "failed")).toBeNull();
    expect(nextMessageStatus("SENT", "failed")).toBe("FAILED");
    expect(nextMessageStatus("FAILED", "read")).toBeNull();
    expect(nextMessageStatus("SIMULATED", "delivered")).toBeNull();
  });
});

describe("adaptador da Cloud API", () => {
  afterEach(() => vi.restoreAllMocks());

  const TOKEN = "EAAG-token-super-secreto-de-teste";

  function provider(fetchImpl: typeof fetch) {
    return new CloudApiWhatsAppProvider({ graphApiVersion: "v23.0", phoneNumberId: "123456", accessToken: TOKEN, fetchImpl });
  }

  it("envia modelos aprovados com os parâmetros na ordem", async () => {
    const fetchMock = vi.fn(async () => Response.json({ messages: [{ id: "wamid.OK" }] }));
    const result = await provider(fetchMock as unknown as typeof fetch).sendTemplate({
      to: "+5511987654321",
      templateName: "lembrete_retorno",
      language: "pt_BR",
      bodyParameters: ["Maria", "Toxina", "10/11"],
    });

    expect(result).toEqual({ providerMessageId: "wamid.OK", status: "SENT" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v23.0/123456/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: "5511987654321",
      type: "template",
      template: {
        name: "lembrete_retorno",
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [{ text: "Maria" }, { text: "Toxina" }, { text: "10/11" }] }],
      },
    });
  });

  it("traduz erros da API sem registrar o token nos logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      Response.json({ error: { code: 131047, message: `token ${TOKEN}` } }, { status: 400 }),
    );
    const error = await provider(fetchMock as unknown as typeof fetch)
      .sendText({ to: "+5511987654321", body: "Oi" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect(error).toMatchObject({ code: "outside_24h_window", retryable: false });
    const logged = [...warn.mock.calls, ...log.mock.calls].flat().join(" ");
    expect(logged).not.toContain(TOKEN);
  });

  it("falhas de rede e tempo esgotado podem ser repetidas", async () => {
    const network = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(provider(network as unknown as typeof fetch).sendText({ to: "+5511987654321", body: "Oi" })).rejects.toMatchObject({
      code: "network_error",
      retryable: true,
    });

    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    await expect(provider(timeout as unknown as typeof fetch).sendText({ to: "+5511987654321", body: "Oi" })).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    });
  });

  it("classifica os códigos de erro mais comuns", () => {
    expect(classifyCloudApiError(400, { code: 131026 })).toMatchObject({ code: "undeliverable", retryable: false });
    expect(classifyCloudApiError(400, { code: 132001 })).toMatchObject({ code: "template_error", retryable: false });
    expect(classifyCloudApiError(401, {})).toMatchObject({ code: "auth_error", retryable: false });
    expect(classifyCloudApiError(429, {})).toMatchObject({ code: "rate_limited", retryable: true });
    expect(classifyCloudApiError(503, undefined)).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(classifyCloudApiError(400, { code: 999 })).toMatchObject({ code: "http_400", retryable: false });
    expect(toWaId("+55 (11) 98765-4321")).toBe("5511987654321");
  });
});
