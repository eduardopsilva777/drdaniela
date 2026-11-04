"use client";

import { Check, Copy, KeyRound, MoreHorizontal } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { fieldAria, FormField } from "@/components/forms/form-field";
import { FormSelect } from "@/components/forms/form-select";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { UserRole } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/auth/permissions";
import {
  changeOwnPasswordAction,
  createStaffAction,
  resetStaffPasswordAction,
  setStaffActiveAction,
  updateStaffAction,
} from "@/server/actions/users";

const ROLE_OPTIONS = STAFF_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }));

const ROLE_HELP: Record<UserRole, string> = {
  RECEPTION: "Leads, pacientes, agenda, retornos, WhatsApp, tarefas e propostas para a base de conhecimento. Sem observações clínicas.",
  PROFESSIONAL: "Tudo da recepção + observações clínicas, procedimentos, protocolos, aprovação da base de conhecimento e métricas do assistente.",
  ADMIN: "Acesso completo, inclusive equipe, auditoria, configurações do assistente e exportação de dados (LGPD).",
  ASSISTANT: "Conta de sistema do assistente virtual — não é atribuída a pessoas.",
};

/** Exibe a senha provisória uma única vez, com botão para copiar. */
function TemporaryPasswordDialog({
  name,
  password,
  onClose,
}: {
  name: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound aria-hidden className="size-4 text-rose" />
            Senha provisória de {name}
          </DialogTitle>
          <DialogDescription>
            Entregue a senha pessoalmente ou por um canal seguro. Ela não será exibida de novo, e a troca é exigida no
            primeiro acesso.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised/60 p-3">
          <code className="flex-1 font-mono text-base tracking-wider text-foreground select-all">{password}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard
                .writeText(password)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copiada" : "Copiar"}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Entendi, já anotei</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewStaffButton() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<UserRole>("RECEPTION");
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  // Ref (e não estado): o nome precisa estar disponível no retorno da mesma submissão.
  const submittedName = useRef("");
  const { run, pending, fieldErrors, reset } = useAction(createStaffAction, {
    onSuccess: ({ temporaryPassword }) => {
      setOpen(false);
      setCreated({ name: submittedName.current, password: temporaryPassword });
    },
  });
  useResetOnHide(() => setOpen(false));
  const error = (field: string) => firstFieldError(fieldErrors, field);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button>Nova conta</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova conta da equipe</DialogTitle>
            <DialogDescription>Uma senha provisória é gerada automaticamente e exibida uma única vez.</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              submittedName.current = String(data.get("name") ?? "").trim();
              run(data);
            }}
          >
            <FormField label="Nome completo" htmlFor="staff-name" error={error("name")}>
              <Input {...fieldAria("staff-name", error("name"))} name="name" maxLength={120} autoComplete="off" />
            </FormField>
            <FormField label="E-mail de acesso" htmlFor="staff-email" error={error("email")}>
              <Input {...fieldAria("staff-email", error("email"))} name="email" type="email" maxLength={254} autoComplete="off" />
            </FormField>
            <FormField label="Perfil de acesso" htmlFor="staff-role" error={error("role")} description={ROLE_HELP[role]}>
              <FormSelect
                id="staff-role"
                name="role"
                value={role}
                onValueChange={(value) => setRole(value as UserRole)}
                options={ROLE_OPTIONS}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Criando…" : "Criar conta"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {created ? <TemporaryPasswordDialog name={created.name} password={created.password} onClose={() => setCreated(null)} /> : null}
    </>
  );
}

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

type Pending = "edit" | "reset" | "deactivate" | null;

export function StaffActions({ staff, isSelf }: { staff: StaffRow; isSelf: boolean }) {
  const [dialog, setDialog] = useState<Pending>(null);
  const [password, setPassword] = useState<string | null>(null);
  useResetOnHide(() => setDialog(null));
  const close = () => setDialog(null);

  const reset = useAction(resetStaffPasswordAction, {
    onSuccess: ({ temporaryPassword }) => {
      close();
      setPassword(temporaryPassword);
    },
  });
  const toggle = useAction(setStaffActiveAction, { onSuccess: close });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${staff.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>Editar nome e perfil</DropdownMenuItem>
          {staff.isActive ? <DropdownMenuItem onSelect={() => setDialog("reset")}>Gerar nova senha provisória</DropdownMenuItem> : null}
          {!isSelf ? (
            <>
              <DropdownMenuSeparator />
              {staff.isActive ? (
                <DropdownMenuItem className="text-brick focus:text-brick" onSelect={() => setDialog("deactivate")}>
                  Desativar conta
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => toggle.run(staff.id, true)}>Reativar conta</DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "edit" ? <EditStaffDialog staff={staff} onClose={close} /> : null}
      <ConfirmDialog
        open={dialog === "reset"}
        onOpenChange={(open) => !open && close()}
        title={`Gerar nova senha para ${staff.name}?`}
        description="A senha atual deixa de funcionar e todas as sessões abertas da pessoa são encerradas. A nova senha é provisória: a troca é exigida no próximo acesso."
        confirmLabel="Gerar senha provisória"
        pending={reset.pending}
        onConfirm={() => reset.run(staff.id)}
      />
      <ConfirmDialog
        open={dialog === "deactivate"}
        onOpenChange={(open) => !open && close()}
        destructive
        title={`Desativar a conta de ${staff.name}?`}
        description="O acesso é bloqueado imediatamente e as sessões abertas são encerradas. O histórico e a auditoria são mantidos; a conta pode ser reativada depois."
        confirmLabel="Desativar conta"
        pending={toggle.pending}
        onConfirm={() => toggle.run(staff.id, false)}
      />
      {password ? <TemporaryPasswordDialog name={staff.name} password={password} onClose={() => setPassword(null)} /> : null}
    </>
  );
}

function EditStaffDialog({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const [role, setRole] = useState<UserRole>(staff.role);
  const { run, pending, fieldErrors } = useAction(updateStaffAction.bind(null, staff.id), { onSuccess: onClose });
  const error = (field: string) => firstFieldError(fieldErrors, field);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar {staff.name}</DialogTitle>
          <DialogDescription>{staff.email}. Mudanças de perfil valem imediatamente.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
        >
          <FormField label="Nome completo" htmlFor="edit-staff-name" error={error("name")}>
            <Input {...fieldAria("edit-staff-name", error("name"))} name="name" defaultValue={staff.name} maxLength={120} />
          </FormField>
          <FormField label="Perfil de acesso" htmlFor="edit-staff-role" error={error("role")} description={ROLE_HELP[role]}>
            <FormSelect
              id="edit-staff-role"
              name="role"
              value={role}
              onValueChange={(value) => setRole(value as UserRole)}
              options={ROLE_OPTIONS}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
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

export function PasswordChangeForm({ forced }: { forced: boolean }) {
  const [formKey, setFormKey] = useState(0);
  const { run, pending, fieldErrors } = useAction(changeOwnPasswordAction, {
    onSuccess: () => setFormKey((key) => key + 1),
  });
  const error = (field: string) => firstFieldError(fieldErrors, field);
  const fields: Array<{ name: string; label: string; autoComplete: string; description?: ReactNode }> = [
    { name: "currentPassword", label: forced ? "Senha provisória" : "Senha atual", autoComplete: "current-password" },
    {
      name: "newPassword",
      label: "Nova senha",
      autoComplete: "new-password",
      description: "Ao menos 12 caracteres. Uma frase longa é mais segura e fácil de lembrar.",
    },
    { name: "confirmation", label: "Repita a nova senha", autoComplete: "new-password" },
  ];

  return (
    <form
      key={formKey}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(new FormData(event.currentTarget));
      }}
    >
      {fields.map((field) => (
        <FormField
          key={field.name}
          label={field.label}
          htmlFor={`password-${field.name}`}
          error={error(field.name)}
          description={field.description}
        >
          <Input
            {...fieldAria(`password-${field.name}`, error(field.name), Boolean(field.description))}
            name={field.name}
            type="password"
            autoComplete={field.autoComplete}
            maxLength={256}
          />
        </FormField>
      ))}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : forced ? "Definir nova senha e continuar" : "Alterar senha"}
        </Button>
      </div>
    </form>
  );
}
