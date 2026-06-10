"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const OWNER_MODE_KEY = "rumo-a-conquista-owner-mode";

export default function AdminShortcutButton() {
  const [isOwnerMode, setIsOwnerMode] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
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
      setIsLoaded(true);
      return;
    }

    const savedOwnerMode = localStorage.getItem(OWNER_MODE_KEY) === "true";

    setIsOwnerMode(savedOwnerMode);
    setIsLoaded(true);
  }, []);

  if (!isLoaded || !isOwnerMode) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-[9999] w-[240px] rounded-3xl border border-red-500/35 bg-black/80 p-3 shadow-[0_0_35px_rgba(239,68,68,0.35)] backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚙️</span>

          <span className="text-sm font-black text-white">Admin</span>
        </div>

        <button
          type="button"
          onClick={() => {
            localStorage.removeItem(OWNER_MODE_KEY);
            setIsOwnerMode(false);
          }}
          className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white/35 transition hover:border-white/20 hover:text-white/70"
        >
          Ocultar
        </button>
      </div>

      <div className="grid gap-2">
        <Link
          href="/admin/backlog"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-2xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-3 text-sm font-black text-cyan-100 transition hover:-translate-y-0.5 hover:bg-cyan-500/25"
        >
          <span>💎 Maestrias</span>
          <span>↗</span>
        </Link>

        <Link
          href="/admin/jogos"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-2xl border border-red-500/30 bg-red-500/15 px-4 py-3 text-sm font-black text-red-100 transition hover:-translate-y-0.5 hover:bg-red-500/25"
        >
          <span>🎮 Jogos</span>
          <span>↗</span>
        </Link>

        <Link
          href="/admin/sagas"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-3 text-sm font-black text-emerald-100 transition hover:-translate-y-0.5 hover:bg-emerald-500/25"
        >
          <span>🛡️ Sagas</span>
          <span>↗</span>
        </Link>
      </div>
    </div>
  );
}