"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBannerSettings } from "@/components/BannerSettingsProvider";
import type { SiteBannerKey, SiteBannerSetting } from "@/lib/banner-types";

type Props = {
  bannerKey: SiteBannerKey;
  imageUrl: string;
  className?: string;
  adminButtonClassName?: string;
};

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export default function BannerBackground({
  bannerKey,
  imageUrl,
  className = "",
  adminButtonClassName = "",
}: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const bannerHostRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const { setting: initialSettings, update: updateSharedSettings } =
    useBannerSettings(bannerKey);
  const isEmblemsBanner = bannerKey === "emblemas";
  const [settings, setSettings] = useState<SiteBannerSetting>(initialSettings);
  const [draft, setDraft] = useState<SiteBannerSetting>(initialSettings);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState("");
  const [restoreDefaultRequested, setRestoreDefaultRequested] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState(6.5);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const updatePreviewAspectRatio = useCallback(() => {
    const banner = bannerHostRef.current?.parentElement;
    if (!banner) return;

    const rect = banner.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setPreviewAspectRatio(rect.width / rect.height);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !isEmblemsBanner) return;

    updatePreviewAspectRatio();
    const banner = bannerHostRef.current?.parentElement;
    if (!banner) return;

    const observer = new ResizeObserver(updatePreviewAspectRatio);
    observer.observe(banner);
    window.addEventListener("resize", updatePreviewAspectRatio);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePreviewAspectRatio);
    };
  }, [bannerKey, isEmblemsBanner, isOpen, updatePreviewAspectRatio]);

  useEffect(() => {
    if (!selectedImageFile) {
      setSelectedImagePreview("");
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImageFile);
    setSelectedImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImageFile]);

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/banner-settings?banner=${encodeURIComponent(bannerKey)}`,
        { method: "GET", cache: "no-store" }
      );

      if (!response.ok) return;

      const data = (await response.json()) as {
        x?: number;
        y?: number;
        zoom?: number;
        imageUrl?: string;
        authenticated?: boolean;
      };

      const loaded: SiteBannerSetting = {
        x: Number.isFinite(Number(data.x)) ? Number(data.x) : initialSettings.x,
        y: Number.isFinite(Number(data.y)) ? Number(data.y) : initialSettings.y,
        zoom:
          Number.isFinite(Number(data.zoom)) && Number(data.zoom) > 0
            ? isEmblemsBanner
              ? Math.max(1, Math.min(2, Number(data.zoom)))
              : Number(data.zoom)
            : isEmblemsBanner
              ? Math.max(1, initialSettings.zoom)
              : initialSettings.zoom,
        imageUrl:
          typeof data.imageUrl === "string"
            ? data.imageUrl
            : initialSettings.imageUrl,
      };

      setIsAdmin(data.authenticated === true);
      setSettings(loaded);
      setDraft(loaded);
    } catch {
      // The page keeps the default image if the settings endpoint is unavailable.
    }
  }, [bannerKey, initialSettings]);

  useEffect(() => {
    setSettings(initialSettings);
    setDraft(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    void loadSettings();

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

  function handleImageSelection(file: File | undefined) {
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError("Use uma imagem PNG, JPG ou WEBP.");
      return;
    }

    if (file.size <= 0 || file.size > MAX_IMAGE_SIZE) {
      setError("A imagem precisa ter até 4 MB.");
      return;
    }

    setSelectedImageFile(file);
    setRestoreDefaultRequested(false);
    setError("");
  }

  async function save() {
    setIsSaving(true);
    setError("");

    try {
      let requestBody: BodyInit;
      const headers: Record<string, string> = {};

      if (selectedImageFile) {
        const formData = new FormData();
        formData.set("banner", bannerKey);
        formData.set("x", String(draft.x));
        formData.set("y", String(draft.y));
        formData.set("zoom", String(draft.zoom));
        formData.set("resetImage", String(restoreDefaultRequested));
        formData.set("file", selectedImageFile);
        requestBody = formData;
      } else {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify({
          banner: bannerKey,
          x: draft.x,
          y: draft.y,
          zoom: draft.zoom,
          resetImage: restoreDefaultRequested,
        });
      }

      const response = await fetch("/api/admin/banner-settings", {
        method: "POST",
        headers,
        body: requestBody,
      });

      const data = (await response.json().catch(() => null)) as {
        error?: string;
        imageUrl?: string;
      } | null;

      if (!response.ok) {
        throw new Error(data?.error || "Não foi possível salvar o banner.");
      }

      const savedSettings: SiteBannerSetting = {
        ...draft,
        imageUrl:
          typeof data?.imageUrl === "string"
            ? data.imageUrl
            : settings.imageUrl,
      };

      setSettings(savedSettings);
      setDraft(savedSettings);
      updateSharedSettings(savedSettings);
      setSelectedImageFile(null);
      setRestoreDefaultRequested(false);
      setIsOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar o banner."
      );
    } finally {
      setIsSaving(false);
    }
  }

  function reset() {
    setDraft(initialSettings);
    setError("");
  }

  const visibleSettings = isOpen && isAdmin ? draft : settings;
  const visibleImageUrl =
    selectedImagePreview ||
    (!restoreDefaultRequested ? visibleSettings.imageUrl : "") ||
    imageUrl;

  return (
    <>
      <div
        ref={bannerHostRef}
        className={`absolute inset-0 overflow-hidden ${className}`}
        aria-hidden="true"
      >
        <img
          src={visibleImageUrl}
          alt=""
          draggable={false}
          fetchPriority="high"
          loading="eager"
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            width: `${(isEmblemsBanner ? Math.max(1, visibleSettings.zoom) : visibleSettings.zoom) * 100}%`,
            height: isEmblemsBanner
              ? `${Math.max(1, visibleSettings.zoom) * 100}%`
              : undefined,
            objectFit: isEmblemsBanner ? "cover" : undefined,
            objectPosition: isEmblemsBanner ? "center top" : undefined,
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
                setSelectedImageFile(null);
                setRestoreDefaultRequested(false);
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

      {isAdmin && isOpen && portalTarget ? createPortal((
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[1120px] rounded-2xl border border-red-500/25 bg-[#080a0e]/95 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-red-400">
                  Editor de BG · {bannerKey}
                </p>
                <p className="mt-1 text-[10px] text-white/40">
                  A prévia usa a mesma proporção do banner real desta aba. Carregue a imagem, arraste e ajuste o zoom; o resultado será o mesmo no site.
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/35 bg-red-500/15 px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-red-100 transition hover:bg-red-500/25">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      disabled={isSaving}
                      onChange={(event) => {
                        handleImageSelection(event.currentTarget.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                    <span aria-hidden="true">↑</span>
                    Carregar imagem
                  </label>
                  <span className="max-w-full truncate text-[9px] text-white/40">
                    {selectedImageFile
                      ? selectedImageFile.name
                      : restoreDefaultRequested
                        ? "A imagem padrão será usada ao salvar"
                        : settings.imageUrl
                          ? "Imagem personalizada ativa"
                          : "Imagem padrão do site"}{" "}
                    · PNG/JPG/WEBP · até 4 MB
                  </span>
                  {settings.imageUrl && !restoreDefaultRequested ? (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        setSelectedImageFile(null);
                        setRestoreDefaultRequested(true);
                        setDraft({ x: 0, y: 0, zoom: 1, imageUrl: "" });
                        setError("");
                      }}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] font-black uppercase tracking-[0.08em] text-white/65 transition hover:border-red-500/35 hover:text-white disabled:opacity-50"
                    >
                      Usar imagem padrão
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-white/55 hover:text-white"
                >
                  Resetar posição
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(settings);
                    setSelectedImageFile(null);
                    setRestoreDefaultRequested(false);
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
                  {isSaving
                    ? selectedImageFile
                      ? "Enviando imagem..."
                      : "Salvando..."
                    : "Salvar"}
                </button>
              </div>
            </div>

            {selectedImageFile ? (
              <div className="mt-3 overflow-hidden rounded-lg border border-emerald-400/20 bg-emerald-500/[0.05] px-3 py-2 text-[10px] text-emerald-100/80">
                A nova imagem está na prévia. Clique em <strong>Salvar</strong> para publicar o arquivo permanentemente.
              </div>
            ) : null}
            {restoreDefaultRequested ? (
              <div className="mt-3 overflow-hidden rounded-lg border border-amber-400/20 bg-amber-500/[0.05] px-3 py-2 text-[10px] text-amber-100/80">
                Ao salvar, a imagem personalizada desta aba será removida do armazenamento e a imagem padrão do projeto será usada.
              </div>
            ) : null}

            <div
              ref={editorRef}
              className={`relative mt-4 ${isEmblemsBanner ? "w-full" : "aspect-[4/1]"} cursor-grab overflow-hidden rounded-lg border border-white/10 bg-black active:cursor-grabbing`}
              style={isEmblemsBanner ? { aspectRatio: String(previewAspectRatio) } : undefined}
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
                src={visibleImageUrl}
                alt="Prévia do banner"
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  width: `${(isEmblemsBanner ? Math.max(1, draft.zoom) : draft.zoom) * 100}%`,
                  height: isEmblemsBanner ? `${Math.max(1, draft.zoom) * 100}%` : undefined,
                  objectFit: isEmblemsBanner ? "cover" : undefined,
                  objectPosition: isEmblemsBanner ? "center top" : undefined,
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
                  min={isEmblemsBanner ? "1" : "0.8"}
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
              <p role="alert" className="mt-3 text-[10px] font-bold text-red-300">{error}</p>
            ) : null}
          </div>
        </div>
      ), portalTarget) : null}
    </>
  );
}
