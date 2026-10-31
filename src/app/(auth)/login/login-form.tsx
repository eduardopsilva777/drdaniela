"use client";

import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { loginAction, type LoginFormState } from "@/server/auth/actions";

const INITIAL_STATE: LoginFormState = { status: "idle" };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);

  const emailErrors = state.fieldErrors?.email?.map((message) => ({ message }));
  const passwordErrors = state.fieldErrors?.password?.map((message) => ({ message }));

  return (
    <form action={formAction} noValidate className="space-y-7">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-1.5">
        <h1 className="text-2xl font-medium tracking-tight text-foreground">Entrar</h1>
        <p className="text-sm text-muted-foreground">
          Use o e-mail e a senha da sua conta na clínica.
        </p>
      </div>

      {state.message ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-brick/30 bg-brick/[0.08] px-4 py-3 text-sm text-foreground"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-brick" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <FieldGroup className="gap-5">
        <Field data-invalid={emailErrors ? true : undefined}>
          <FieldLabel htmlFor="email">E-mail</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            defaultValue={state.email}
            aria-invalid={emailErrors ? true : undefined}
            aria-describedby={emailErrors ? "email-error" : undefined}
            className="h-11 rounded-lg px-3.5 text-[0.9375rem]"
          />
          <FieldError id="email-error" errors={emailErrors} />
        </Field>

        <Field data-invalid={passwordErrors ? true : undefined}>
          <FieldLabel htmlFor="password">Senha</FieldLabel>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={256}
              aria-invalid={passwordErrors ? true : undefined}
              aria-describedby={passwordErrors ? "password-error" : undefined}
              className="h-11 rounded-lg px-3.5 pr-11 text-[0.9375rem]"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </div>
          <FieldError id="password-error" errors={passwordErrors} />
        </Field>
      </FieldGroup>

      <Button type="submit" size="lg" className="h-11 w-full rounded-lg text-[0.9375rem]" disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle aria-hidden className="animate-spin" />
            Entrando…
          </>
        ) : (
          "Entrar"
        )}
      </Button>

      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
        Esqueceu a senha? Fale com a administração da clínica.
      </p>
    </form>
  );
}
