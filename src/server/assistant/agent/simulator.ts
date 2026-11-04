import type { PortResult } from "../engine";
import { rankPassages } from "../knowledge-search";
import type { AppointmentOption, StoredSlot } from "../state";
import { normalizeText } from "../text";
import type { KnowledgePassage } from "../types";

import type { AgentPorts, ReturnResponse, ServiceInfo } from "./tools";

/**
 * CRM simulado em memória (sem banco, sem rede) com as mesmas portas que o
 * serviço real oferece à IA. Usado nos testes e na avaliação com o modelo
 * real (`npm run assistant:eval`) — nenhuma mensagem é enviada a ninguém.
 */

export interface SimulatorFixture {
  contactKind?: "patient" | "lead" | "unknown";
  knowledge?: KnowledgePassage[];
  services?: ServiceInfo[];
  /** Horários livres devolvidos por `findSlots`; vazio = sem disponibilidade; null = agendamento desativado. */
  slots?: StoredSlot[] | null;
  bookableProcedure?: string | null;
  appointments?: AppointmentOption[];
  /** Horários que "acabaram de ser ocupados" (agendar neles devolve conflito). */
  takenSlots?: string[];
  /** Falha inesperada ao agendar (ex.: banco indisponível). */
  failBooking?: boolean;
  duplicates?: number;
}

export class InMemoryCrm implements AgentPorts {
  contactKind: "patient" | "lead" | "unknown";
  readonly knowledge: KnowledgePassage[];
  readonly services: ServiceInfo[];
  slots: StoredSlot[] | null;
  readonly bookableProcedure: string | null;
  appointments: AppointmentOption[];
  readonly takenSlots: Set<string>;
  readonly failBooking: boolean;
  readonly duplicates: number;

  lead: { name: string; interest: string | null; procedureId: string | null } | null = null;
  readonly leadNotes: string[] = [];
  readonly opportunities: Array<{ nextStep: string; interest: string | null; summary: string }> = [];
  readonly bookings: Array<{ slot: StoredSlot; returnId: string | null }> = [];
  readonly reschedules: Array<{ appointmentId: string; slot: StoredSlot }> = [];
  readonly cancellations: string[] = [];
  readonly confirmations: string[] = [];
  readonly handoffs: Array<{ reason: string; urgent: boolean; summary?: string | null }> = [];
  readonly tasks: Array<{ title: string; details: string; urgent: boolean; dedupeKey: string }> = [];
  readonly gaps: Array<{ reason: "NO_ANSWER" | "BLOCKED_ANSWER"; question: string }> = [];
  readonly returnResponses: Array<{ returnId: string; response: ReturnResponse }> = [];
  optedOut = false;
  optedIn = false;
  remindersConsent = false;

  constructor(fixture: SimulatorFixture = {}) {
    this.contactKind = fixture.contactKind ?? "unknown";
    this.knowledge = fixture.knowledge ?? [];
    this.services = fixture.services ?? [];
    this.slots = fixture.slots === undefined ? [] : fixture.slots;
    this.bookableProcedure = fixture.bookableProcedure ?? (fixture.slots === null ? null : "Avaliação");
    this.appointments = [...(fixture.appointments ?? [])];
    this.takenSlots = new Set(fixture.takenSlots ?? []);
    this.failBooking = fixture.failBooking ?? false;
    this.duplicates = fixture.duplicates ?? 0;
  }

  async searchKnowledge(text: string): Promise<KnowledgePassage[]> {
    return rankPassages(text, this.knowledge).map((item) => item.passage);
  }

  async matchProcedure(text: string) {
    const message = normalizeText(text);
    const match = this.services.find((service) => message.includes(normalizeText(service.name)));
    return match ? { id: `00000000-0000-7000-8000-${String(this.services.indexOf(match) + 1).padStart(12, "0")}`, name: match.name } : null;
  }

  async findSlots(request: { reschedule?: AppointmentOption }) {
    if (this.slots === null) return null;
    const slots = this.slots.map((slot) => ({ ...slot, forAppointmentId: request.reschedule?.id ?? null }));
    return { slots, matchedPreference: true, procedureName: this.bookableProcedure ?? "Avaliação" };
  }

  async ensureLead(data: { name: string; interest: string | null; procedureId: string | null }) {
    if (this.contactKind === "patient") return false;
    this.lead = this.lead
      ? { ...this.lead, interest: this.lead.interest ?? data.interest, procedureId: this.lead.procedureId ?? data.procedureId }
      : { ...data };
    this.contactKind = "lead";
    return true;
  }

  async book(slot: StoredSlot, options?: { returnId?: string | null }): Promise<PortResult> {
    if (this.failBooking) return { ok: false, reason: "error" };
    if (this.takenSlots.has(slot.startsAt)) return { ok: false, reason: "conflict" };
    this.takenSlots.add(slot.startsAt);
    this.bookings.push({ slot, returnId: options?.returnId ?? null });
    return { ok: true };
  }

  async listUpcomingAppointments() {
    return this.appointments;
  }

  async reschedule(appointmentId: string, slot: StoredSlot): Promise<PortResult> {
    if (!this.appointments.some((item) => item.id === appointmentId)) return { ok: false, reason: "error" };
    this.reschedules.push({ appointmentId, slot });
    return { ok: true };
  }

  async cancelAppointment(appointmentId: string): Promise<PortResult> {
    if (!this.appointments.some((item) => item.id === appointmentId)) return { ok: false, reason: "error" };
    this.cancellations.push(appointmentId);
    this.appointments = this.appointments.filter((item) => item.id !== appointmentId);
    return { ok: true };
  }

  async optOut() {
    this.optedOut = true;
  }

  async optIn() {
    this.optedIn = true;
  }

  async grantRemindersConsent() {
    this.remindersConsent = true;
  }

  async handoff(reason: string, options: { urgent: boolean; summary?: string | null }) {
    this.handoffs.push({ reason, urgent: options.urgent, ...(options.summary ? { summary: options.summary } : {}) });
  }

  async registerQualifiedLead(summary: { nextStep: "schedule" | "contact"; interest: string | null }) {
    this.opportunities.push({ nextStep: summary.nextStep, interest: summary.interest, summary: "" });
  }

  async recordGap(reason: "NO_ANSWER" | "BLOCKED_ANSWER", question: string) {
    this.gaps.push({ reason, question });
  }

  async listServices() {
    return { services: this.services, bookableProcedure: this.bookableProcedure };
  }

  async confirmAttendance(appointmentId: string): Promise<PortResult> {
    if (!this.appointments.some((item) => item.id === appointmentId)) return { ok: false, reason: "error" };
    this.confirmations.push(appointmentId);
    return { ok: true };
  }

  async addLeadNote(note: string) {
    if (!this.lead) return false;
    this.leadNotes.push(note);
    return true;
  }

  async registerOpportunity(input: { nextStep: "schedule" | "team_contact" | "thinking"; interest: string | null; summary: string }) {
    if (!this.lead) return false;
    this.opportunities.push(input);
    return true;
  }

  async createStaffTask(input: { title: string; details: string; urgent: boolean; dedupeKey: string }) {
    if (this.tasks.some((task) => task.dedupeKey === input.dedupeKey)) return false;
    this.tasks.push(input);
    return true;
  }

  async recordReturnResponse(returnId: string, response: ReturnResponse) {
    this.returnResponses.push({ returnId, response });
  }

  async countPossibleDuplicates() {
    return this.duplicates;
  }
}
