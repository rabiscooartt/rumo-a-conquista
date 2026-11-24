import type { Metadata } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";
import BannerSettingsProvider from "@/components/BannerSettingsProvider";
import { loadCachedSiteBannerSettings } from "@/lib/site-banner-settings";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

// Fonte de exibição: títulos, números de destaque e navegação. O texto corrido continua em Inter.
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
  variable: "--font-display",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rumo à Conquista",
  description:
    "Site pessoal para acompanhar jogos, conquistas, maestrias, sagas e progresso da jornada gamer.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const bannerSettings = await loadCachedSiteBannerSettings();

  return (
    <html lang="pt-BR">
      <body className={`${inter.className} ${display.variable}`}>
        <BannerSettingsProvider initialSettings={bannerSettings}>
          {children}
        </BannerSettingsProvider>
      </body>
    </html>
  );
}
