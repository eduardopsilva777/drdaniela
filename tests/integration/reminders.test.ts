import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { appointmentCreateSchema } from "@/lib/validation/appointments";
import { messageContext, openText } from "@/server/crypto/content-cipher";
import { getContentKeyring } from "@/server/crypto/content-key";
import { createAppointment } from "@/server/services/appointments";
import {
  cancelReminder,
  processReminderQueue,
  retryDelayMs,
  retryReminder,
  type QueueDependencies,
} from "@/server/services/reminders";
import { DevelopmentWhatsAppProvider } from "@/server/whatsapp/development-provider";
import { WhatsAppSendError, type WhatsAppProvider } from "@/server/whatsapp/types";

import { CLOCK, createTeam, createTestDb, createTestPatient, createTestProcedure, resetDatabase } from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

/** Provedor falso que simula a API oficial (sucesso ou falhas). */
class FakeCloudProvider implements WhatsAppProvider {
  readonly name = "cloud_api" as const;
  sent: string[] = [];
  constructor(private readonly behavior: "ok" | "retryable" | "fatal" = "ok") {}

  async sendText() {
    return { providerMessageId: `wamid.${randomUUID()}`, status: "SENT" as const };
  }

  async sendTemplate(message: { to: string; templateName: string }) {
    if (this.behavior === "retryable") throw new WhatsAppSendError("Instabilidade na API.", "provider_unavailable", true);
    if (this.behavior === "fatal") throw new WhatsAppSendError("Número sem WhatsApp.", "undeliverable", false);
    this.sent.push(message.templateName);
    return { providerMessageId: `wamid.${randomUUID()}`, status: "SENT" as const };
  }
}

function deps(provider: WhatsAppProvider | null, templates: QueueDependencies["templates"] = {}): QueueDependencies {
  return { provider, timeZone: CLOCK.timeZone, language: "pt_BR", templates };
}

/** Agendamento em 04/11 às 09:00 → lembrete previsto para 03/11 às 09:00. */
async function scheduledReminder(optIn = true) {
  const team = await createTeam(db);
  const patient = await createTestPatient(db, { whatsappOptIn: optIn, fullName: "Joana Demo" });
  const procedure = await createTestProcedure(db, { name: "Limpeza de pele Demo" });
  const appointment = await createAppointment(
    db,
    team.asReception,
    appointmentCreateSchema.parse({
      subject: "patient",
      patientId: patient.id,
      professionalId: team.professional.id,
      procedureId: procedure.id,
      date: "2026-11-04",
      startTime: "09:00",
      durationMinutes: 60,
    }),
    CLOCK,
  );
  const reminder = await db.reminder.findFirst({ where: { appointmentId: appointment.id } });
  return { team, patient, appointment, reminder: reminder! };
}

const DUE = new Date("2026-11-03T09:05:00-03:00");

describe("fila de lembretes", () => {
  it("com a integração desativada nada é enviado e o lembrete continua visível como pendente", async () => {
    const { reminder } = await scheduledReminder();
    const summary = await processReminderQueue(db, deps(null), { now: DUE });
    expect(summary.skippedReason).toMatch(/desativada/);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe("PENDING");
  });

  it("só processa lembretes vencidos", async () => {
    await scheduledReminder();
    const summary = await processReminderQueue(db, deps(new DevelopmentWhatsAppProvider()), { now: CLOCK.now });
    expect(summary.claimed).toBe(0);
  });

  it("no modo de desenvolvimento registra a mensagem como SIMULADA, sem fingir envio real", async () => {
    const { reminder, patient } = await scheduledReminder();
    const summary = await processReminderQueue(db, deps(new DevelopmentWhatsAppProvider()), { now: DUE });
    expect(summary).toMatchObject({ claimed: 1, simulated: 1, sent: 0 });

    const stored = await db.reminder.findUniqueOrThrow({ where: { id: reminder.id }, include: { message: true } });
    expect(stored).toMatchObject({ status: "SENT", simulated: true, attempts: 1, sentAt: DUE });
    expect(stored.message).toMatchObject({ status: "SIMULATED", provider: "development", type: "TEMPLATE" });
    // O texto fica cifrado no banco quando há chave; decifrado, traz a prévia do modelo.
    const keyring = getContentKeyring();
    const body = openText(stored.message!.body, messageContext(stored.message!.conversationId), keyring);
    if (keyring) expect(stored.message?.body).not.toContain("Joana");
    expect(body).toContain("Joana");
    expect(body).toContain("04/11 às 09:00");

    const conversation = await db.whatsAppConversation.findFirstOrThrow();
    expect(conversation.patientId).toBe(patient.id);
  });

  it("confere de novo antes de enviar: agendamento cancelado ou consentimento revogado", async () => {
    const { reminder, appointment } = await scheduledReminder();
    await db.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } });
    const summary = await processReminderQueue(db, deps(new FakeCloudProvider(), { appointmentReminder: "lembrete" }), { now: DUE });
    expect(summary.cancelled).toBe(1);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe("CANCELLED");
  });

  it("falha temporária: nova tentativa com espera crescente até esgotar", async () => {
    const { reminder } = await scheduledReminder();
    const provider = new FakeCloudProvider("retryable");
    const options = deps(provider, { appointmentReminder: "lembrete_agendamento" });

    await processReminderQueue(db, options, { now: DUE });
    let stored = await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(stored).toMatchObject({ status: "PENDING", attempts: 1, lastError: "Instabilidade na API." });
    expect(stored.nextAttemptAt?.getTime()).toBe(DUE.getTime() + retryDelayMs(1));

    // Antes do horário da nova tentativa, nada acontece.
    expect((await processReminderQueue(db, options, { now: new Date(DUE.getTime() + 60_000) })).claimed).toBe(0);

    let now = DUE;
    for (const attempt of [1, 2]) {
      now = new Date(now.getTime() + retryDelayMs(attempt) + 1000);
      await processReminderQueue(db, options, { now });
    }
    stored = await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(stored).toMatchObject({ status: "FAILED", attempts: 3, nextAttemptAt: null });
    expect(await db.whatsAppMessage.count({ where: { status: "FAILED" } })).toBe(3);
  });

  it("falha definitiva vai direto para FALHOU e pode ser reenfileirada pela equipe", async () => {
    const { reminder, team } = await scheduledReminder();
    await processReminderQueue(db, deps(new FakeCloudProvider("fatal"), { appointmentReminder: "lembrete" }), { now: DUE });
    expect(await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).toMatchObject({ status: "FAILED", attempts: 1 });

    await retryReminder(db, team.asReception, reminder.id, DUE);
    expect(await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).toMatchObject({ status: "PENDING", attempts: 0 });

    await cancelReminder(db, team.asReception, reminder.id, DUE);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe("CANCELLED");
    await expect(retryReminder(db, team.asReception, reminder.id, DUE)).rejects.toThrow(/com falha/);
  });

  it("na API oficial, sem modelo aprovado configurado, falha com mensagem clara", async () => {
    const { reminder } = await scheduledReminder();
    await processReminderQueue(db, deps(new FakeCloudProvider()), { now: DUE });
    const stored = await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(stored.status).toBe("FAILED");
    expect(stored.lastError).toMatch(/Nenhum modelo aprovado pela Meta/);
  });

  it("processadores simultâneos não enviam o mesmo lembrete duas vezes", async () => {
    const team = await createTeam(db);
    const procedure = await createTestProcedure(db);
    for (let index = 0; index < 8; index += 1) {
      const patient = await createTestPatient(db, { whatsappOptIn: true });
      await createAppointment(
        db,
        team.asReception,
        appointmentCreateSchema.parse({
          subject: "patient",
          patientId: patient.id,
          professionalId: team.professional.id,
          procedureId: procedure.id,
          date: "2026-11-04",
          startTime: `${String(8 + index).padStart(2, "0")}:00`,
          durationMinutes: 60,
        }),
        CLOCK,
      );
    }

    const provider = new FakeCloudProvider();
    const options = deps(provider, { appointmentReminder: "lembrete" });
    const later = new Date("2026-11-03T20:00:00-03:00");
    const summaries = await Promise.all([
      processReminderQueue(db, options, { now: later, limit: 5 }),
      processReminderQueue(db, options, { now: later, limit: 5 }),
      processReminderQueue(db, options, { now: later, limit: 5 }),
    ]);

    expect(summaries.reduce((total, summary) => total + summary.sent, 0)).toBe(8);
    expect(provider.sent).toHaveLength(8);
    expect(await db.reminder.count({ where: { status: "SENT" } })).toBe(8);
  });

  it("recupera lembretes presos em processamento (processo interrompido)", async () => {
    const { reminder } = await scheduledReminder();
    await db.reminder.update({ where: { id: reminder.id }, data: { status: "PROCESSING", lockedAt: new Date(DUE.getTime() - 60 * 60 * 1000) } });
    const summary = await processReminderQueue(db, deps(new DevelopmentWhatsAppProvider()), { now: DUE });
    expect(summary.simulated).toBe(1);
  });

  it("não cria lembrete sem consentimento", async () => {
    const { reminder } = await scheduledReminder(false);
    expect(reminder).toBeNull();
    expect(await db.reminder.count()).toBe(0);
  });
});
