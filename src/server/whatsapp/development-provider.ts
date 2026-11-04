import { randomUUID } from "node:crypto";

import { logger } from "@/server/logger";

import type { OutboundTemplate, OutboundText, SendResult, WhatsAppProvider } from "./types";

/**
 * Adaptador de DESENVOLVIMENTO: nenhuma mensagem sai do servidor. As mensagens
 * são registradas no banco com status SIMULATED, e a interface deixa isso
 * explícito. Recusado em produção pela validação de ambiente.
 */
export class DevelopmentWhatsAppProvider implements WhatsAppProvider {
  readonly name = "development" as const;

  async sendText(_message: OutboundText): Promise<SendResult> {
    logger.info("whatsapp.development.simulated", { kind: "text" });
    return { providerMessageId: `dev-${randomUUID()}`, status: "SIMULATED" };
  }

  async sendTemplate(message: OutboundTemplate): Promise<SendResult> {
    logger.info("whatsapp.development.simulated", { kind: "template", template: message.templateName });
    return { providerMessageId: `dev-${randomUUID()}`, status: "SIMULATED" };
  }
}
