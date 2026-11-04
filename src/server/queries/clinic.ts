import "server-only";

import { connection } from "next/server";

import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission, requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { getAssistantConfig, getAssistantSettingsMeta } from "@/server/services/assistant-settings";

/**
 * Clínica ativa (espaço de trabalho) para a interface. Nesta etapa o Clinni
 * ainda atende uma clínica por instalação: o nome vem do cadastro existente
 * (Assistente › Configurações › Nome da clínica). Com o modelo multi-clínica,
 * esta consulta passa a devolver as clínicas às quais o usuário tem acesso.
 */
export interface ClinicWorkspace {
  id: string;
  name: string;
  /** A configuração da clínica já foi salva ao menos uma vez (fora isso, valem os padrões). */
  configured: boolean;
}

export interface ClinicSetupStep {
  key: "profile" | "procedures" | "team" | "knowledge";
  done: boolean;
}

/**
 * Configuração inicial da clínica (onboarding), calculada só a partir de dados
 * reais — nada é marcado como concluído sem estar no banco. Só para quem
 * configura a clínica.
 */
export async function getClinicSetupSteps(): Promise<ClinicSetupStep[]> {
  await requirePermission("assistant:configure");
  const db = getDb();
  const [meta, procedures, team, knowledge] = await Promise.all([
    getAssistantSettingsMeta(db),
    db.procedure.count({ where: { isActive: true } }),
    db.user.count({ where: { isActive: true, role: { not: "ASSISTANT" } } }),
    db.knowledgeEntry.count({ where: { isArchived: false, publishedVersionId: { not: null } } }),
  ]);
  return [
    { key: "profile", done: Boolean(meta) },
    { key: "procedures", done: procedures > 0 },
    { key: "team", done: team > 1 },
    { key: "knowledge", done: knowledge > 0 },
  ];
}

/**
 * Nome público da clínica para a tela de login (sem sessão). Só aparece depois
 * que a clínica salvou a própria configuração — nunca um nome padrão do sistema.
 */
export async function getPublicClinicName(): Promise<string | null> {
  // Dado da requisição (nunca do build): sem isso o prerender tentaria ler o banco.
  await connection();
  const db = getDb();
  const meta = await getAssistantSettingsMeta(db);
  if (!meta) return null;
  return (await getAssistantConfig(db)).clinicName;
}

export async function getClinicWorkspaces(): Promise<{ active: ClinicWorkspace; all: ClinicWorkspace[]; canConfigure: boolean }> {
  const user = await requireUser({ allowPendingPasswordChange: true });
  const db = getDb();
  const [config, meta] = await Promise.all([getAssistantConfig(db), getAssistantSettingsMeta(db)]);
  const active: ClinicWorkspace = { id: "default", name: config.clinicName, configured: Boolean(meta) };
  return { active, all: [active], canConfigure: hasPermission(user.role, "assistant:configure") };
}
