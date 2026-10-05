import type { Metadata } from "next";
import "./globals.css";
import BannerSettingsProvider from "@/components/BannerSettingsProvider";
import { loadSiteBannerSettings } from "@/lib/site-banner-settings";

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
  const bannerSettings = await loadSiteBannerSettings();

  return (
    <html lang="pt-BR">
      <head>
        <link
          rel="preload"
          as="image"
          href="/images/content-banner-bg.png"
        />
        <link
          rel="preload"
          as="image"
          href="/images/activity-banner-bg.png"
        />
        <link
          rel="preload"
          as="image"
          href="/images/jogos-bg.png"
        />
      </head>
      <body>
        <BannerSettingsProvider initialSettings={bannerSettings}>
          {children}
        </BannerSettingsProvider>
      </body>
    </html>
  );
}
