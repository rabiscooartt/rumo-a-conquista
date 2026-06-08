const tabs = [
  {
    label: "Perfil",
    icon: "🏠",
    href: "#perfil",
  },
  {
    label: "Histórico",
    icon: "📖",
    href: "#historico",
  },
  {
    label: "Estatísticas",
    icon: "📊",
    href: "#estatisticas",
  },
  {
    label: "Jogos",
    icon: "🎮",
    href: "#jogos",
  },
  {
    label: "Marcos",
    icon: "🏆",
    href: "#marcos",
  },
  {
    label: "Backlog",
    icon: "📋",
    href: "#backlog",
  },
  {
    label: "Insígnias",
    icon: "⭐",
    href: "#insignias",
  },
];

export default function ProfileTabs() {
  return (
    <nav
      id="historico"
      className="overflow-hidden rounded-[20px] border border-white/10 bg-zinc-950/80 shadow-xl"
    >
      <div className="grid grid-cols-2 divide-x divide-y divide-white/10 sm:grid-cols-3 lg:grid-cols-7 lg:divide-y-0">
        {tabs.map((tab) => (
          <a
            key={tab.label}
            href={tab.href}
            className="group flex items-center justify-center gap-2 px-4 py-4 text-sm font-black text-white/70 transition hover:bg-red-500/10 hover:text-white"
          >
            <span className="text-base transition group-hover:scale-110">
              {tab.icon}
            </span>

            <span>{tab.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}