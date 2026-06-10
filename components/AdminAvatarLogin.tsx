"use client";

import { useState } from "react";
import Link from "next/link";

const AVATAR_SRC = "/images/avatar.png";

export default function AdminAvatarLogin() {
  const [isOpen, setIsOpen] = useState(false);
  const [imageHasError, setImageHasError] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
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
        <div className="absolute right-0 top-12 z-[9999] w-[270px] rounded-3xl border border-red-500/30 bg-black/90 p-4 shadow-[0_0_35px_rgba(239,68,68,0.28)] backdrop-blur-xl">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-red-300">
            Área restrita
          </p>

          <h3 className="mt-2 text-lg font-black text-white">
            Login do criador
          </h3>

          <p className="mt-2 text-xs font-bold leading-relaxed text-white/50">
            Esta área é exclusiva para editar jogos, sagas e próximas
            maestrias. Apenas quem tem usuário e senha consegue entrar.
          </p>

          <div className="mt-4 grid gap-2">
            <Link
              href="/admin/jogos"
              className="rounded-2xl border border-red-500/35 bg-red-500/15 px-4 py-3 text-center text-sm font-black text-red-100 transition hover:bg-red-500/25"
            >
              Entrar no Admin
            </Link>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-black text-white/45 transition hover:text-white/75"
            >
              Fechar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
