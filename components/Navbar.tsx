"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AdminAvatarLogin, {
  AUTH_CHANGED_EVENT,
  LOGOUT_EVENT,
  OPEN_LOGIN_EVENT,
} from "@/components/AdminAvatarLogin";

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

function MenuIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

const MOBILE_MENU_ID = "mobile-navigation-menu";

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
  // Guarda a rota em que o menu foi aberto: ao navegar, ele se fecha sozinho.
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const isMenuOpen = menuOpenedAt === pathname;
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!isMenuOpen) return;

    const menuButton = menuButtonRef.current;
    const panel = menuPanelRef.current;
    const previousOverflow = document.body.style.overflow;
    const desktopQuery = window.matchMedia("(min-width: 1024px)");

    function closeMenu() {
      setMenuOpenedAt(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }

      if (event.key !== "Tab" || !panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>("a[href], button");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    desktopQuery.addEventListener("change", closeMenu);
    panel?.querySelector<HTMLElement>("button")?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      desktopQuery.removeEventListener("change", closeMenu);
      // Não rouba o foco de quem já o recebeu, como o campo do login aberto pelo menu.
      if (document.activeElement === document.body) menuButton?.focus();
    };
  }, [isMenuOpen]);

  function isActiveLink(href: string) {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname.startsWith(href);
  }

  const visibleLinks = navLinks
    .filter((link) => (!("adminOnly" in link) || !link.adminOnly || isAdminMode) && (link.href !== "/backlog" || isAdminMode))
    .map((link) => ({
      ...link,
      targetHref: isAdminMode && link.adminHref ? link.adminHref : link.href,
      displayLabel: isAdminMode && link.href === "/backlog" ? "Editar Fila" : link.label,
    }));

  function handleMenuAuthAction() {
    setMenuOpenedAt(null);
    window.dispatchEvent(new Event(isAdminMode ? LOGOUT_EVENT : OPEN_LOGIN_EVENT));
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#05070a]/90 backdrop-blur-xl">
      <nav className="mx-auto flex h-[64px] w-full max-w-[1500px] items-center justify-between px-4 sm:px-5 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-400 shadow-[0_0_24px_rgba(239,68,68,0.12)]">
            <LogoTrophyIcon className="h-5 w-5" />
          </span>

          <span className="whitespace-nowrap text-lg font-black tracking-tight text-white sm:text-2xl">
            Rumo à <span className="text-red-500">Conquista</span>
          </span>
        </Link>

        <div className="hidden items-center gap-2.5 lg:flex xl:gap-3 2xl:gap-4">
          {visibleLinks.map((link) => {
            const targetHref = link.targetHref;
            const isActive = isActiveLink(targetHref);
            const Icon = link.icon;

            return (
              <Link
                key={link.label}
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

                <span className="whitespace-nowrap">{link.displayLabel}</span>

                <span
                  className={`absolute bottom-0 left-0 h-[3px] rounded-full bg-red-500 transition-all ${
                    isActive ? "w-full opacity-100" : "w-0 opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <AdminAvatarLogin showLabel labelDisplayClassName="hidden sm:inline-flex" />

          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpenedAt(pathname)}
            aria-label="Abrir menu"
            aria-haspopup="dialog"
            aria-expanded={isMenuOpen}
            aria-controls={MOBILE_MENU_ID}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/80 transition hover:border-red-500/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        </div>
      </nav>

      {/* Portal: o backdrop-blur do header limitaria um elemento fixed à altura da barra. */}
      {isMenuOpen ? createPortal(
        <div className="fixed inset-0 z-[9000] lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Fechar menu"
            onClick={() => setMenuOpenedAt(null)}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
          />

          <div
            ref={menuPanelRef}
            id={MOBILE_MENU_ID}
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            className="absolute inset-y-0 right-0 flex w-[min(84vw,320px)] flex-col overflow-y-auto border-l border-red-500/20 bg-[#080a0e] shadow-2xl"
          >
            <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-white/10 px-4">
              <span className="text-sm font-black uppercase tracking-[0.12em] text-white">Menu</span>
              <button
                type="button"
                onClick={() => setMenuOpenedAt(null)}
                aria-label="Fechar menu"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/80 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col gap-1 p-3">
              <button
                type="button"
                onClick={handleMenuAuthAction}
                className="mb-2 flex min-h-12 items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-red-300 transition hover:border-red-400/50 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <span aria-hidden="true" className="text-sm leading-none">{isAdminMode ? "↪" : "↳"}</span>
                {isAdminMode ? "Sair" : "Entrar"}
              </button>

              {visibleLinks.map((link) => {
                const isActive = isActiveLink(link.targetHref);
                const Icon = link.icon;

                return (
                  <Link
                    key={link.label}
                    href={link.targetHref}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setMenuOpenedAt(null)}
                    className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                      isActive
                        ? "border-red-500/30 bg-red-500/10 text-red-300"
                        : "border-transparent text-white/75 hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-red-400" : "text-white/55"}`} />
                    {link.displayLabel}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </header>
  );
}
