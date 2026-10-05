"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBannerSettings } from "@/components/BannerSettingsProvider";
import type { SiteBannerKey, SiteBannerSetting } from "@/lib/site-banner-settings";



type Props = {
  bannerKey: SiteBannerKey;
  imageUrl: string;
  className?: string;
  adminButtonClassName?: string;
};

export default function BannerBackground({
  bannerKey,
  imageUrl,
  className = "",
  adminButtonClassName = "",
}: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const { setting: initialSettings, update: updateSharedSettings } =
    useBannerSettings(bannerKey);
  const [settings, setSettings] = useState<SiteBannerSetting>(initialSettings);
  const [draft, setDraft] = useState<SiteBannerSetting>(initialSettings);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/banner-settings?banner=${encodeURIComponent(bannerKey)}`,
        { method: "GET", cache: "no-store" }
      );

      if (!response.ok) return;

      const data = (await response.json()) as Partial<BannerSettings> & {
        authenticated?: boolean;
      };

      setIsAdmin(data.authenticated === true);
      setIsAdmin(data.authenticated === true);
    } catch {
      // A posição inicial já veio do servidor; falha aqui só afeta a UI do Admin.
    }
    }
  }, [bannerKey]);

  useEffect(() => {
    setSettings(initialSettings);
    setDraft(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    function handleAuthChanged() {
      void loadSettings();
    }

    window.addEventListener("rumo-admin-auth-changed", handleAuthChanged);
    return () =>
      window.removeEventListener("rumo-admin-auth-changed", handleAuthChanged);
  }, [loadSettings]);

  function startDrag(clientX: number, clientY: number) {
    if (!isAdmin || !isOpen || !editorRef.current) return;

    draggingRef.current = true;
    lastPointerRef.current = { x: clientX, y: clientY };
  }

  function moveDrag(clientX: number, clientY: number) {
    if (!draggingRef.current || !editorRef.current) return;

    const rect = editorRef.current.getBoundingClientRect();
    const deltaX = ((clientX - lastPointerRef.current.x) / rect.width) * 100;
    const deltaY = ((clientY - lastPointerRef.current.y) / rect.height) * 100;

    lastPointerRef.current = { x: clientX, y: clientY };

    setDraft((current) => ({
      ...current,
      x: Math.max(-50, Math.min(50, current.x + deltaX)),
      y: Math.max(-50, Math.min(50, current.y + deltaY)),
    }));
  }

  function stopDrag() {
    draggingRef.current = false;
  }

  async function save() {
    setIsSaving(true);
    setError("");

    try {
      const response = await fetch("/api/admin/banner-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          banner: bannerKey,
          x: draft.x,
          y: draft.y,
          zoom: draft.zoom,
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(data?.error || "Não foi possível salvar a posição.");
      }

      setSettings(draft);
      updateSharedSettings(draft);
      setIsOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar a posição."
      );
    } finally {
      setIsSaving(false);
    }
  }

  function reset() {
    setDraft(initialSettings);
  }

  const visibleSettings = isOpen && isAdmin ? draft : settings;

  return (
    <>
      <div
        className={`absolute inset-0 overflow-hidden ${className}`}
        aria-hidden="true"
      >
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          fetchPriority="high"
          loading="eager"
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            width: `${visibleSettings.zoom * 100}%`,
            left: `${50 + visibleSettings.x}%`,
            top: `${50 + visibleSettings.y}%`,
            transform: "translate(-50%, -50%)",

          }}
        />
      </div>

      {isAdmin ? (
        <div className={`absolute right-4 top-4 z-30 ${adminButtonClassName}`}>
          {!isOpen ? (
            <button
              type="button"
              onClick={() => {
                setDraft(settings);
                setIsOpen(true);
                setError("");
              }}
              className="rounded-lg border border-white/15 bg-black/70 px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-white/80 shadow-lg backdrop-blur-md transition hover:border-red-500/40 hover:bg-red-500/15 hover:text-white"
            >
              ✎ Ajustar BG
            </button>
          ) : null}
        </div>
      ) : null}

      {isAdmin && isOpen ? (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[900px] rounded-2xl border border-red-500/25 bg-[#080a0e]/95 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-red-400">
                  Editor de BG · {bannerKey}
                </p>
                <p className="mt-1 text-[10px] text-white/40">
                  Arraste a imagem diretamente na prévia. A posição salva será usada no banner público.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-white/55 hover:text-white"
                >
                  Resetar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(settings);
                    setIsOpen(false);
                    setError("");
                  }}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-white/55 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={isSaving}
                  className="rounded-lg border border-red-500/35 bg-red-500/15 px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-red-100 disabled:opacity-50"
                >
                  {isSaving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>

            <div
              ref={editorRef}
              className="relative mt-4 aspect-[4/1] cursor-grab overflow-hidden rounded-lg border border-white/10 bg-black active:cursor-grabbing"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                startDrag(event.clientX, event.clientY);
              }}
              onPointerMove={(event) =>
                moveDrag(event.clientX, event.clientY)
              }
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
              onPointerLeave={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                  stopDrag();
                }
              }}
            >
              <img
                src={imageUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  width: `${draft.zoom * 100}%`,
                  left: `${50 + draft.x}%`,
                  top: `${50 + draft.y}%`,
                  transform: "translate(-50%, -50%)",
                }}
              />

              <div className="pointer-events-none absolute inset-0 border border-white/10" />
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-white/10" />
              <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-white/10" />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="text-[8px] font-black uppercase tracking-[0.14em] text-white/35">
                  Horizontal
                </span>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  step="1"
                  value={draft.x}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      x: Number(event.target.value),
                    }))
                  }
                  className="mt-2 w-full accent-red-500"
                />
              </label>

              <label className="block">
                <span className="text-[8px] font-black uppercase tracking-[0.14em] text-white/35">
                  Vertical
                </span>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  step="1"
                  value={draft.y}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      y: Number(event.target.value),
                    }))
                  }
                  className="mt-2 w-full accent-red-500"
                />
              </label>

              <label className="block">
                <span className="text-[8px] font-black uppercase tracking-[0.14em] text-white/35">
                  Zoom
                </span>
                <input
                  type="range"
                  min="0.8"
                  max="2"
                  step="0.01"
                  value={draft.zoom}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      zoom: Number(event.target.value),
                    }))
                  }
                  className="mt-2 w-full accent-red-500"
                />
              </label>
            </div>

            {error ? (
              <p className="mt-2 text-[9px] font-bold text-red-300">{error}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
