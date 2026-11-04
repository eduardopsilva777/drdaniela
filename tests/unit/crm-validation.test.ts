import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { appointmentCreateSchema, appointmentStatusSchema, agendaFiltersSchema } from "@/lib/validation/appointments";
import { applyProtocolSchema, protocolInputSchema, returnFiltersSchema } from "@/lib/validation/care";
import { formDataToObject } from "@/lib/validation/common";
import { interactionInputSchema, leadFiltersSchema, leadInputSchema, leadStatusChangeSchema } from "@/lib/validation/leads";
import { patientInputSchema } from "@/lib/validation/patients";
import { procedureInputSchema } from "@/lib/validation/procedures";
import { messageContext, openMessageBodies, sealText, UNREADABLE_TEXT } from "@/server/crypto/content-cipher";
import { decryptField, encryptField, parseEncryptionKey } from "@/server/crypto/field-encryption";
import { parseServerEnv, productionConfigWarnings } from "@/server/env";

const UUID = "0192f0c5-5a8e-7c4e-9a8e-3f1d2b3c4d5e";

describe("validação de leads", () => {
  it("normaliza telefone e e-mail e trata campos vazios do formulário", () => {
    const parsed = leadInputSchema.parse({
      name: "  Maria  ",
      phone: "(11) 98765-4321",
      email: "MARIA@Exemplo.COM",
      source: "INSTAGRAM",
      procedureId: "",
      priority: "",
      whatsappOptIn: "on",
    });
    expect(parsed).toMatchObject({
      name: "Maria",
      phone: "+5511987654321",
      email: "maria@exemplo.com",
      procedureId: undefined,
      priority: "MEDIUM",
      whatsappOptIn: true,
    });
  });

  it("exige a data quando há próxima ação descrita e motivo ao perder", () => {
    const result = leadInputSchema.safeParse({ name: "Maria", phone: "11987654321", source: "OTHER", nextActionNote: "Ligar" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["nextActionDate"]);

    expect(leadStatusChangeSchema.safeParse({ leadId: UUID, status: "LOST" }).success).toBe(false);
    expect(leadStatusChangeSchema.safeParse({ leadId: UUID, status: "LOST", lostReason: "Preço" }).success).toBe(true);
  });

  it("aceita apenas tipos de interação manuais", () => {
    expect(interactionInputSchema.safeParse({ type: "STATUS_CHANGE", content: "x x" }).success).toBe(false);
    expect(interactionInputSchema.safeParse({ type: "CALL", content: "Ligação feita" }).success).toBe(true);
  });

  it("filtros da URL inválidos voltam ao padrão em vez de quebrar a página", () => {
    expect(leadFiltersSchema.parse({ origem: "TIKTOK", pagina: "-3", ordem: "x", visao: ["lista"] })).toMatchObject({
      origem: undefined,
      pagina: 1,
      ordem: "recentes",
      visao: "lista",
    });
  });
});

describe("validação de pacientes, procedimentos e protocolos", () => {
  it("pacientes: data de nascimento válida e consentimentos explícitos", () => {
    expect(patientInputSchema.safeParse({ fullName: "Joana", phone: "11987654321", birthDate: "2026-02-30" }).success).toBe(false);
    const parsed = patientInputSchema.parse({ fullName: "Joana", phone: "11987654321" });
    expect(parsed).toMatchObject({ whatsappOptIn: false, marketingOptIn: false, imageUseConsent: false });
  });

  it("procedimentos: preço em reais vira centavos; intervalo de retorno opcional", () => {
    const parsed = procedureInputSchema.parse({ name: "Toxina", durationMinutes: "45", price: "1.250,00", suggestedReturnDays: "" });
    expect(parsed).toMatchObject({ durationMinutes: 45, price: 125000, suggestedReturnDays: undefined });
    expect(procedureInputSchema.safeParse({ name: "Toxina", durationMinutes: "2", price: "" }).success).toBe(false);
    expect(procedureInputSchema.safeParse({ name: "Toxina", durationMinutes: "60", color: "red" }).success).toBe(false);
  });

  it("protocolos: ao menos uma etapa e intervalos positivos", () => {
    expect(protocolInputSchema.safeParse({ name: "P", procedureId: UUID, steps: [] }).success).toBe(false);
    expect(
      protocolInputSchema.safeParse({
        name: "Protocolo",
        procedureId: UUID,
        steps: [{ label: "Revisão", kind: "REVIEW", offsetDays: 0, relativeTo: "START" }],
      }).success,
    ).toBe(false);
    expect(applyProtocolSchema.safeParse({ protocolId: UUID, startDate: "2026-11-02" }).success).toBe(true);
    expect(returnFiltersSchema.parse({ aba: "x", situacao: "atrasados" })).toMatchObject({ aba: "retornos", situacao: "atrasados" });
  });
});

describe("formulários", () => {
  it("ignora chaves que alterariam o protótipo do objeto", () => {
    const data = new FormData();
    data.set("name", "Maria");
    data.set("__proto__", new File(["x"], "injetado"));
    data.set("constructor", "x");
    const object = formDataToObject(data);
    expect(Object.getPrototypeOf(object)).toBe(Object.prototype);
    expect(Object.keys(object)).toEqual(["name"]);
  });
});

describe("validação da agenda", () => {
  it("exige paciente ou lead conforme o tipo e motivo para cancelar", () => {
    const base = { professionalId: UUID, date: "2026-11-04", startTime: "09:00", durationMinutes: "60" };
    expect(appointmentCreateSchema.safeParse({ ...base, subject: "patient" }).success).toBe(false);
    expect(appointmentCreateSchema.safeParse({ ...base, subject: "patient", patientId: UUID }).success).toBe(true);
    expect(appointmentCreateSchema.safeParse({ ...base, subject: "lead", patientId: UUID }).success).toBe(false);
    expect(appointmentCreateSchema.safeParse({ ...base, subject: "patient", patientId: UUID, startTime: "25:00" }).success).toBe(false);

    expect(appointmentStatusSchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
    expect(appointmentStatusSchema.safeParse({ status: "CANCELLED", reason: "Imprevisto" }).success).toBe(true);
  });

  it("filtros da agenda: visão padrão semanal e data inválida descartada", () => {
    expect(agendaFiltersSchema.parse({ data: "2026-13-01", visao: "ano" })).toEqual({
      data: undefined,
      visao: "semana",
      profissional: undefined,
      status: undefined,
    });
  });
});

describe("cifragem de campos (AES-256-GCM)", () => {
  const key = randomBytes(32);

  it("cifra com IV aleatório e decifra apenas no mesmo contexto", () => {
    const first = encryptField("observação", key, "patient_note:1");
    const second = encryptField("observação", key, "patient_note:1");
    expect(first).not.toBe(second);
    expect(first.startsWith("v1:")).toBe(true);
    expect(decryptField(first, key, "patient_note:1")).toBe("observação");
    expect(() => decryptField(first, key, "patient_note:2")).toThrow();
  });

  it("detecta adulteração e chave incorreta", () => {
    const payload = encryptField("texto", key, "ctx");
    const parts = payload.split(":");
    const tampered = [...parts.slice(0, 3), Buffer.from("outro").toString("base64url")].join(":");
    expect(() => decryptField(tampered, key, "ctx")).toThrow();
    expect(() => decryptField(payload, randomBytes(32), "ctx")).toThrow();
    expect(() => decryptField("v0:a:b:c", key, "ctx")).toThrow(/formato/);
  });

  it("valida a chave configurada", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/não configurada/);
    expect(() => parseEncryptionKey(Buffer.from("curta").toString("base64"))).toThrow(/32 bytes/);
    expect(parseEncryptionKey(key.toString("base64"))).toHaveLength(32);
  });

  it("decifra os textos das mensagens de uma conversa para exibição (cifrados, antigos sem cifragem e apagados)", () => {
    const keyring = { current: key, previous: [] };
    const conversationId = "0192f0c5-5a8e-7c4e-9a8e-3f1d2b3c4d5e";
    const messages = [
      { id: "a", body: sealText("Oi, tudo bem?", messageContext(conversationId), keyring) },
      { id: "b", body: "Gravada antes da chave" },
      { id: "c", body: null },
      // Copiada de outra conversa: o contexto autenticado recusa.
      { id: "d", body: sealText("De outra conversa", messageContext("outra"), keyring) },
    ];
    expect(openMessageBodies(conversationId, messages, keyring)).toEqual([
      { id: "a", body: "Oi, tudo bem?" },
      { id: "b", body: "Gravada antes da chave" },
      { id: "c", body: null },
      { id: "d", body: UNREADABLE_TEXT },
    ]);
    // Sem chave, nada cifrado vaza para a tela.
    expect(openMessageBodies(conversationId, messages, null).map((message) => message.body)).toEqual([
      UNREADABLE_TEXT,
      "Gravada antes da chave",
      null,
      UNREADABLE_TEXT,
    ]);
  });
});

describe("variáveis de ambiente do WhatsApp e da proteção de dados", () => {
  const BASE = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };

  it("padrão seguro: simulação fora de produção, desativado em produção", () => {
    expect(parseServerEnv({ ...BASE, NODE_ENV: "development" }).WHATSAPP_PROVIDER).toBe("development");
    expect(parseServerEnv({ ...BASE, NODE_ENV: "production" }).WHATSAPP_PROVIDER).toBe("disabled");
  });

  it("não permite o adaptador de desenvolvimento em produção", () => {
    expect(() => parseServerEnv({ ...BASE, NODE_ENV: "production", WHATSAPP_PROVIDER: "development" })).toThrow(/WHATSAPP_PROVIDER/);
  });

  it("a API oficial exige as credenciais, sem exibir valores no erro", () => {
    const attempt = () => parseServerEnv({ ...BASE, WHATSAPP_PROVIDER: "cloud_api", WHATSAPP_ACCESS_TOKEN: "segredo-que-nao-pode-vazar" });
    expect(attempt).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
    expect(attempt).toThrow(/WHATSAPP_APP_SECRET/);
    try {
      attempt();
    } catch (error) {
      expect((error as Error).message).not.toContain("segredo-que-nao-pode-vazar");
    }
  });

  it("rotação: a chave anterior exige a atual e precisa ser diferente dela", () => {
    const key = randomBytes(32).toString("base64");
    expect(() => parseServerEnv({ ...BASE, DATA_ENCRYPTION_KEY_PREVIOUS: key })).toThrow(/DATA_ENCRYPTION_KEY/);
    expect(() => parseServerEnv({ ...BASE, DATA_ENCRYPTION_KEY: key, DATA_ENCRYPTION_KEY_PREVIOUS: key })).toThrow(
      /DATA_ENCRYPTION_KEY_PREVIOUS/,
    );
    const env = parseServerEnv({ ...BASE, DATA_ENCRYPTION_KEY: key, DATA_ENCRYPTION_KEY_PREVIOUS: randomBytes(32).toString("base64") });
    expect(env.DATA_ENCRYPTION_KEY_PREVIOUS).toBeDefined();
  });

  it("avisa em produção sobre configurações que desativam proteções (só nomes)", () => {
    const secret = "segredo-que-nao-pode-aparecer-em-aviso-algum";
    const weak = productionConfigWarnings(parseServerEnv({ ...BASE, NODE_ENV: "production", APP_URL: "http://crm.local", CRON_SECRET: "" }));
    expect(weak.join(" ")).toMatch(/APP_URL/);
    expect(weak.join(" ")).toMatch(/DATA_ENCRYPTION_KEY/);
    expect(weak.join(" ")).toMatch(/CRON_SECRET/);

    const ok = productionConfigWarnings(
      parseServerEnv({
        ...BASE,
        NODE_ENV: "production",
        APP_URL: "https://crm.clinica.com.br",
        DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        CRON_SECRET: `${secret}-0123456789`,
      }),
    );
    expect(ok).toEqual([]);
    expect(productionConfigWarnings(parseServerEnv({ ...BASE, NODE_ENV: "development" }))).toEqual([]);
  });

  it("valida a chave de cifragem e os segredos mínimos", () => {
    expect(() => parseServerEnv({ ...BASE, DATA_ENCRYPTION_KEY: "curta" })).toThrow(/DATA_ENCRYPTION_KEY/);
    expect(parseServerEnv({ ...BASE, DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64") }).DATA_ENCRYPTION_KEY).toBeDefined();
    expect(() => parseServerEnv({ ...BASE, CRON_SECRET: "123" })).toThrow(/CRON_SECRET/);
    expect(parseServerEnv({ ...BASE, CRON_SECRET: "" }).CRON_SECRET).toBeUndefined();
  });
});
