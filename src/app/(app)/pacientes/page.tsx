import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModulePending } from "@/components/layout/module-pending";
import { findModule } from "@/lib/app-modules";

export const metadata: Metadata = { title: "Pacientes" };

export default function Page() {
  const appModule = findModule("patients");
  if (!appModule) notFound();
  return <ModulePending module={appModule} />;
}
