import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Hanken_Grotesk } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import "./globals.css";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

const display = Bodoni_Moda({
  subsets: ["latin"],
  variable: "--font-bodoni",
  axes: ["opsz"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CRM — Dra. Daniela Zilioli",
    template: "%s — Dra. Daniela Zilioli",
  },
  description: "Sistema interno de gestão da clínica Dra. Daniela Zilioli.",
  applicationName: "CRM Dra. Daniela Zilioli",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0e0b0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={cn("dark", sans.variable, display.variable)}>
      <body className="min-h-dvh">
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
