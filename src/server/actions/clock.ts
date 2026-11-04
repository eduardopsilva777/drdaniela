import "server-only";

import { getServerEnv } from "@/server/env";
import type { CareClock } from "@/server/services/care-plan";

/** Fuso da clínica e antecedência dos lembretes, a partir das variáveis de ambiente. */
export function serviceClock(): CareClock {
  const env = getServerEnv();
  return {
    timeZone: env.APP_TIMEZONE,
    reminders: {
      appointmentHoursBefore: env.REMINDER_APPOINTMENT_HOURS_BEFORE,
      returnDaysBefore: env.REMINDER_RETURN_DAYS_BEFORE,
      sendTime: "09:00",
    },
  };
}
