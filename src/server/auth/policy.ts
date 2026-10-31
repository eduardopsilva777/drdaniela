import "server-only";

import { getServerEnv } from "@/server/env";

import { DEFAULT_LOGIN_THROTTLE_POLICY, type LoginThrottlePolicy } from "./login-throttle";
import type { SessionPolicy } from "./session-store";

/** Políticas de sessão e de login derivadas das variáveis de ambiente. */

export function getSessionPolicy(): SessionPolicy {
  const env = getServerEnv();
  return {
    maxAgeMs: env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000,
    idleTimeoutMs: env.SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000,
    touchIntervalMs: 60 * 1000,
  };
}

export function getLoginThrottlePolicy(): LoginThrottlePolicy {
  return { ...DEFAULT_LOGIN_THROTTLE_POLICY, ipLimitEnabled: getServerEnv().TRUST_PROXY };
}
