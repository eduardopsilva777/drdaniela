"use client";

import { Bot, Eraser, MessageSquarePlus, RefreshCw, SendHorizontal, ThumbsDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { SubjectPicker, type SubjectOption } from "@/components/agenda/subject-picker";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { cn } from "@/lib/utils";
import {
  eraseConversationAction,
  reportAssistantReplyAction,
  setConversationModeAction,
} from "@/server/actions/assistant";
import {
  markConversationReadAction,
  openConversationAction,
  sendMessageAction,
  simulateInboundAction,
} from "@/server/actions/messaging";

/** Composição de mensagem. Desabilitada (com o motivo) fora da janela de 24h. */
export function MessageComposer({
  conversationId,
  disabledReason,
  simulated,
}: {
  conversationId: string;
  disabledReason: string | null;
  simulated: boolean;
}) {
  const [body, setBody] = useState("");
  const { run, pending, fieldErrors } = useAction((text: string) => sendMessageAction(conversationId, text), {
    successMessage: false,
    onSuccess: ({ simulated: wasSimulated }) => {
      setBody("");
      if (wasSimulated) toast.info("Mensagem registrada como SIMULADA: nada foi enviado ao contato.");
      else toast.success("Mensagem enviada.");
    },
  });

  if (disabledReason) {
    return <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{disabledReason}</p>;
  }

  return (
    <form
      noValidate
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) run(body);
      }}
    >
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Mensagem"
          placeholder={simulated ? "Mensagem (será apenas simulada)" : "Escreva uma mensagem"}
          value={body}
          rows={2}
          maxLength={4096}
          className="min-h-11 resize-none"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (body.trim() && !pending) run(body);
            }
          }}
        />
        <Button type="submit" size="icon-lg" disabled={pending || !body.trim()} aria-label="Enviar mensagem">
          <SendHorizontal aria-hidden />
        </Button>
      </div>
      {fieldErrors ? <p className="text-xs text-brick">Revise a mensagem.</p> : null}
      <p className="text-xs text-muted-foreground">
        Enter envia · Shift+Enter quebra a linha. Ao responder, a equipe assume a conversa e o assistente para. Não envie
        informações clínicas.
      </p>
    </form>
  );
}

/** Apenas em desenvolvimento: simula uma mensagem recebida do contato (abre a janela de 24h). */
export function SimulateInbound({ conversationId }: { conversationId: string }) {
  const [body, setBody] = useState("");
  const { run, pending } = useAction((text: string) => simulateInboundAction(conversationId, text), {
    onSuccess: () => setBody(""),
  });

  return (
    <form
      noValidate
      className="flex items-center gap-2 rounded-xl border border-dashed border-lavender/40 bg-lavender/[0.05] p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) run(body);
      }}
    >
      <Input
        aria-label="Simular mensagem recebida"
        placeholder="Simular mensagem recebida do contato (desenvolvimento)"
        value={body}
        maxLength={4096}
        onChange={(event) => setBody(event.target.value)}
        className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <Button type="submit" variant="ghost" size="sm" disabled={pending || !body.trim()}>
        Simular
      </Button>
    </form>
  );
}

/** Zera o contador de não lidas ao abrir a conversa. */
export function MarkConversationRead({ conversationId, unread }: { conversationId: string; unread: number }) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (unread === 0 || done.current === conversationId) return;
    done.current = conversationId;
    void markConversationReadAction(conversationId).catch(() => undefined);
  }, [conversationId, unread]);
  return null;
}

/** Atualiza a conversa sob demanda (sem consulta automática, para não manter sessões ociosas ativas). */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      aria-label="Atualizar mensagens"
    >
      <RefreshCw aria-hidden className={cn(pending && "animate-spin")} />
      Atualizar
    </Button>
  );
}

/** Inicia (ou abre) a conversa com um paciente ou lead já cadastrado. */
export function NewConversationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"patient" | "lead">("patient");
  const [subject, setSubject] = useState<SubjectOption | null>(null);
  const [pending, startTransition] = useTransition();
  useResetOnHide(() => setOpen(false));

  function start() {
    if (!subject) return;
    startTransition(async () => {
      const result = await openConversationAction(kind === "patient" ? { patientId: subject.id } : { leadId: subject.id }).catch(
        () => null,
      );
      if (!result || !result.ok) {
        toast.error(result && !result.ok ? result.error : "Falha de conexão. Tente de novo.");
        return;
      }
      setOpen(false);
      setSubject(null);
      router.push(`/whatsapp?conversa=${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <MessageSquarePlus aria-hidden />
          Nova conversa
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            Fora da janela de 24h (sem mensagem recente do contato), o WhatsApp só permite modelos aprovados.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Conversar com" className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {(["patient", "lead"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => {
                  setKind(option);
                  setSubject(null);
                }}
                className={cn(
                  "h-8 rounded-md px-3 text-sm transition-colors",
                  kind === option ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "patient" ? "Paciente" : "Lead"}
              </button>
            ))}
          </div>
          <FormField label={kind === "patient" ? "Paciente" : "Lead"} htmlFor="conversation-subject">
            <SubjectPicker id="conversation-subject" kind={kind} value={subject} onChange={setSubject} />
          </FormField>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={!subject || pending} onClick={start}>
            {pending ? "Abrindo…" : "Abrir conversa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Quem responde a conversa: o assistente virtual ou a equipe. */
export function ConversationModeToggle({
  conversationId,
  mode,
  disabled,
}: {
  conversationId: string;
  mode: "ASSISTANT" | "HUMAN";
  disabled?: boolean;
}) {
  const { run, pending } = useAction(setConversationModeAction);
  const active = mode === "ASSISTANT";
  return (
    <label className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-foreground">
      <Bot aria-hidden className="size-3.5 text-muted-foreground" />
      <span>Assistente responde</span>
      <Switch
        size="sm"
        checked={active}
        disabled={disabled || pending}
        onCheckedChange={(checked) => run(conversationId, checked ? "ASSISTANT" : "HUMAN")}
        aria-label={active ? "Assistente responde esta conversa (desligar para a equipe assumir)" : "A equipe atende esta conversa (ligar para o assistente voltar)"}
      />
    </label>
  );
}

/** Avalia negativamente uma resposta do assistente: vira pendência de curadoria da base. */
export function ReportReplyButton({ messageId, reported }: { messageId: string; reported: boolean }) {
  const [open, setOpen] = useState(false);
  const action = reportAssistantReplyAction.bind(null, messageId);
  const { run, pending } = useAction(action, { onSuccess: () => setOpen(false) });
  useResetOnHide(() => setOpen(false));

  if (reported) {
    return <span className="text-[0.6875rem] text-champagne">Em revisão pela equipe</span>;
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ThumbsDown aria-hidden className="size-3" />
          Avaliar resposta
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resposta inadequada?</DialogTitle>
          <DialogDescription>
            A pergunta do contato vai para “Perguntas sem resposta”, onde a equipe escreve e aprova a resposta correta. Nada
            é usado para treinar modelos.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
        >
          <FormField label="O que estava errado?" htmlFor={`report-${messageId}`} optional>
            <Textarea id={`report-${messageId}`} name="note" rows={3} maxLength={300} placeholder="Ex.: o valor informado mudou" />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando…" : "Enviar para revisão"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pedido de eliminação do titular: apaga o texto das mensagens (administração). */
export function EraseConversationButton({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction(eraseConversationAction, { onSuccess: () => setOpen(false) });
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Eraser aria-hidden />
        Apagar conteúdo
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Apagar o conteúdo desta conversa?"
        description="Use apenas para atender um pedido de eliminação do titular (LGPD). O texto de todas as mensagens é apagado de forma definitiva; ficam só datas, status e o histórico de consentimento, necessário para continuar respeitando um descadastro."
        confirmLabel="Apagar conteúdo"
        destructive
        pending={pending}
        onConfirm={() => run(conversationId)}
      />
    </>
  );
}
