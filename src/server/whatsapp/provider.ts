import "server-only";

import { getServerEnv } from "@/server/env";

import { CloudApiWhatsAppProvider } from "./cloud-api-provider";
import { DevelopmentWhatsAppProvider } from "./development-provider";
import type { WhatsAppProvider, WhatsAppProviderName } from "./types";

export interface WhatsAppIntegrationStatus {
  provider: WhatsAppProviderName;
  canSend: boolean;
  title: string;
  description: string;
  webhookConfigured: boolean;
  templates: { returnReminder: boolean; appointmentReminder: boolean };
}

/** Provedor ativo conforme WHATSAPP_PROVIDER; `null` quando a integração está desativada. */
export function getWhatsAppProvider(): WhatsAppProvider | null {
  const env = getServerEnv();
  if (env.WHATSAPP_PROVIDER === "development") return new DevelopmentWhatsAppProvider();
  if (env.WHATSAPP_PROVIDER === "cloud_api") {
    return new CloudApiWhatsAppProvider({
      graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
      accessToken: env.WHATSAPP_ACCESS_TOKEN!,
    });
  }
  return null;
}

/** Situação da integração exibida na interface — nunca expõe credenciais. */
export function getWhatsAppIntegrationStatus(): WhatsAppIntegrationStatus {
  const env = getServerEnv();
  const templates = {
    returnReminder: Boolean(env.WHATSAPP_TEMPLATE_RETURN_REMINDER),
    appointmentReminder: Boolean(env.WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER),
  };
  const webhookConfigured = Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);

  switch (env.WHATSAPP_PROVIDER) {
    case "development":
      return {
        provider: "development",
        canSend: true,
        title: "Modo de desenvolvimento",
        description:
          "Mensagens e lembretes são apenas registrados aqui, marcados como simulados. Nada é enviado aos pacientes.",
        webhookConfigured,
        templates,
      };
    case "cloud_api":
      return {
        provider: "cloud_api",
        canSend: true,
        title: "API oficial do WhatsApp Business",
        description: "Mensagens são enviadas pela Cloud API da Meta, com status de entrega e leitura.",
        webhookConfigured,
        templates,
      };
    default:
      return {
        provider: "disabled",
        canSend: false,
        title: "Integração desativada",
        description:
          "Nenhuma mensagem é enviada. Lembretes ficam registrados no CRM até que a API oficial seja configurada.",
        webhookConfigured,
        templates,
      };
  }
}
