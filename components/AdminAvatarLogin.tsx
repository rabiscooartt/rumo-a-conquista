"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

const OWNER_MODE_KEY = "rumo-a-conquista-owner-mode";
const AVATAR_SRC = "/images/avatar.png";

export default function AdminAvatarLogin() {
  const [isOwnerMode, setIsOwnerMode] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [imageHasError, setImageHasError] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    const searchParams = new URLSearchParams(window.location.search);
    const adminParam = searchParams.get("admin");

    if (adminParam === "1") {
      localStorage.setItem(OWNER_MODE_KEY, "true");
      setIsOwnerMode(true);
      setIsLoaded(true);
      return;
    }

    if (adminParam === "0") {
      localStorage.removeItem(OWNER_MODE_KEY);
      setIsOwnerMode(false);
      setIsOpen(false);
      setIsLoaded(true);
      return;
    }

    const savedOwnerMode = localStorage.getItem(OWNER_MODE_KEY) === "true";

    setIsOwnerMode(savedOwnerMode);
    setIsLoaded(true);
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

  function disableAdminClick() {
    localStorage.removeItem(OWNER_MODE_KEY);
    setIsOwnerMode(false);
    setIsOpen(false);
  }

  function AvatarImage() {
    if (!imageHasError) {
      return (
        <img
          src={AVATAR_SRC}
          alt="Avatar Rabiisco"
          className="h-full w-full object-cover"
          onError={() => setImageHasError(true)}
        />
      );
    }

    return (
      <span className="flex h-full w-full items-center justify-center text-sm">
        ⚙️
      </span>
    );
  }

  const modal =
    isMounted && isOpen
      ? createPortal(
          <div className="fixed inset-0 z-[999999] flex min-h-screen items-center justify-center overflow-y-auto px-6 py-10">
            <button
              type="button"
              aria-label="Fechar área admin"
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-lg"
            />

            <div className="relative z-10 w-full max-w-[660px] overflow-hidden rounded-[38px] border border-red-500/30 bg-[#05070a]/95 p-8 text-center shadow-[0_0_90px_rgba(239,68,68,0.42)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.25),transparent_42%),radial-gradient(circle_at_bottom,rgba(34,211,238,0.10),transparent_40%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_35%,rgba(255,255,255,0.03))]" />

              <div className="relative z-10">
                <div className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-red-400/45 bg-red-500/10 shadow-[0_0_45px_rgba(239,68,68,0.35)]">
                  <AvatarImage />
                </div>

                <p className="mt-7 text-xs font-black uppercase tracking-[0.35em] text-red-300">
                  Área do criador
                </p>

                <h2 className="mt-4 text-5xl font-black tracking-tight text-white md:text-6xl">
                  Painel Admin
                </h2>

                <p className="mx-auto mt-5 max-w-[500px] text-base font-bold leading-relaxed text-white/55">
                  Atalho privado para editar jogos, emblemas e próximas
                  maestrias do projeto Rumo à Conquista.
                </p>

                <div className="mx-auto mt-6 max-w-[500px] rounded-2xl border border-yellow-400/20 bg-yellow-500/[0.07] px-5 py-4 text-left">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-yellow-200/80">
                    Dica rápida
                  </p>

                  <p className="mt-2 text-xs font-bold leading-relaxed text-yellow-50/60">
                    O avatar só abre este painel neste navegador porque o modo
                    dono está ativado. Para deixar o avatar visível, mas sem
                    clique de Admin, use{" "}
                    <span className="font-black text-yellow-100">
                      Desativar clique Admin
                    </span>
                    . Para ativar novamente, abra o site usando{" "}
                    <span className="font-black text-white">?admin=1</span>.
                  </p>
                </div>

                <div className="mx-auto mt-8 grid max-w-[390px] gap-3">
                  <Link
                    href="/admin/jogos"
                    className="rounded-2xl border border-red-400/40 bg-red-500/20 px-6 py-4 text-base font-black text-red-50 shadow-[0_0_28px_rgba(239,68,68,0.16)] transition hover:-translate-y-0.5 hover:bg-red-500/30"
                  >
                    Entrar no Admin
                  </Link>

                  <Link
                    href="/admin/backlog"
                    className="rounded-2xl border border-cyan-400/35 bg-cyan-500/15 px-6 py-4 text-base font-black text-cyan-50 transition hover:-translate-y-0.5 hover:bg-cyan-500/25"
                  >
                    Editar Próximas Maestrias
                  </Link>

                  <button
                    type="button"
                    onClick={disableAdminClick}
                    className="rounded-2xl border border-yellow-400/25 bg-yellow-500/10 px-6 py-3 text-sm font-black text-yellow-100/80 transition hover:bg-yellow-500/20 hover:text-yellow-50"
                  >
                    Desativar clique Admin
                  </button>

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
          </div>,
          document.body
        )
      : null;

  if (!isLoaded) {
    return null;
  }

  if (!isOwnerMode) {
    return (
      <div
        className="flex h-10 w-10 cursor-default items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.035] opacity-75"
        title="Rabiisco"
        aria-label="Avatar Rabiisco"
      >
        <AvatarImage />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-red-500/35 bg-red-500/10 shadow-[0_0_18px_rgba(239,68,68,0.18)] transition hover:scale-105 hover:border-red-400/60"
        title="Área Admin"
        aria-label="Abrir área admin"
      >
        <AvatarImage />
      </button>

      {modal}
    </>
  );
}
