import Link from "next/link";

// Atalhos entre as áreas pessoais da jornada, exibidos nas sidebars de Perfil e Histórico.
const SHORTCUTS = [
  { label: "Meu perfil", href: "/perfil" },
  { label: "Histórico de troféus", href: "/historico" },
  { label: "Biblioteca", href: "/biblioteca" },
  { label: "Emblemas", href: "/sagas" },
  { label: "Atividade", href: "/atividade" },
];

export default function JourneyShortcuts({ current }: { current: string }) {
  return (
    <nav aria-label="Atalhos da jornada" className="mt-6 border-t border-white/[0.08] pt-5">
      <p className="text-[8px] font-black uppercase tracking-[0.20em] text-white/30">
        Atalhos
      </p>

      <ul className="mt-3 space-y-1">
        {SHORTCUTS.filter((item) => item.href !== current).map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="group flex min-h-10 items-center justify-between rounded-lg px-3 text-[12px] font-bold text-white/60 transition hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              {item.label}
              <span aria-hidden="true" className="text-white/25 transition group-hover:translate-x-0.5 group-hover:text-red-400">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
