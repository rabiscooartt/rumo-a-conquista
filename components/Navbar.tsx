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



function BrandCrest({ className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className} fill="none">
      <path d="M17 16C9 22 7 33 14 44M47 16c8 6 10 17 3 28M21 12C12 14 7 23 9 32M43 12c9 2 14 11 12 20M19 46l-4 5M45 46l4 5" stroke="#E64A57" strokeWidth="2.1" strokeLinecap="round" />
      <path d="m32 4 5 7 8-2-2 10H21L19 9l8 2 5-7Z" fill="#D82E40" stroke="#FF8992" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M20 23h24v18c0 8-5.4 14-12 14s-12-6-12-14V23Z" fill="#941526" stroke="#F16B76" strokeWidth="1.8" />
      <path d="M20 27h-7c0 8 3 13 10 14M44 27h7c0 8-3 13-10 14" stroke="#F16B76" strokeWidth="2" strokeLinecap="round" />
      <path d="m32 27 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L32 27Z" fill="#FFD4A3" />
    </svg>
  );
}

function GamepadIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><path d="M7.5 18h9a4.5 4.5 0 0 0 4.4-5.4l-.7-4A4 4 0 0 0 16.3 5H7.7a4 4 0 0 0-3.9 3.6l-.7 4A4.5 4.5 0 0 0 7.5 18Z" /><path d="M8 10v4M6 12h4M15.5 11.5h.01M18 14h.01" /></IconBase>;
}

function ProfileIcon({ className = "" }: IconProps) {
  return <IconBase className={className}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.3 3.1-5 7-5s6.2 1.7 7 5" /></IconBase>;
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
          ? "flex h-9 w-full items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-3 focus-within:border-red-500/50 focus-within:ring-1 focus-within:ring-red-500/20"
          : "hidden h-9 w-[158px] items-center gap-2 rounded-lg border border-white/15 bg-black/55 px-3 transition-colors focus-within:border-red-500/55 focus-within:ring-1 focus-within:ring-red-500/20 min-[1200px]:flex 2xl:w-[176px]"
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
  { label: "Início", href: "/" },
  { label: "Perfil", href: "/perfil" },
  { label: "Biblioteca", adminLabel: "Jogos", href: "/biblioteca", adminHref: "/admin/jogos" },
  { label: "Atividade", href: "/atividade" },
  { label: "Emblemas", href: "/sagas" },
  { label: "Conteúdo", href: "/conteudo" },
  { label: "Reviews", href: "/reviews" },
  { label: "Histórico", href: "/historico" },
  { label: "Banco de Jogos", href: "/admin/sorteio-jogos", adminOnly: true },
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
    const targetHref = "adminHref" in link && isAdminMode && link.adminHref ? link.adminHref : link.href;
    const label = "adminLabel" in link && isAdminMode && link.adminLabel ? link.adminLabel : link.label;
    const active = isActiveLink(targetHref);
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
            ? "group flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 " +
              (active ? "border-red-500/35 bg-red-500/12 text-white" : "border-transparent text-white/75 hover:border-white/10 hover:bg-white/[0.04] hover:text-white")
            : "group relative flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg border px-2 text-[10px] font-bold tracking-[0.015em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 xl:px-2.5 xl:text-[11px] 2xl:px-3 2xl:text-[12px] " +
              (active ? "border-red-500/55 bg-[linear-gradient(180deg,rgba(139,25,38,.88),rgba(67,10,20,.84))] text-white shadow-[inset_0_0_16px_rgba(239,35,52,.15),0_0_16px_rgba(239,35,52,.12)]" : "border-transparent text-white/80 hover:border-white/15 hover:bg-white/[0.06] hover:text-white")
        }
      >
        <span>{label}</span>
        {active && !mobile ? (
          <span className="pointer-events-none absolute -bottom-[6px] left-2 right-2 h-[2px] rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,.8)]" />
        ) : null}
      </Link>
    );
  }


  return (
    <header className="sticky top-0 z-50 isolate mx-auto mt-0 w-[calc(100%-16px)] max-w-[1620px] overflow-visible rounded-b-xl border border-t-0 border-red-500/30 bg-[#03050a]/75 shadow-[0_10px_34px_rgba(0,0,0,.48)] backdrop-blur-xl sm:w-[calc(100%-28px)] min-[1200px]:w-[84vw]">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-b-xl" aria-hidden="true">
        <div className="absolute inset-0 bg-[url('/images/backgrounds/rabiisco-global-bg.webp')] bg-cover bg-[center_38%] opacity-80" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,3,6,.76)_0%,rgba(4,4,7,.39)_38%,rgba(4,4,7,.39)_70%,rgba(2,3,6,.76)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,4,8,.12),rgba(3,4,7,.56))]" />
        <div className="absolute inset-y-0 left-0 w-[22%] bg-[radial-gradient(ellipse_at_left,rgba(181,25,43,.28),transparent_78%)]" />
        <div className="absolute inset-y-0 right-0 w-[22%] bg-[radial-gradient(ellipse_at_right,rgba(181,25,43,.25),transparent_78%)]" />
      </div>
      <div className="pointer-events-none absolute bottom-0 left-3 right-3 z-20 h-px bg-gradient-to-r from-transparent via-red-500/75 to-transparent" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-[62px] w-full items-center gap-1 px-1.5 sm:min-h-[66px] sm:gap-2.5 sm:px-4 min-[1200px]:min-h-[70px] min-[1200px]:gap-3 min-[1200px]:px-4 2xl:px-5">
        <Link
          href="/"
          aria-label="Rumo à Conquista - Início"
          className="group flex h-[48px] w-[150px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 sm:h-[52px] sm:w-[190px] sm:gap-2.5"
        >
          <BrandCrest className="h-[38px] w-[38px] shrink-0 drop-shadow-[0_0_9px_rgba(220,38,55,.32)] sm:h-[46px] sm:w-[46px]" />
          <span className="whitespace-nowrap font-serif text-[9px] font-black leading-none tracking-[0.015em] text-white sm:text-[13px] sm:tracking-[0.025em] 2xl:text-[14px]">
            RUMO À <span className="text-red-400">CONQUISTA</span>
          </span>
        </Link>

        <div className="hidden h-10 w-px shrink-0 bg-white/25 min-[1200px]:block" />

        <nav
          aria-label="Navegação principal"
          className="hidden min-w-0 flex-1 items-center justify-between gap-1 min-[1200px]:flex"
        >
          {visibleLinks.map((link) => renderLink(link))}
        </nav>

        <div className="ml-auto hidden shrink-0 items-center min-[1200px]:ml-0 min-[1200px]:flex">
          <SearchForm value={searchQuery} onChange={setSearchQuery} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 min-[1200px]:ml-0 min-[1200px]:gap-2.5">
          <button
            type="button"
            onClick={() => { setIsMenuOpen(false); setIsSearchOpen((open) => !open); }}
            aria-label={isSearchOpen ? "Fechar busca" : "Abrir busca"}
            aria-expanded={isSearchOpen}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-black/35 text-white/75 transition hover:border-red-500/45 hover:bg-red-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 min-[1200px]:hidden"
          >
            <SearchIcon className="h-[17px] w-[17px]" />
          </button>

          <Link
            href="/atividade"
            aria-label="Ver atividade recente"
            title="Atividade recente"
            className="relative flex h-8 w-7 items-center justify-center rounded-lg text-white/75 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 min-[1200px]:h-9 min-[1200px]:w-8"
          >
            <BellIcon className="h-[18px] w-[18px]" />
          </Link>

          <div className="flex items-center gap-0">
            <div className="scale-[0.82] min-[1200px]:scale-[0.92]">
              <AdminAvatarLogin showLabel={false} />
            </div>
            <div className="relative -ml-1">
              <button
                type="button"
                onClick={() => { setIsMenuOpen(false); setIsSearchOpen(false); setIsAccountOpen((open) => !open); }}
                aria-label="Abrir menu do perfil"
                aria-expanded={isAccountOpen}
                className="flex h-8 w-4 items-center justify-center rounded-md text-white/60 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 min-[1200px]:h-9 min-[1200px]:w-5"
              >
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
              {isAccountOpen ? (
                <div className="absolute right-0 top-[calc(100%+10px)] z-[80] w-56 overflow-hidden rounded-xl border border-white/10 bg-[#09090d]/[.98] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,.62)] backdrop-blur-xl">
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
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/35 bg-red-500/[0.10] text-red-200 transition hover:border-red-400/60 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 min-[1200px]:hidden"
          >
            {isMenuOpen ? <CloseIcon className="h-[17px] w-[17px]" /> : <MenuIcon className="h-[17px] w-[17px]" />}
          </button>
        </div>
      </div>

      {isSearchOpen ? (
        <div className="relative z-10 mx-auto w-full px-3 pb-3 min-[1200px]:hidden">
          <SearchForm compact value={searchQuery} onChange={setSearchQuery} />
        </div>
      ) : null}

      <div
        id="rac-mobile-navigation"
        className={"relative z-10 mx-auto w-full px-3 pb-3 min-[1200px]:hidden " + (isMenuOpen ? "block" : "hidden")}
      >
        <div className="rounded-xl border border-white/10 bg-[#08090d]/95 p-2 shadow-[0_18px_45px_rgba(0,0,0,.56)] backdrop-blur-2xl">
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
