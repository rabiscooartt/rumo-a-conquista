import type { Metadata } from "next";
import "./globals.css";
import AdminShortcutButton from "@/components/AdminShortcutButton";

export const metadata: Metadata = {
  title: "Rumo à Conquista",
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
      <body>
        {children}
        <AdminShortcutButton />
      </body>
    </html>
  );
}