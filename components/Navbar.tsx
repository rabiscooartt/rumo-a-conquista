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
          : "hidden h-8 w-[142px] items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-2.5 transition-colors focus-within:border-red-500/45 focus-within:ring-1 focus-within:ring-red-500/15 min-[1080px]:flex 2xl:w-[166px]"
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
  { label: "Biblioteca", adminLabel: "Jogos", href: "/biblioteca", adminHref: "/admin/jogos" },
  { label: "Atividade", href: "/atividade" },
  { label: "Emblemas", href: "/sagas" },
  { label: "Conteúdo", href: "/conteudo" },
  { label: "Reviews", href: "/reviews" },
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
            : "group relative flex min-h-9 items-center justify-center whitespace-nowrap rounded-md px-2 text-[clamp(11px,0.62vw,12px)] font-semibold uppercase tracking-[0.035em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 " +
              (active ? "text-red-400" : "text-white/75 hover:text-white")
        }
      >
        <span>{label}</span>
        {active && !mobile ? (
          <span className="pointer-events-none absolute -bottom-[5px] left-2 right-2 h-[2px] rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,.8)]" />
        ) : null}
      </Link>
    );
  }


  return (
    <header className="sticky top-0 z-50 isolate mx-auto mt-0 w-[84vw] max-w-[1620px] overflow-visible rounded-b-xl border border-t-0 border-white/10 bg-black shadow-[0_10px_32px_rgba(0,0,0,.48)] backdrop-blur-xl" style={{ width: "84vw", maxWidth: "1620px" }}>
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-b-xl" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(25,39,55,.30),transparent_68%)]" />
        <div className="absolute inset-y-0 left-0 w-[24%] bg-[linear-gradient(90deg,rgba(145,19,33,.11),transparent)]" />
        <div className="absolute inset-y-0 right-0 w-[24%] bg-[linear-gradient(270deg,rgba(145,19,33,.11),transparent)]" />
      </div>
      <div className="pointer-events-none absolute bottom-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-red-500/45 to-transparent" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-[48px] w-full max-w-[1300px] items-center gap-2 px-2.5 sm:px-3 min-[1080px]:gap-4 min-[1080px]:px-4 2xl:min-h-[52px]">
        <Link
          href="/"
          aria-label="Rumo à Conquista - Início"
          className="group flex h-[44px] w-[128px] shrink-0 flex-col items-center justify-center gap-[3px] rounded-sm text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 sm:w-[136px]"
        >
          <span className="font-serif text-[11px] font-semibold leading-none tracking-[0.15em] text-white/95 sm:text-[12px]">
            RUMO À
          </span>
          <span className="font-serif text-[14px] font-bold leading-none tracking-[0.055em] text-white sm:text-[15px]">
            CONQUISTA
          </span>
        </Link>

        <nav
          aria-label="Navegação principal"
          className="hidden shrink-0 items-center justify-start gap-1 min-[1080px]:flex"
        >
          {visibleLinks.map((link) => renderLink(link))}
        </nav>

        <div className="relative hidden shrink-0 items-center min-[1080px]:flex">
          <button
            type="button"
            onClick={() => { setIsMenuOpen(false); setIsAccountOpen(false); setIsSearchOpen((open) => !open); }}
            aria-label={isSearchOpen ? "Fechar busca" : "Abrir busca"}
            aria-expanded={isSearchOpen}
            className="flex h-9 w-9 items-center justify-center rounded-md text-white/65 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <SearchIcon className="h-[18px] w-[18px]" />
          </button>
          {isSearchOpen ? (
            <div className="absolute right-0 top-[calc(100%+12px)] z-[90] w-[250px] rounded-xl border border-white/10 bg-[#09090d]/[.98] p-2 shadow-[0_16px_48px_rgba(0,0,0,.62)] backdrop-blur-xl">
              <SearchForm compact value={searchQuery} onChange={setSearchQuery} />
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 min-[1080px]:gap-3">
          <button type="button" onClick={() => { setIsMenuOpen(false); setIsSearchOpen((open) => !open); }} aria-label={isSearchOpen ? "Fechar busca" : "Abrir busca"} aria-expanded={isSearchOpen} className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-black/30 text-white/70 transition hover:border-red-500/35 hover:bg-red-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 min-[1080px]:hidden">
            <SearchIcon className="h-4 w-4" />
          </button>
          <Link href="/atividade" aria-label="Ver atividade recente" title="Atividade recente" className="relative flex h-8 w-7 items-center justify-center rounded-md text-white/70 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
            <BellIcon className="h-[17px] w-[17px]" />
          </Link>
          <div className="flex items-center gap-0">
            <div className="scale-[0.88]"><AdminAvatarLogin showLabel={false} /></div>
            <div className="relative -ml-1">
              <button type="button" onClick={() => { setIsMenuOpen(false); setIsSearchOpen(false); setIsAccountOpen((open) => !open); }} aria-label="Abrir menu do perfil" aria-expanded={isAccountOpen} className="flex h-8 w-5 items-center justify-center rounded-md text-white/55 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
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
                    <p className="px-3 py-2 text-[10px] font-medium leading-relaxed text-white/35">Clique no avatar para acessar o modo administrador.</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={() => { setIsSearchOpen(false); setIsAccountOpen(false); setIsMenuOpen((open) => !open); }} aria-label={isMenuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={isMenuOpen} aria-controls="rac-mobile-navigation" className="flex h-8 w-8 items-center justify-center rounded-md border border-red-500/35 bg-red-500/[0.08] text-red-200 transition hover:border-red-400/60 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 min-[1080px]:hidden">
            {isMenuOpen ? <CloseIcon className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {isSearchOpen ? (
        <div className="relative z-10 mx-auto w-full px-3 pb-3 min-[1080px]:hidden">
          <SearchForm compact value={searchQuery} onChange={setSearchQuery} />
        </div>
      ) : null}
      <div id="rac-mobile-navigation" className={"relative z-10 mx-auto w-full px-3 pb-3 min-[1080px]:hidden " + (isMenuOpen ? "block" : "hidden")}>
        <div className="rounded-xl border border-white/10 bg-[#08090d]/95 p-2 shadow-[0_18px_45px_rgba(0,0,0,.56)] backdrop-blur-2xl">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {visibleLinks.map((link) => renderLink(link, true))}
          </div>
          {!isAdminMode ? (
            <div className="mt-2 border-t border-white/[0.08] px-3 pt-2 text-[10px] font-medium text-white/35">Acesso administrativo pelo avatar.</div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
