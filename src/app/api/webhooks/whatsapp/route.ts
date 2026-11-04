import { after, type NextRequest } from "next/server";

import { getAutomationDependencies } from "@/server/assistant/runtime";
import { getDb } from "@/server/db";
import { getServerEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { processAssistantQueue } from "@/server/services/assistant";
import { processWebhookPayload } from "@/server/services/whatsapp";
import {
  readBodyWithLimit,
  verifySubscription,
  verifyWebhookSignature,
  webhookPayloadSchema,
} from "@/server/whatsapp/webhook";

/**
 * Webhook da API oficial do WhatsApp Business (Cloud API da Meta).
 *
 * GET  — verificação do endpoint (hub.challenge) com WHATSAPP_WEBHOOK_VERIFY_TOKEN.
 * POST — mensagens recebidas e atualizações de status, autenticadas pela
 *        assinatura X-Hub-Signature-256 (HMAC do corpo bruto com WHATSAPP_APP_SECRET).
 *
 * O payload bruto não é armazenado nem registrado em log; cada evento é
 * deduplicado por chave (reentregas da Meta não são processadas duas vezes).
 *
 * A resposta à Meta é imediata; o assistente virtual responde logo em seguida
 * (`after`), fora do tempo da requisição. Se o processo cair nesse meio-tempo,
 * o ciclo de automação (/api/jobs/automation) retoma as execuções pendentes.
 */

/** A Meta envia lotes pequenos; acima disso a requisição é recusada. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Agenda a resposta do assistente para depois da resposta à Meta. Se não for
 * possível agendar (fora do ciclo de requisição do Next), as mensagens ficam
 * pendentes e o ciclo de automação as processa — o webhook nunca falha por isso.
 */
function scheduleAssistant(db: ReturnType<typeof getDb>) {
  try {
    after(async () => {
      try {
        await processAssistantQueue(db, getAutomationDependencies());
      } catch (error) {
        logger.error("whatsapp.webhook.assistant_failed", { err: error });
      }
    });
  } catch {
    logger.warn("whatsapp.webhook.assistant_deferred");
  }
}

export async function GET(request: NextRequest) {
  const verifyToken = getServerEnv().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) return new Response("Webhook não configurado.", { status: 404 });

  const result = verifySubscription(request.nextUrl.searchParams, verifyToken);
  if (!result.ok) {
    logger.warn("whatsapp.webhook.verification_rejected");
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(result.challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request) {
  const appSecret = getServerEnv().WHATSAPP_APP_SECRET;
  if (!appSecret) return Response.json({ error: "not_configured" }, { status: 404 });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 });

  // A assinatura é calculada pela Meta sobre os bytes exatos do corpo. A leitura
  // para no limite: um corpo sem Content-Length não é acumulado inteiro na memória.
  const rawBody = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!rawBody) return Response.json({ error: "payload_too_large" }, { status: 413 });

  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    logger.warn("whatsapp.webhook.invalid_signature");
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = webhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    // Assinatura válida, mas formato não suportado: confirma o recebimento para a
    // Meta não reenviar indefinidamente e registra apenas o fato (sem conteúdo).
    logger.warn("whatsapp.webhook.unsupported_payload");
    return Response.json({ ignored: true });
  }

  try {
    const db = getDb();
    const summary = await processWebhookPayload(db, parsed.data);
    if (summary.processed > 0) scheduleAssistant(db);
    return Response.json(summary);
  } catch (error) {
    // 500 faz a Meta reenviar; o processamento é idempotente.
    logger.error("whatsapp.webhook.failed", { err: error });
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
