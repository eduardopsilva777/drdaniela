"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { openConversationAction } from "@/server/actions/messaging";

/** Abre (ou cria) a conversa de WhatsApp do paciente ou lead na área de conversas. */
export function OpenConversationButton({
  subject,
  label = "Conversa",
  variant = "outline",
}: {
  subject: { patientId?: string; leadId?: string };
  label?: string;
  variant?: "outline" | "ghost";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await openConversationAction(subject).catch(() => null);
          if (!result || !result.ok) {
            toast.error(result && !result.ok ? result.error : "Falha de conexão. Tente de novo.");
            return;
          }
          router.push(`/whatsapp?conversa=${result.data.id}`);
        })
      }
    >
      <MessageCircle aria-hidden />
      {label}
    </Button>
  );
}
