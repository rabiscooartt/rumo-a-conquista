"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type IconProps = {
  className?: string;
};

function LogoTrophyIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M17 6h2a2 2 0 0 1 0 4h-2" />
      <path d="M7 6H5a2 2 0 0 0 0 4h2" />
    </svg>
  );
}

function ProfileIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  );
}

function GamepadIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 15h.01" />
      <path d="M9 13h.01" />
      <path d="M15 14h.01" />
      <path d="M17 12h.01" />
      <path d="M7.5 18h9a4.5 4.5 0 0 0 4.43-5.3l-.7-4A4 4 0 0 0 16.3 5.4H7.7a4 4 0 0 0-3.94 3.3l-.7 4A4.5 4.5 0 0 0 7.5 18Z" />
    </svg>
  );
}

function HistoryIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 8v5l3 2" />
      <path d="M3.05 11a9 9 0 1 1 2.64 6.36" />
      <path d="M3 17h3v-3" />
    </svg>
  );
}

function PlayIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10 9 5 3-5 3V9Z" />
    </svg>
  );
}

function ScrollIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8" />
      <path d="M8 20a4 4 0 0 1 0-8h10" />
      <path d="M8 12a4 4 0 0 0 0-8" />
      <path d="M8 4H6a4 4 0 0 0 0 8h2" />
    </svg>
  );
}

function DiamondIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3h12l4 6-10 12L2 9l4-6Z" />
      <path d="M2 9h20" />
      <path d="m8 9 4 12 4-12" />
      <path d="m6 3 2 6" />
      <path d="m18 3-2 6" />
    </svg>
  );
}

function ShieldIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
      <path d="M9 12l2 2 4-5" />
    </svg>
  );
}

function YouTubeIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
    >
      <path
        d="M21.58 7.19a2.76 2.76 0 0 0-1.94-1.95C17.92 4.78 12 4.78 12 4.78s-5.92 0-7.64.46a2.76 2.76 0 0 0-1.94 1.95A28.7 28.7 0 0 0 1.96 12a28.7 28.7 0 0 0 .46 4.81 2.76 2.76 0 0 0 1.94 1.95c1.72.46 7.64.46 7.64.46s5.92 0 7.64-.46a2.76 2.76 0 0 0 1.94-1.95A28.7 28.7 0 0 0 22.04 12a28.7 28.7 0 0 0-.46-4.81Z"
        fill="currentColor"
      />
      <path d="M10.1 15.25V8.75L15.75 12l-5.65 3.25Z" fill="black" />
    </svg>
  );
}

function TwitchIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M4.5 3 3 7.1v12.4h4.7V22h2.7l2.5-2.5h3.8L21 15.2V3H4.5Zm14.6 11.3-2.7 2.7h-4.2l-2.5 2.5V17H6.2V4.9h12.9v9.4Z" />
      <path d="M15.3 8.1h1.6v4.7h-1.6V8.1Zm-4.4 0h1.6v4.7h-1.6V8.1Z" />
    </svg>
  );
}

const navLinks = [
  {
    label: "Perfil",
    href: "/",
    icon: ProfileIcon,
  },
  {
    label: "Jogos",
    href: "/biblioteca",
    icon: GamepadIcon,
  },
  {
    label: "Histórico",
    href: "/historico",
    icon: HistoryIcon,
  },
  {
    label: "Conteúdo",
    href: "/conteudo",
    icon: PlayIcon,
  },
  {
    label: "Jornada",
    href: "/jornada",
    icon: ScrollIcon,
  },
  {
    label: "Próximas Maestrias",
    href: "/backlog",
    icon: DiamondIcon,
  },
  {
    label: "Emblemas",
    href: "/sagas",
    icon: ShieldIcon,
  },
];

export default function Navbar() {
  const pathname = usePathname();

  function isActiveLink(href: string) {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#05070a]/90 backdrop-blur-xl">
      <nav className="mx-auto flex h-[74px] w-full max-w-[1500px] items-center justify-between px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-400 shadow-[0_0_24px_rgba(239,68,68,0.12)]">
            <LogoTrophyIcon className="h-5 w-5" />
          </span>

          <span className="text-2xl font-black tracking-tight text-white">
            Rumo à <span className="text-red-500">Conquista</span>
          </span>
        </Link>

        <div className="hidden items-center gap-5 lg:flex">
          {navLinks.map((link) => {
            const isActive = isActiveLink(link.href);
            const Icon = link.icon;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`group relative flex items-center gap-2 py-7 text-sm font-black transition ${
                  isActive
                    ? "text-red-400"
                    : "text-white/70 hover:text-white"
                }`}
              >
                <Icon
                  className={`h-[19px] w-[19px] transition ${
                    isActive
                      ? "text-red-400"
                      : "text-white/55 group-hover:text-white/90"
                  }`}
                />

                <span>{link.label}</span>

                <span
                  className={`absolute bottom-0 left-0 h-[3px] rounded-full bg-red-500 transition-all ${
                    isActive ? "w-full opacity-100" : "w-0 opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </div>

        <div className="hidden items-center gap-5 lg:flex">
          <a
            href="https://www.youtube.com/@orabiisco"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm font-black text-red-400 transition hover:text-red-300"
          >
            <YouTubeIcon className="h-5 w-5" />
            <span>YouTube</span>
          </a>

          <a
            href="https://www.twitch.tv/orabiisco"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm font-black text-purple-400 transition hover:text-purple-300"
          >
            <TwitchIcon className="h-5 w-5" />
            <span>Twitch</span>
          </a>
        </div>

        <div className="flex items-center gap-3 lg:hidden">
          <Link
            href="/biblioteca"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-white/70"
          >
            Jogos
          </Link>

          <Link
            href="/sagas"
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-black text-red-300"
          >
            Emblemas
          </Link>
        </div>
      </nav>
    </header>
  );
}