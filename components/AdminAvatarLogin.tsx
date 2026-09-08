"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const AVATAR_SRC = "/images/avatar.png";
const AUTH_CHANGED_EVENT = "rumo-admin-auth-changed";
const OPEN_LOGIN_EVENT = "rumo-admin-open-login";

export { AUTH_CHANGED_EVENT, OPEN_LOGIN_EVENT };

type AdminAvatarLoginProps = {
  showLabel?: boolean;
};

export default function AdminAvatarLogin({
  showLabel = false,
}: AdminAvatarLoginProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loginNext, setLoginNext] = useState("");

  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [imageHasError, setImageHasError] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function refreshStatus() {
    try {
      const response = await fetch("/api/admin/auth/status", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as { authenticated?: boolean };
      setIsAuthenticated(data.authenticated === true);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoaded(true);
    }
  }

  useEffect(() => {
    void refreshStatus();

    function handleAuthChanged() {
      void refreshStatus();
    }

    function handleOpenLogin() {
      setError("");
      setIsOpen(true);
    }

    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    window.addEventListener(OPEN_LOGIN_EVENT, handleOpenLogin);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
      window.removeEventListener(OPEN_LOGIN_EVENT, handleOpenLogin);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("adminLogin") !== "1") return;

    setLoginNext(params.get("next") || "");
    setError("");
    setIsOpen(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  function closeLogin() {
    setIsOpen(false);
    setError("");
    setPassword("");

    const params = new URLSearchParams(window.location.search);
    if (params.get("adminLogin") === "1") {
      setLoginNext("");
      router.replace(pathname);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        setError(data.error || "Usuário ou senha inválidos.");
        return;
      }

      setIsAuthenticated(true);
      setIsOpen(false);
      setPassword("");
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));

      if (loginNext && loginNext.startsWith("/admin")) {
        router.push(loginNext);
      } else {
        const params = new URLSearchParams(window.location.search);
        if (params.get("adminLogin") === "1") {
          router.replace(pathname);
        }
      }
    } catch {
      setError("Não foi possível realizar o login.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setIsSubmitting(true);

    try {
      await fetch("/api/admin/auth/logout", {
        method: "POST",
        cache: "no-store",
      });
    } finally {
      setIsAuthenticated(false);
      setIsSubmitting(false);
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      router.refresh();
    }
  }

  if (!isLoaded) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (isAuthenticated) {
            void handleLogout();
          } else {
            setError("");
            setIsOpen(true);
          }
        }}
        disabled={isSubmitting}
        className={
          showLabel
            ? "inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-red-300 transition hover:border-red-400/50 hover:bg-red-500/15 disabled:cursor-wait disabled:opacity-60"
            : "flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-red-500/35 bg-red-500/10 shadow-[0_0_18px_rgba(239,68,68,0.18)] transition hover:scale-105 hover:border-red-400/60 disabled:cursor-wait disabled:opacity-60"
        }
        title={isAuthenticated ? "Sair do modo Admin" : "Entrar no modo Admin"}
        aria-label={isAuthenticated ? "Sair do modo Admin" : "Entrar no modo Admin"}
      >
        {!showLabel ? (
          !imageHasError ? (
            <img
              src={AVATAR_SRC}
              alt={isAuthenticated ? "Admin ativo" : "Login Admin"}
              className="h-full w-full object-cover"
              onError={() => setImageHasError(true)}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm">
              ⚙️
            </span>
          )
        ) : (
          <>
            <span className="text-sm leading-none">{isAuthenticated ? "↪" : "↳"}</span>
            <span>{isAuthenticated ? "Sair" : "Entrar"}</span>
          </>
        )}
      </button>

      {isOpen && !isAuthenticated ? (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center px-6 py-8">
          <button
            type="button"
            aria-label="Fechar login"
            onClick={closeLogin}
            className="absolute inset-0 bg-black/65 backdrop-blur-md"
          />

          <form
            onSubmit={handleLogin}
            className="relative z-10 w-full max-w-[380px] rounded-[28px] border border-red-500/25 bg-[#090b0f] p-6 shadow-[0_0_50px_rgba(239,68,68,0.18)]"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-red-300">
              Área restrita
            </p>

            <h2 className="mt-2 text-2xl font-black text-white">
              Entrar no Admin
            </h2>

            <p className="mt-2 text-xs font-bold leading-relaxed text-white/45">
              Acesso exclusivo para o criador do Rumo à Conquista.
            </p>

            <div className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.12em] text-white/40">
                  Usuário
                </span>
                <input
                  autoFocus
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                  autoComplete="username"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-semibold text-white outline-none focus:border-red-500/40"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.12em] text-white/40">
                  Senha
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-semibold text-white outline-none focus:border-red-500/40"
                />
              </label>
            </div>

            {error ? (
              <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">
                {error}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={closeLogin}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black text-white/45 transition hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-xl bg-red-600 px-4 py-3 text-xs font-black text-white transition hover:bg-red-500 disabled:cursor-wait disabled:opacity-60"
              >
                {isSubmitting ? "Entrando..." : "Entrar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
