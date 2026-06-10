"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const AVATAR_SRC = "/images/avatar.png";

export default function AdminAvatarLogin() {
  const [isOpen, setIsOpen] = useState(false);
  const [imageHasError, setImageHasError] = useState(false);

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

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-red-500/35 bg-red-500/10 shadow-[0_0_18px_rgba(239,68,68,0.18)] transition hover:scale-105 hover:border-red-400/60"
        title="Área Admin"
        aria-label="Abrir área admin"
      >
        {!imageHasError ? (
          <img
            src={AVATAR_SRC}
            alt="Login Admin"
            className="h-full w-full object-cover"
            onError={() => setImageHasError(true)}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-sm">
            ⚙️
          </span>
        )}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center px-6 py-8">
          <button
            type="button"
            aria-label="Fechar área admin"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />

          <div className="relative w-full max-w-[620px] overflow-hidden rounded-[38px] border border-red-500/30 bg-[#05070a]/90 p-8 text-center shadow-[0_0_80px_rgba(239,68,68,0.35)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.25),transparent_42%),radial-gradient(circle_at_bottom,rgba(34,211,238,0.10),transparent_40%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_35%,rgba(255,255,255,0.03))]" />

            <div className="relative z-10">
              <div className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-red-400/45 bg-red-500/10 shadow-[0_0_45px_rgba(239,68,68,0.35)]">
                {!imageHasError ? (
                  <img
                    src={AVATAR_SRC}
                    alt="Avatar do criador"
                    className="h-full w-full object-cover"
                    onError={() => setImageHasError(true)}
                  />
                ) : (
                  <span className="text-4xl">⚙️</span>
                )}
              </div>

              <p className="mt-7 text-xs font-black uppercase tracking-[0.35em] text-red-300">
                Área restrita
              </p>

              <h2 className="mt-4 text-5xl font-black tracking-tight text-white md:text-6xl">
                Login do Criador
              </h2>

              <p className="mx-auto mt-5 max-w-[480px] text-base font-bold leading-relaxed text-white/55">
                Esta área é exclusiva para editar jogos, sagas, emblemas e
                próximas maestrias do projeto Rumo à Conquista.
              </p>

              <p className="mx-auto mt-3 max-w-[460px] text-sm font-bold leading-relaxed text-red-100/55">
                Se você não for o criador do site, não vai conseguir acessar sem
                usuário e senha.
              </p>

              <div className="mx-auto mt-8 grid max-w-[360px] gap-3">
                <Link
                  href="/admin/jogos"
                  className="rounded-2xl border border-red-400/40 bg-red-500/20 px-6 py-4 text-base font-black text-red-50 shadow-[0_0_28px_rgba(239,68,68,0.16)] transition hover:-translate-y-0.5 hover:bg-red-500/30"
                >
                  Entrar no Admin
                </Link>

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-black text-white/50 transition hover:bg-white/[0.07] hover:text-white/80"
                >
                  Voltar para o site
                </button>
              </div>

              <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.2em] text-white/25">
                Rabiisco · Rumo à Conquista
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
