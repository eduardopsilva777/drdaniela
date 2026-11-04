"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { sanitizeNextPath } from "@/lib/auth/redirect";
import { loginSchema } from "@/lib/validation/auth";
import { recordAudit } from "@/server/audit";
import { getDb } from "@/server/db";
import { logger } from "@/server/logger";
import { getRequestMeta } from "@/server/request-meta";

import { authenticateWithPassword, type AuthenticationResult } from "./authenticate";
import { clearSessionCookie, setSessionCookie } from "./cookies";
import { getCurrentSession, PASSWORD_CHANGE_PATH } from "./dal";
import { getLoginThrottlePolicy, getSessionPolicy } from "./policy";
import { invalidateSession } from "./session-store";

export interface LoginFormState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
  /** Devolvido para repreencher o campo após erro (a senha nunca é devolvida). */
  email?: string;
}

const GENERIC_FAILURE = "E-mail ou senha incorretos.";
const UNAVAILABLE = "Não foi possível entrar agora. Tente novamente em instantes.";

export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  };
  const submittedEmail = typeof raw.email === "string" ? raw.email.slice(0, 254) : "";

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      status: "error",
      fieldErrors: { email: fieldErrors.email, password: fieldErrors.password },
      email: submittedEmail,
    };
  }

  let result: AuthenticationResult;
  try {
    const meta = await getRequestMeta();
    result = await authenticateWithPassword(
      getDb(),
      { email: parsed.data.email, password: parsed.data.password, ...meta },
      { session: getSessionPolicy(), throttle: getLoginThrottlePolicy() },
    );
  } catch (error) {
    logger.error("auth.login.error", { err: error });
    return { status: "error", message: UNAVAILABLE, email: submittedEmail };
  }

  if (!result.ok) {
    if (result.reason === "blocked") {
      const minutes = Math.ceil(result.retryAfterSeconds / 60);
      return {
        status: "error",
        message: `Muitas tentativas sem sucesso. Aguarde ${minutes} ${
          minutes === 1 ? "minuto" : "minutos"
        } e tente novamente.`,
        email: submittedEmail,
      };
    }
    return { status: "error", message: GENERIC_FAILURE, email: submittedEmail };
  }

  await setSessionCookie(result.session.token, result.session.expiresAt);
  logger.info("auth.login.success", { userId: result.user.id });
  redirect(result.user.mustChangePassword ? PASSWORD_CHANGE_PATH : sanitizeNextPath(parsed.data.next));
}

export async function logoutAction(): Promise<void> {
  const session = await getCurrentSession();

  if (session) {
    const meta = await getRequestMeta();
    await getDb().$transaction(async (tx) => {
      await invalidateSession(tx, session.sessionId);
      await recordAudit(tx, {
        actorId: session.user.id,
        action: "auth.logout",
        entityType: "user",
        entityId: session.user.id,
        ...meta,
      });
    });
    logger.info("auth.logout", { userId: session.user.id });
  }

  await clearSessionCookie();
  redirect("/login");
}
