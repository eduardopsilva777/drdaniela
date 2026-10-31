import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePending } from "@/components/layout/module-pending";
import { findModule } from "@/lib/app-modules";

export const metadata: Metadata = { title: "Protocolos e retornos" };

export default function Page() {
  const appModule = findModule("protocols");
  if (!appModule) notFound();
  return <ModulePending module={appModule} />;
}
