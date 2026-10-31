import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePending } from "@/components/layout/module-pending";
import { findModule } from "@/lib/app-modules";

export const metadata: Metadata = { title: "WhatsApp" };

export default function Page() {
  const appModule = findModule("whatsapp");
  if (!appModule) notFound();
  return <ModulePending module={appModule} />;
}
