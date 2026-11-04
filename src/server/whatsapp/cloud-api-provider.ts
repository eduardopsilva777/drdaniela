import { logger } from "@/server/logger";

import {
  WhatsAppSendError,
  type OutboundTemplate,
  type OutboundText,
  type SendResult,
  type WhatsAppProvider,
} from "./types";

export interface CloudApiConfig {
  graphApiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  /** Permite injetar `fetch` nos testes. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Adaptador da API oficial do WhatsApp Business (Cloud API da Meta).
 * Documentação: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Nunca registra o token nem o conteúdo das mensagens em logs.
 */
export class CloudApiWhatsAppProvider implements WhatsAppProvider {
  readonly name = "cloud_api" as const;
  private readonly config: CloudApiConfig;

  constructor(config: CloudApiConfig) {
    this.config = config;
  }

  sendText(message: OutboundText): Promise<SendResult> {
    return this.post({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId(message.to),
      type: "text",
      text: { body: message.body, preview_url: false },
    });
  }

  sendTemplate(message: OutboundTemplate): Promise<SendResult> {
    return this.post({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId(message.to),
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.language },
        components: message.bodyParameters.length
          ? [{ type: "body", parameters: message.bodyParameters.map((text) => ({ type: "text", text })) }]
          : [],
      },
    });
  }

  private async post(payload: Record<string, unknown>): Promise<SendResult> {
    const { graphApiVersion, phoneNumberId, accessToken } = this.config;
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const url = `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new WhatsAppSendError(
        timedOut ? "Tempo esgotado ao contatar a API do WhatsApp." : "Falha de rede ao contatar a API do WhatsApp.",
        timedOut ? "timeout" : "network_error",
        true,
      );
    }

    const body = (await response.json().catch(() => null)) as CloudApiResponse | null;
    if (response.ok) {
      const id = body?.messages?.[0]?.id ?? null;
      return { providerMessageId: id, status: "SENT" };
    }

    const error = classifyCloudApiError(response.status, body?.error);
    logger.warn("whatsapp.cloud_api.send_failed", { httpStatus: response.status, code: error.code });
    throw error;
  }
}

interface CloudApiResponse {
  messages?: Array<{ id?: string }>;
  error?: { code?: number; error_subcode?: number; message?: string; type?: string };
}

/** Converte "+5511987654321" no formato aceito pela API (apenas dígitos). */
export function toWaId(e164: string): string {
  return e164.replace(/\D/g, "");
}

/**
 * Traduz erros da API em mensagens para a equipe e define se vale tentar de novo.
 * Códigos: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export function classifyCloudApiError(
  httpStatus: number,
  error: CloudApiResponse["error"] | undefined,
): WhatsAppSendError {
  const code = error?.code;
  if (code === 131047) {
    return new WhatsAppSendError(
      "Fora da janela de 24 horas: só é possível enviar modelos aprovados.",
      "outside_24h_window",
      false,
    );
  }
  if (code === 131026) {
    return new WhatsAppSendError("O número não pode receber mensagens pelo WhatsApp.", "undeliverable", false);
  }
  if (code === 132001 || code === 132000) {
    return new WhatsAppSendError("Modelo de mensagem inexistente ou com parâmetros inválidos.", "template_error", false);
  }
  if (code === 190 || httpStatus === 401) {
    return new WhatsAppSendError("Credencial da API do WhatsApp inválida ou expirada.", "auth_error", false);
  }
  if (httpStatus === 429 || code === 130429 || code === 131056) {
    return new WhatsAppSendError("Limite de envio da API atingido. Nova tentativa em breve.", "rate_limited", true);
  }
  if (httpStatus >= 500) {
    return new WhatsAppSendError("Instabilidade na API do WhatsApp. Nova tentativa em breve.", "provider_unavailable", true);
  }
  return new WhatsAppSendError("A API do WhatsApp recusou a mensagem.", `http_${httpStatus}`, false);
}
