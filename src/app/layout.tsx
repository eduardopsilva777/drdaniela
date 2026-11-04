import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

import { THEME_INIT_SCRIPT } from "@/components/theme/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import "./globals.css";

// Manrope: uma família para marca e interface, com números tabulares e acentuação completa.
const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Clinni",
    template: "%s — Clinni",
  },
  description: "Clinni — gestão, relacionamento e inteligência para clínicas estéticas.",
  applicationName: "Clinni",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1117" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // A classe `dark` é aplicada pelo script abaixo, antes da pintura, conforme a preferência salva.
    <html lang="pt-BR" className={cn(sans.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
