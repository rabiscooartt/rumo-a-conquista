"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AdminAvatarLogin, { AUTH_CHANGED_EVENT } from "@/components/AdminAvatarLogin";

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

function HomeIcon({ className = "" }: IconProps) {
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
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h14V9" />
      <path d="M9 20v-6h6v6" />
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

function ReviewIcon({ className = "" }: IconProps) {
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
      <path d="M8 3h7l5 5v13H4V3h4Z" />
      <path d="M14 3v6h6" />
      <path d="m8 15 2.2 2.2L16 11.5" />
    </svg>
  );
}

const navLinks = [
  {
    label: "Início",
    href: "/",
    icon: HomeIcon,
  },
  {
    label: "Jogos",
    href: "/biblioteca",
    adminHref: "/admin/jogos",
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
    label: "Atividade",
    href: "/atividade",
    icon: ScrollIcon,
  },
  {
    label: "Próximas Maestrias",
    href: "/backlog",
    adminHref: "/admin/backlog",
    icon: DiamondIcon,
  },
  {
    label: "Emblemas",
    href: "/sagas",
    icon: ShieldIcon,
  },
  {
    label: "Review",
    href: "/reviews",
    icon: ReviewIcon,
  },
  {
    label: "Banco de Jogos",
    href: "/biblioteca",
    adminHref: "/admin/sorteio-jogos",
    adminOnly: true,
    icon: GamepadIcon,
  },
];

export default function Navbar() {
  const pathname = usePathname();
  const [isAdminMode, setIsAdminMode] = useState(false);

  useEffect(() => {
    async function loadAdminStatus() {
      try {
        const response = await fetch("/api/admin/auth/status", {
          cache: "no-store",
        });
        const data = (await response.json()) as { authenticated?: boolean };
        setIsAdminMode(data.authenticated === true);
      } catch {
        setIsAdminMode(false);
      }
    }

    void loadAdminStatus();
    window.addEventListener(AUTH_CHANGED_EVENT, loadAdminStatus);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, loadAdminStatus);
    };
  }, []);

  function isActiveLink(href: string) {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#05070a]/90 backdrop-blur-xl">
      <nav className="mx-auto flex h-[64px] w-full max-w-[1500px] items-center justify-between px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-400 shadow-[0_0_24px_rgba(239,68,68,0.12)]">
            <LogoTrophyIcon className="h-5 w-5" />
          </span>

          <span className="text-2xl font-black tracking-tight text-white">
            Rumo à <span className="text-red-500">Conquista</span>
          </span>
        </Link>

        <div className="hidden items-center gap-2.5 lg:flex xl:gap-3 2xl:gap-4">
          {navLinks
            .filter((link) => (!("adminOnly" in link) || !link.adminOnly || isAdminMode) && (link.href !== "/backlog" || isAdminMode))
            .map((link) => {
            const targetHref =
              isAdminMode && link.adminHref ? link.adminHref : link.href;
            const isActive = isActiveLink(targetHref);
            const Icon = link.icon;

            return (
              <Link
                key={link.href}
                href={targetHref}
                className={`group relative flex items-center gap-1.5 whitespace-nowrap py-5 text-[11px] font-black leading-none transition xl:gap-2 xl:text-xs 2xl:text-sm ${
                  isActive
                    ? "text-red-400"
                    : "text-white/70 hover:text-white"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 transition xl:h-[18px] xl:w-[18px] ${
                    isActive
                      ? "text-red-400"
                      : "text-white/55 group-hover:text-white/90"
                  }`}
                />

                <span className="whitespace-nowrap">{isAdminMode && link.href === "/backlog" ? "Editar Fila" : link.label}</span>

                <span
                  className={`absolute bottom-0 left-0 h-[3px] rounded-full bg-red-500 transition-all ${
                    isActive ? "w-full opacity-100" : "w-0 opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </div>

        <div className="hidden items-center gap-2.5 lg:flex">
          <AdminAvatarLogin showLabel />
        </div>

        <div className="flex items-center gap-3 lg:hidden">
          <AdminAvatarLogin showLabel />

          <Link
            href={isAdminMode ? "/admin/jogos" : "/biblioteca"}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-white/70"
          >
            Jogos
          </Link>

          {isAdminMode && (
            <Link
              href="/admin/sorteio-jogos"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-white/70"
            >
              Banco
            </Link>
          )}
          <Link
            href="/sagas"
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-black text-red-300"
          >
            Emblemas
          </Link>
          <Link
            href="/reviews"
            className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
              isActiveLink("/reviews")
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : "border-white/10 bg-white/[0.03] text-white/70"
            }`}
          >
            Review
          </Link>
        </div>
      </nav>
    </header>
  );
}
