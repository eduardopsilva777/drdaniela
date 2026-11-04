/**
 * Contrato da integração com o WhatsApp. A aplicação depende apenas desta
 * interface; os adaptadores (desenvolvimento e API oficial da Meta) são
 * intercambiáveis por configuração (WHATSAPP_PROVIDER).
 */

export type WhatsAppProviderName = "disabled" | "development" | "cloud_api";

export interface OutboundText {
  /** Destinatário em E.164. */
  to: string;
  body: string;
}

export interface OutboundTemplate {
  to: string;
  templateName: string;
  language: string;
  /** Parâmetros do corpo do modelo, na ordem ({{1}}, {{2}}, ...). */
  bodyParameters: string[];
}

export interface SendResult {
  providerMessageId: string | null;
  /** SIMULATED: o adaptador de desenvolvimento registrou, mas nada saiu do servidor. */
  status: "SENT" | "SIMULATED";
}

export interface WhatsAppProvider {
  readonly name: "development" | "cloud_api";
  sendText(message: OutboundText): Promise<SendResult>;
  sendTemplate(message: OutboundTemplate): Promise<SendResult>;
}

/** Erro de envio com mensagem segura para registro (sem tokens nem conteúdo). */
export class WhatsAppSendError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = "WhatsAppSendError";
    this.code = code;
    this.retryable = retryable;
  }
}
