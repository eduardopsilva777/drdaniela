"use client";

import { Archive, ArchiveRestore, FlaskConical, History, ShieldAlert } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { fieldAria, FormField } from "@/components/forms/form-field";
import { FormSelect, type SelectOption } from "@/components/forms/form-select";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeCategory, KnowledgeVersionStatus } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import {
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_VERSION_STATUS_LABELS,
  KNOWLEDGE_VERSION_STATUS_TONES,
} from "@/lib/labels";
import {
  approveKnowledgeVersionAction,
  dismissKnowledgeGapAction,
  getKnowledgeHistoryAction,
  rejectKnowledgeVersionAction,
  saveKnowledgeEntryAction,
  setKnowledgeArchivedAction,
  submitKnowledgeVersionAction,
  testKnowledgeQuestionAction,
} from "@/server/actions/assistant";
import type { KnowledgeTestResult } from "@/server/services/knowledge-test";

const CATEGORY_OPTIONS: SelectOption[] = (Object.keys(KNOWLEDGE_CATEGORY_LABELS) as KnowledgeCategory[]).map((value) => ({
  value,
  label: KNOWLEDGE_CATEGORY_LABELS[value],
}));

export interface KnowledgeEntryValues {
  id: string;
  category: KnowledgeCategory;
  procedureId: string | null;
  title: string;
  content: string;
  keywords: string;
}

/**
 * Nova entrada ou nova versão de uma entrada. O conteúdo só chega aos contatos
 * depois de aprovado por profissional ou administração.
 */
export function KnowledgeEntryDialog({
  entry,
  gap,
  procedures,
  trigger,
}: {
  entry?: KnowledgeEntryValues;
  gap?: { id: string; question: string };
  procedures: SelectOption[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const action = saveKnowledgeEntryAction.bind(null, entry?.id ?? null);
  const { run, pending, fieldErrors, reset } = useAction(action, { onSuccess: () => setOpen(false) });
  useResetOnHide(() => setOpen(false));
  const error = (field: string) => firstFieldError(fieldErrors, field);
  const prefix = entry ? `knowledge-${entry.id}` : gap ? `knowledge-gap-${gap.id}` : "knowledge-new";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? "Nova versão da resposta" : "Nova resposta aprovada"}</DialogTitle>
          <DialogDescription>
            Escreva exatamente o que o assistente pode informar. Sem orientação clínica individual: dúvidas de saúde vão
            sempre para a equipe. A versão em uso continua valendo até a nova ser aprovada.
          </DialogDescription>
        </DialogHeader>
        {gap ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Pergunta recebida: <span className="text-foreground">{gap.question}</span>
          </p>
        ) : null}
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
        >
          {gap ? <input type="hidden" name="gapId" value={gap.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Categoria" htmlFor={`${prefix}-category`} error={error("category")}>
              <FormSelect
                id={`${prefix}-category`}
                name="category"
                defaultValue={entry?.category ?? "FAQ"}
                options={CATEGORY_OPTIONS}
                invalid={Boolean(error("category"))}
              />
            </FormField>
            <FormField label="Procedimento relacionado" htmlFor={`${prefix}-procedure`} optional error={error("procedureId")}>
              <FormSelect
                id={`${prefix}-procedure`}
                name="procedureId"
                defaultValue={entry?.procedureId ?? ""}
                options={procedures}
                placeholder="Nenhum"
                emptyLabel="Nenhum"
              />
            </FormField>
          </div>
          <FormField
            label="Pergunta ou tema"
            htmlFor={`${prefix}-title`}
            error={error("title")}
            description="Como o contato costuma perguntar. Ex.: “Quanto custa a avaliação?”"
          >
            <Input
              {...fieldAria(`${prefix}-title`, error("title"), true)}
              name="title"
              maxLength={160}
              defaultValue={entry?.title ?? gap?.question.slice(0, 160) ?? ""}
            />
          </FormField>
          <FormField label="Resposta aprovada" htmlFor={`${prefix}-content`} error={error("content")}>
            <Textarea
              {...fieldAria(`${prefix}-content`, error("content"))}
              name="content"
              rows={5}
              maxLength={2000}
              defaultValue={entry?.content ?? ""}
            />
          </FormField>
          <FormField
            label="Palavras-chave e sinônimos"
            htmlFor={`${prefix}-keywords`}
            optional
            error={error("keywords")}
            description="Separadas por vírgula. Ajudam o assistente a encontrar esta resposta (ex.: valor, preço, quanto custa)."
          >
            <Input {...fieldAria(`${prefix}-keywords`, error("keywords"), true)} name="keywords" maxLength={300} defaultValue={entry?.keywords ?? ""} />
          </FormField>
          {entry ? (
            <FormField label="Motivo da alteração" htmlFor={`${prefix}-note`} optional error={error("changeNote")}>
              <Input {...fieldAria(`${prefix}-note`, error("changeNote"))} name="changeNote" maxLength={200} placeholder="Ex.: novo valor a partir de dezembro" />
            </FormField>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox name="submit" defaultChecked />
            Enviar para aprovação agora
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface VersionItem {
  id: string;
  version: number;
  title: string;
  content: string;
  keywords: string;
  status: KnowledgeVersionStatus;
  changeNote: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  author: { name: string };
  reviewedBy: { name: string } | null;
}

const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

function VersionReview({ version, canApprove, canWrite, onDone }: { version: VersionItem; canApprove: boolean; canWrite: boolean; onDone: () => void }) {
  const [note, setNote] = useState("");
  const approve = useAction(approveKnowledgeVersionAction, { onSuccess: onDone });
  const reject = useAction(rejectKnowledgeVersionAction, { onSuccess: onDone });
  const submit = useAction(submitKnowledgeVersionAction, { onSuccess: onDone });
  const pending = approve.pending || reject.pending || submit.pending;
  const form = () => {
    const data = new FormData();
    data.set("note", note);
    return data;
  };
  if (version.status !== "DRAFT" && version.status !== "IN_REVIEW") return null;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
      {canApprove ? (
        <>
          <label htmlFor={`review-${version.id}`} className="text-xs text-muted-foreground">
            Observação da revisão (obrigatória para recusar)
          </label>
          <Input id={`review-${version.id}`} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => approve.run(version.id, form())}>
              Aprovar e publicar
            </Button>
            <Button size="sm" variant="outline" disabled={pending || note.trim().length < 3} onClick={() => reject.run(version.id, form())}>
              Recusar
            </Button>
          </>
        ) : null}
        {canWrite && version.status === "DRAFT" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => submit.run(version.id)}>
            Enviar para aprovação
          </Button>
        ) : null}
      </div>
      {!canApprove ? <p className="text-xs text-muted-foreground">A aprovação é feita pela profissional ou pela administração.</p> : null}
    </div>
  );
}

/** Histórico de versões: autor, data, motivo, revisão — e aprovação das pendentes. */
export function KnowledgeHistoryDialog({
  entryId,
  title,
  canApprove,
  canWrite,
}: {
  entryId: string;
  title: string;
  canApprove: boolean;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionItem[] | null>(null);
  const [loading, startLoading] = useTransition();
  useResetOnHide(() => setOpen(false));

  function load() {
    startLoading(async () => {
      const result = await getKnowledgeHistoryAction(entryId).catch(() => null);
      if (!result || !result.ok) {
        toast.error(result && !result.ok ? result.error : "Falha de conexão. Tente de novo.");
        return;
      }
      setVersions(result.data as VersionItem[]);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History aria-hidden />
          Versões
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Versões — {title}</DialogTitle>
          <DialogDescription>Cada alteração fica registrada com autor, data e revisão. O assistente usa só a versão aprovada mais recente.</DialogDescription>
        </DialogHeader>
        {loading && !versions ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        <ol className="space-y-3">
          {(versions ?? []).map((version) => (
            <li key={version.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">Versão {version.version}</p>
                <StatusBadge tone={KNOWLEDGE_VERSION_STATUS_TONES[version.status]} label={KNOWLEDGE_VERSION_STATUS_LABELS[version.status]} />
              </div>
              <p className="mt-2 text-sm text-foreground">{version.title}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-foreground/85">{version.content}</p>
              {version.keywords ? <p className="mt-1 text-xs text-muted-foreground">Palavras-chave: {version.keywords}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {version.author.name} · {DATE.format(new Date(version.createdAt))}
                {version.changeNote ? ` · motivo: ${version.changeNote}` : ""}
              </p>
              {version.reviewedBy && version.reviewedAt ? (
                <p className="text-xs text-muted-foreground">
                  Revisada por {version.reviewedBy.name} em {DATE.format(new Date(version.reviewedAt))}
                  {version.reviewNote ? ` — ${version.reviewNote}` : ""}
                </p>
              ) : null}
              <VersionReview version={version} canApprove={canApprove} canWrite={canWrite} onDone={() => load()} />
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveEntryButton({ entryId, archived, title }: { entryId: string; archived: boolean; title: string }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction(setKnowledgeArchivedAction, { onSuccess: () => setOpen(false) });
  if (archived) {
    return (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(entryId, false)}>
        <ArchiveRestore aria-hidden />
        Restaurar
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Archive aria-hidden />
        Arquivar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Arquivar “${title}”?`}
        description="O assistente deixa de usar esta resposta imediatamente. O histórico de versões é mantido e a entrada pode ser restaurada."
        confirmLabel="Arquivar"
        pending={pending}
        onConfirm={() => run(entryId, true)}
      />
    </>
  );
}

export function DismissGapButton({ gapId }: { gapId: string }) {
  const { run, pending } = useAction(dismissKnowledgeGapAction);
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(gapId)}>
      Descartar
    </Button>
  );
}

const GUARD_REASONS: Record<string, string> = {
  price: "citou valor que não está na resposta aprovada",
  percentage: "citou percentual sem fonte",
  contact: "citou telefone/número sem fonte",
  link: "citou link ou e-mail sem fonte",
  identity: "tentou se apresentar como a profissional",
  no_sources: "não indicou a fonte",
  too_long: "resposta longa demais",
  empty: "resposta vazia",
  markdown: "usou formatação que o WhatsApp não exibe",
  false_completion: "deu como feita uma ação que o sistema não concluiu",
  guarantee: "prometeu resultado",
  repetition: "repetiu a mensagem anterior",
};

/** Teste de perguntas antes de publicar: mesmo motor e mesma checagem do atendimento, sem enviar nada. */
export function KnowledgeTestPanel() {
  const [result, setResult] = useState<KnowledgeTestResult | null>(null);
  const { run, pending } = useAction(testKnowledgeQuestionAction, { successMessage: false, onSuccess: setResult });
  return (
    <div className="space-y-4">
      <form
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          run(new FormData(event.currentTarget));
        }}
      >
        <FormField label="Pergunta de teste" htmlFor="knowledge-test-question" description="Escreva como um contato escreveria. Não use dados de pacientes.">
          <Textarea id="knowledge-test-question" name="question" rows={2} maxLength={500} placeholder="Ex.: quanto custa a avaliação?" />
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox name="includeDrafts" />
            Incluir rascunhos e versões em revisão
          </label>
          <Button type="submit" variant="outline" disabled={pending}>
            <FlaskConical aria-hidden />
            {pending ? "Testando…" : "Testar"}
          </Button>
        </div>
      </form>
      {result ? (
        <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4 text-sm" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            Motor: {result.engine} · intenção: {result.intent} · {result.considered} entrada(s) consultada(s)
          </p>
          {result.clinical || result.urgent || result.wantsHuman ? (
            <p className="flex items-center gap-2 text-warning">
              <ShieldAlert aria-hidden className="size-4" />
              {result.urgent
                ? "Possível urgência: o assistente orienta procurar atendimento e chama a equipe com prioridade."
                : result.clinical
                  ? "Pergunta de saúde: o assistente não orienta e encaminha para a equipe."
                  : "Pedido de atendimento humano: o assistente encaminha para a equipe."}
            </p>
          ) : null}
          {result.answer ? (
            <>
              <p className="whitespace-pre-line text-foreground">{result.answer}</p>
              <p className="text-xs text-muted-foreground">
                Fontes: {result.sources.length ? result.sources.map((source) => source.title).join("; ") : "nenhuma entrada da base citada"}
              </p>
            </>
          ) : !result.clinical && !result.urgent && !result.wantsHuman ? (
            <p className="text-foreground/85">
              Sem resposta aprovada: o assistente diria que não sabe e ofereceria a equipe.
              {result.blockedReason ? ` (Resposta bloqueada na checagem: ${GUARD_REASONS[result.blockedReason] ?? result.blockedReason}.)` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
