import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rumo Ã  Conquista",
  description:
    "Site pessoal para acompanhar jogos, conquistas, maestrias, sagas e progresso da jornada gamer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}