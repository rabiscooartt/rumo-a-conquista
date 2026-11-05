"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AdminAvatarLogin from "@/components/AdminAvatarLogin";

type IconProps = {
  className?: string;
};

function IconBase({
  className = "",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function TrophyCrest({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 72 72"
      aria-hidden="true"
      className={className}
      fill="none"
    >
      <path
        d="M14 52C5 42 4 29 10 18M18 55C11 46 10 36 13 27M58 52c9-10 10-23 4-34M54 55c7-9 8-19 5-28"
        stroke="#E53B48"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="m8 27 7 2-2-8M12 41l7-1-4-7M18 53l6-4-6-4M64 27l-7 2 2-8M60 41l-7-1 4-7M54 53l-6-4 6-4"
        stroke="#E53B48"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M36 5 40 11 47 8 46 16 36 20 26 16 25 8 32 11 36 5Z"
        fill="#D92D3C"
        stroke="#FF7A83"
        strokeWidth="1"
      />
      <path
        d="M24 20h24v13c0 9-5.3 15-12 15s-12-6-12-15V20Z"
        fill="#B92332"
        stroke="#FF737D"
        strokeWidth="1.8"
      />
      <path
        d="M24 24h-6c-1 9 3 14 11 15M48 24h6c1 9-3 14-11 15"
        stroke="#FF737D"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M36 48v8M28 59h16" stroke="#FF737D" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="m36 24 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L36 24Z"
        fill="#FFD1A0"
      />
    </svg>
  );
}

function HomeIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></IconBase>;
}

function GamepadIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="M7.5 18h9a4.5 4.5 0 0 0 4.4-5.4l-.7-4A4 4 0 0 0 16.3 5H7.7a4 4 0 0 0-3.9 3.6l-.7 4A4.5 4.5 0 0 0 7.5 18Z" /><path d="M8 10v4M6 12h4M15.5 11.5h.01M18 14h.01" /></IconBase>;
}

function ProfileIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.3 3.1-5 7-5s6.2 1.7 7 5" /></IconBase>;
}

function ActivityIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="M3 12h3l2.1-6 4 12 2.2-6H21" /></IconBase>;
}

function ShieldIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-5" /></IconBase>;
}

function PlayIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3V9Z" /></IconBase>;
}

function ReviewIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="M8 3h7l5 5v13H4V3h4Z" /><path d="M14 3v6h6M8 15l2.2 2.2L16 11.5" /></IconBase>;
}

function HistoryIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></IconBase>;
}

function SearchIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></IconBase>;
}

function BellIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></IconBase>;
}

function ChevronDownIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="m6 9 6 6 6-6" /></IconBase>;
}

function MenuIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="M4 6h16M4 12h16M4 18h16" /></IconBase>;
}

function CloseIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="m6 6 12 12M18 6 6 18" /></IconBase>;
}

function SearchForm({
  compact = false,
  value,
  onChange,
}: {
  compact?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <form
      action="/biblioteca"
      method="get"
      role="search"
      className={
        compact
          ? "flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/45 px-3 focus-within:border-red-500/50 focus-within:ring-1 focus-within:ring-red-500/20"
          : "hidden h-10 w-[168px] items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-3 transition-colors focus-within:border-red-500/45 focus-within:ring-1 focus-within:ring-red-500/15 2xl:flex 2xl:w-[188px]"
      }
    >
      <SearchIcon className="h-4 w-4 shrink-0 text-white/45" />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Buscar jogos..."
        aria-label="Buscar jogos na biblioteca"
        className="min-w-0 w-full bg-transparent py-2 text-[11px] font-medium text-white outline-none placeholder:text-white/35"
      />
    </form>
  );
}

const navLinks = [
  { label: "Início", href: "/", icon: HomeIcon },
  { label: "Perfil", href: "/perfil", icon: ProfileIcon },
  {
    label: "Biblioteca",
    adminLabel: "Jogos",
    href: "/biblioteca",
    adminHref: "/admin/jogos",
    icon: GamepadIcon,
  },
  { label: "Atividade", href: "/atividade", icon: ActivityIcon },
  { label: "Emblemas", href: "/sagas", icon: ShieldIcon },
  { label: "Conteúdo", href: "/conteudo", icon: PlayIcon },
  { label: "Reviews", href: "/reviews", icon: ReviewIcon },
  { label: "Histórico", href: "/historico", icon: HistoryIcon },
  {
    label: "Banco de Jogos",
    href: "/admin/sorteio-jogos",
    adminOnly: true,
    icon: GamepadIcon,
  },
];

export default function Navbar() {
  const pathname = usePathname();
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
    window.addEventListener("rumo-admin-auth-changed", loadAdminStatus);

    return () => {
      window.removeEventListener("rumo-admin-auth-changed", loadAdminStatus);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        setIsAccountOpen(false);
        setIsSearchOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function isActiveLink(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const visibleLinks = navLinks.filter(
    (link) => (!("adminOnly" in link) || !link.adminOnly || isAdminMode)
  );

  function renderLink(link: (typeof navLinks)[number], mobile = false) {
    const targetHref =
      "adminHref" in link && isAdminMode && link.adminHref
        ? link.adminHref
        : link.href;
    const label =
      "adminLabel" in link && isAdminMode && link.adminLabel
        ? link.adminLabel
        : link.label;
    const active = isActiveLink(targetHref);
    const Icon = link.icon;

    return (
      <Link
        key={link.href}
        href={targetHref}
        onClick={() => {
          setIsMenuOpen(false);
          setIsAccountOpen(false);
          setIsSearchOpen(false);
        }}
        aria-current={active ? "page" : undefined}
        className={
          mobile
            ? `group flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                active
                  ? "border-red-500/35 bg-red-500/12 text-white"
                  : "border-transparent text-white/75 hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
              }`
            : `group relative flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[10px] font-extrabold tracking-[0.015em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 2xl:gap-2 2xl:px-3 2xl:text-[11px] ${
                active
                  ? "border-red-500/45 bg-[linear-gradient(180deg,rgba(127,20,31,.56),rgba(60,8,16,.52))] text-white shadow-[inset_0_0_18px_rgba(239,35,52,.12),0_0_18px_rgba(239,35,52,.10)]"
                  : "border-transparent text-white/70 hover:border-white/10 hover:bg-white/[0.045] hover:text-white"
              }`
        }
      >
        <Icon
          className={`h-[16px] w-[16px] shrink-0 transition-colors 2xl:h-[17px] 2xl:w-[17px] ${
            active ? "text-red-400" : "text-white/55 group-hover:text-red-200"
          }`}
        />
        <span>{label}</span>
        {active && !mobile ? (
          <span className="pointer-events-none absolute -bottom-[7px] left-3 right-3 h-[2px] rounded-full bg-red-500 shadow-[0_0_9px_rgba(239,68,68,.85)]" />
        ) : null}
      </Link>
    );
  }


  return (
    <header className="sticky top-0 z-50 isolate border-b border-red-500/20 bg-[#050609]/95 shadow-[0_8px_28px_rgba(0,0,0,.34)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 bg-[url('/images/backgrounds/rabiisco-global-bg.webp')] bg-cover bg-[center_38%] opacity-35" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,4,7,.96)_0%,rgba(6,5,8,.84)_48%,rgba(4,4,7,.96)_100%)]" />
        <div className="absolute inset-y-0 left-0 w-[32%] bg-[radial-gradient(ellipse_at_left,rgba(155,22,38,.22),transparent_72%)]" />
        <div className="absolute inset-y-0 right-0 w-[32%] bg-[radial-gradient(ellipse_at_right,rgba(155,22,38,.18),transparent_72%)]" />
        <div className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-red-500/45 to-transparent" />
      </div>

      <div className="relative mx-auto flex min-h-[72px] w-full max-w-[1900px] items-center gap-3 px-3 sm:px-5 xl:min-h-[78px] xl:px-5 2xl:gap-4 2xl:px-7">
        <Link
          href="/"
          aria-label="Rumo à Conquista - Início"
          className="group flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          <TrophyCrest className="h-11 w-11 shrink-0 drop-shadow-[0_0_10px_rgba(220,38,55,.24)] sm:h-12 sm:w-12" />
          <span className="flex flex-col leading-[0.92]">
            <span className="font-serif text-[12px] font-bold tracking-[0.14em] text-white sm:text-[13px]">
              RUMO À
            </span>
            <span className="mt-1 font-serif text-[16px] font-black tracking-[0.055em] text-red-500 sm:text-[18px]">
              CONQUISTA
            </span>
            <span className="mt-1 hidden text-[8px] font-semibold tracking-[0.24em] text-white/50 sm:block">
              SUA JORNADA GAMER
            </span>
          </span>
        </Link>

        <div className="hidden h-10 w-px shrink-0 bg-white/15 xl:block" />

        <nav
          aria-label="Navegação principal"
          className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 xl:flex 2xl:gap-1"
        >
          {visibleLinks.map((link) => renderLink(link))}
        </nav>

        <div className="ml-auto hidden shrink-0 items-center gap-2 2xl:flex">
          <SearchForm value={searchQuery} onChange={setSearchQuery} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 xl:ml-0">
          <button
            type="button"
            onClick={() => { setIsMenuOpen(false); setIsSearchOpen((open) => !open); }}
            aria-label={isSearchOpen ? "Fechar busca" : "Abrir busca"}
            aria-expanded={isSearchOpen}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-white/70 transition hover:border-red-500/35 hover:bg-red-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 2xl:hidden"
          >
            <SearchIcon className="h-[18px] w-[18px]" />
          </button>

          <Link
            href="/atividade"
            aria-label="Ver atividade recente"
            title="Atividade recente"
            className="relative flex h-10 w-9 items-center justify-center rounded-lg text-white/65 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <BellIcon className="h-[18px] w-[18px]" />
          </Link>

          <div className="flex items-center gap-0.5">
            <AdminAvatarLogin showLabel={false} />
            <div className="relative">
              <button
                type="button"
                onClick={() => { setIsMenuOpen(false); setIsSearchOpen(false); setIsAccountOpen((open) => !open); }}
                aria-label="Abrir menu do perfil"
                aria-expanded={isAccountOpen}
                className="flex h-9 w-6 items-center justify-center rounded-md text-white/55 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <ChevronDownIcon className="h-4 w-4" />
              </button>
              {isAccountOpen ? (
                <div className="absolute right-0 top-[calc(100%+14px)] z-[80] w-56 overflow-hidden rounded-xl border border-white/10 bg-[#09090d]/[.98] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,.62)] backdrop-blur-xl">
                  <Link href="/perfil" onClick={() => setIsAccountOpen(false)} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.06] hover:text-white">
                    <ProfileIcon className="h-4 w-4 text-white/50" /> Meu perfil
                  </Link>
                  {isAdminMode ? (
                    <>
                      <Link href="/admin/jogos" onClick={() => setIsAccountOpen(false)} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.06] hover:text-white">
                        <GamepadIcon className="h-4 w-4 text-white/50" /> Administração de jogos
                      </Link>
                      <Link href="/admin/sorteio-jogos" onClick={() => setIsAccountOpen(false)} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-white/80 transition hover:bg-white/[0.06] hover:text-white">
                        <GamepadIcon className="h-4 w-4 text-white/50" /> Banco de jogos
                      </Link>
                    </>
                  ) : (
                    <p className="px-3 py-2 text-[10px] font-medium leading-relaxed text-white/35">
                      Clique no avatar para acessar o modo administrador.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setIsSearchOpen(false); setIsAccountOpen(false); setIsMenuOpen((open) => !open); }}
            aria-label={isMenuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={isMenuOpen}
            aria-controls="rac-mobile-navigation"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/35 bg-red-500/[0.08] text-red-200 transition hover:border-red-400/60 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 xl:hidden"
          >
            {isMenuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {isSearchOpen ? (
        <div className="relative mx-auto max-w-[1900px] px-3 pb-3 sm:px-5 2xl:hidden">
          <SearchForm compact value={searchQuery} onChange={setSearchQuery} />
        </div>
      ) : null}

      <div
        id="rac-mobile-navigation"
        className={`relative mx-auto max-w-[1900px] px-3 pb-3 sm:px-5 xl:hidden ${isMenuOpen ? "block" : "hidden"}`}
      >
        <div className="rounded-2xl border border-white/10 bg-[#08090d]/95 p-2 shadow-[0_18px_45px_rgba(0,0,0,.56)] backdrop-blur-2xl">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {visibleLinks.map((link) => renderLink(link, true))}
          </div>
          {!isAdminMode ? (
            <div className="mt-2 border-t border-white/[0.08] px-3 pt-2 text-[10px] font-medium text-white/35">
              Acesso administrativo pelo avatar.
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
