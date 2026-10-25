"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type AvatarSettings = {
  x: number;
  y: number;
  zoom: number;
  imageUrl: string;
};

type AvatarApiResponse = Partial<AvatarSettings> & {
  authenticated?: boolean;
  error?: string;
};

const DEFAULT_AVATAR = "/images/avatar.jpg";
const AUTH_CHANGED_EVENT = "rumo-admin-auth-changed";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

const DEFAULT_SETTINGS: AvatarSettings = {
  x: 0,
  y: 0,
  zoom: 1,
  imageUrl: "",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSettings(value: Partial<AvatarSettings>): AvatarSettings {
  const zoom = clamp(Number.isFinite(Number(value.zoom)) ? Number(value.zoom) : 1, 1, 2.5);
  const maxOffset = (zoom - 1) * 50;

  return {
    x: clamp(Number.isFinite(Number(value.x)) ? Number(value.x) : 0, -maxOffset, maxOffset),
    y: clamp(Number.isFinite(Number(value.y)) ? Number(value.y) : 0, -maxOffset, maxOffset),
    zoom,
    imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : "",
  };
}

function Crown() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 22"
      className="absolute -top-[14%] left-1/2 z-10 h-[26%] w-[31%] -translate-x-1/2 drop-shadow-[0_0_5px_rgba(251,44,54,0.8)]"
    >
      <path
        d="M2.5 4.5 8 9.5 13.8 1.8 19.7 9.5 25.5 4.5 22.3 16.2H5.7L2.5 4.5Z"
        fill="#FB2C36"
        stroke="#FF737B"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <path d="M6.5 18.5H21.5" stroke="#FB2C36" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="2.5" cy="4.5" r="1.4" fill="#FF737B" />
      <circle cx="13.8" cy="1.8" r="1.4" fill="#FF737B" />
      <circle cx="25.5" cy="4.5" r="1.4" fill="#FF737B" />
    </svg>
  );
}

function AvatarArtwork({
  imageUrl,
  x,
  y,
  zoom,
  className = "",
  onImageError,
}: {
  imageUrl: string;
  x: number;
  y: number;
  zoom: number;
  className?: string;
  onImageError?: () => void;
}) {
  return (
    <div className={`relative aspect-square overflow-visible ${className}`}>
      <div className="absolute inset-0 overflow-hidden rounded-xl border-2 border-red-500/70 bg-black/60 shadow-[0_0_20px_rgba(251,44,54,0.20)]">
        <div className="absolute inset-[2px] overflow-hidden rounded-lg bg-black/50">
          <img
            src={imageUrl || DEFAULT_AVATAR}
            alt="Avatar do Rabiisco"
            draggable={false}
            onError={onImageError}
            className="absolute max-w-none select-none object-cover"
            style={{
              width: `${zoom * 100}%`,
              height: `${zoom * 100}%`,
              left: `${50 + x}%`,
              top: `${50 + y}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
        </div>
      </div>
      <Crown />
    </div>
  );
}

export default function ProfileAvatar() {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const [settings, setSettings] = useState<AvatarSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<AvatarSettings>(DEFAULT_SETTINGS);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState("");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

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
      const response = await fetch("/api/profile-avatar", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Não foi possível carregar o perfil.");

      const data = (await response.json()) as AvatarApiResponse;
      const loaded = normalizeSettings({
        x: data.x,
        y: data.y,
        zoom: data.zoom,
        imageUrl: data.imageUrl,
      });

      setSettings(loaded);
      setDraft(loaded);
      setIsAdmin(data.authenticated === true);
    } catch {
      setIsAdmin(false);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadSettings();

    function handleAuthChanged() {
      void loadSettings();
    }

    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
  }, [loadSettings]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) closeEditor();
    }

    function closeEditor() {
      setDraft(settings);
      setSelectedImageFile(null);
      setIsOpen(false);
      setError("");
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, isSaving, settings]);

  const visibleImageUrl = selectedImagePreview || settings.imageUrl || DEFAULT_AVATAR;
  const previewImageUrl = selectedImagePreview || draft.imageUrl || DEFAULT_AVATAR;
  const maxOffset = Math.max(0, (draft.zoom - 1) * 50);

  function openEditor() {
    setDraft(settings);
    setSelectedImageFile(null);
    setError("");
    setIsOpen(true);
  }

  function cancelEditor() {
    if (isSaving) return;
    setDraft(settings);
    setSelectedImageFile(null);
    setIsOpen(false);
    setError("");
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
    setDraft((current) => ({ ...current, x: 0, y: 0, zoom: 1 }));
    setError("");
  }

  function startDrag(clientX: number, clientY: number) {
    if (!isAdmin || !isOpen || !editorRef.current || isSaving) return;
    draggingRef.current = true;
    lastPointerRef.current = { x: clientX, y: clientY };
  }

  function moveDrag(clientX: number, clientY: number) {
    if (!draggingRef.current || !editorRef.current) return;

    const rect = editorRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const deltaX = ((clientX - lastPointerRef.current.x) / rect.width) * 100;
    const deltaY = ((clientY - lastPointerRef.current.y) / rect.height) * 100;
    lastPointerRef.current = { x: clientX, y: clientY };

    setDraft((current) => {
      const limit = Math.max(0, (current.zoom - 1) * 50);
      return {
        ...current,
        x: clamp(current.x + deltaX, -limit, limit),
        y: clamp(current.y + deltaY, -limit, limit),
      };
    });
  }

  function stopDrag() {
    draggingRef.current = false;
  }

  function resetPosition() {
    setDraft((current) => ({ ...current, x: 0, y: 0, zoom: 1 }));
    setError("");
  }

  async function save() {
    setIsSaving(true);
    setError("");

    try {
      let body: BodyInit;
      const headers: Record<string, string> = {};

      if (selectedImageFile) {
        const formData = new FormData();
        formData.set("x", String(draft.x));
        formData.set("y", String(draft.y));
        formData.set("zoom", String(draft.zoom));
        formData.set("file", selectedImageFile);
        body = formData;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({ x: draft.x, y: draft.y, zoom: draft.zoom });
      }

      const response = await fetch("/api/profile-avatar", {
        method: "POST",
        headers,
        body,
      });
      const data = (await response.json().catch(() => null)) as AvatarApiResponse | null;

      if (!response.ok) {
        throw new Error(data?.error || "Não foi possível salvar a foto.");
      }

      const saved = normalizeSettings({
        ...draft,
        imageUrl: typeof data?.imageUrl === "string" ? data.imageUrl : draft.imageUrl,
        x: data?.x ?? draft.x,
        y: data?.y ?? draft.y,
        zoom: data?.zoom ?? draft.zoom,
      });

      setSettings(saved);
      setDraft(saved);
      setSelectedImageFile(null);
      setIsOpen(false);
      window.dispatchEvent(new Event("rumo-profile-avatar-updated"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a foto.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="relative mt-3 h-[84px] w-[84px] overflow-visible">
        <AvatarArtwork
          imageUrl={visibleImageUrl}
          x={settings.x}
          y={settings.y}
          zoom={settings.zoom}
          className="h-full w-full"
          onImageError={() => {
            if (settings.imageUrl) setSettings((current) => ({ ...current, imageUrl: "" }));
          }}
        />
        {isLoaded && isAdmin ? (
          <button
            type="button"
            onClick={openEditor}
            title="Editar foto do perfil"
            aria-label="Editar foto do perfil"
            className="absolute -bottom-1 -right-1 z-20 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#080a0e] bg-[#FB2C36] text-white shadow-[0_2px_8px_rgba(0,0,0,0.6)] transition hover:scale-105 hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
            </svg>
          </button>
        ) : null}
      </div>

      {isAdmin && isOpen && portalTarget
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-md">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="profile-avatar-editor-title"
                className="my-auto w-full max-w-[760px] rounded-2xl border border-red-500/25 bg-[#080a0e]/95 p-4 shadow-2xl sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-red-400">
                      Editor de perfil · Avatar
                    </p>
                    <h2 id="profile-avatar-editor-title" className="mt-1 text-lg font-black text-white">
                      Ajustar foto do perfil
                    </h2>
                    <p className="mt-1 max-w-[500px] text-[11px] leading-relaxed text-white/50">
                      Carregue uma foto, arraste a prévia para ajustar o enquadramento e controle o zoom. A foto e a posição ficam salvas para todas as visitas.
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/35 bg-red-500/15 px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-red-100 transition hover:bg-red-500/25">
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
                        Carregar foto
                      </label>
                      <span className="max-w-full truncate text-[10px] text-white/45">
                        {selectedImageFile
                          ? selectedImageFile.name
                          : settings.imageUrl
                            ? "Foto personalizada ativa"
                            : "Foto original do site"}{" "}
                        · PNG/JPG/WEBP · até 4 MB
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={resetPosition}
                      disabled={isSaving}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-white/60 transition hover:text-white disabled:opacity-50"
                    >
                      Resetar posição
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditor}
                      disabled={isSaving}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-white/60 transition hover:text-white disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={isSaving}
                      className="rounded-lg border border-red-500/35 bg-red-500/15 px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-red-100 transition hover:bg-red-500/25 disabled:cursor-wait disabled:opacity-50"
                    >
                      {isSaving ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>

                {selectedImageFile ? (
                  <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.05] px-3 py-2 text-[10px] text-emerald-100/80">
                    A foto nova está apenas na prévia. Clique em <strong>Salvar</strong> para publicar permanentemente.
                  </div>
                ) : null}

                <div
                  ref={editorRef}
                  className="relative mx-auto mt-5 aspect-square w-full max-w-[280px] touch-none cursor-grab active:cursor-grabbing"
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    startDrag(event.clientX, event.clientY);
                  }}
                  onPointerMove={(event) => moveDrag(event.clientX, event.clientY)}
                  onPointerUp={stopDrag}
                  onPointerCancel={stopDrag}
                  onPointerLeave={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) stopDrag();
                  }}
                >
                  <AvatarArtwork
                    imageUrl={previewImageUrl}
                    x={draft.x}
                    y={draft.y}
                    zoom={draft.zoom}
                    className="h-full w-full"
                  />
                  <div className="pointer-events-none absolute inset-0 rounded-xl border border-white/10" />
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-white/10" />
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-white/10" />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.14em] text-white/45">
                      Horizontal <span>{Math.round(draft.x)}</span>
                    </span>
                    <input
                      type="range"
                      min={-maxOffset}
                      max={maxOffset}
                      step="0.5"
                      value={draft.x}
                      disabled={isSaving || maxOffset === 0}
                      onChange={(event) => setDraft((current) => ({ ...current, x: Number(event.target.value) }))}
                      className="mt-2 w-full accent-red-500"
                    />
                  </label>

                  <label className="block">
                    <span className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.14em] text-white/45">
                      Vertical <span>{Math.round(draft.y)}</span>
                    </span>
                    <input
                      type="range"
                      min={-maxOffset}
                      max={maxOffset}
                      step="0.5"
                      value={draft.y}
                      disabled={isSaving || maxOffset === 0}
                      onChange={(event) => setDraft((current) => ({ ...current, y: Number(event.target.value) }))}
                      className="mt-2 w-full accent-red-500"
                    />
                  </label>

                  <label className="block">
                    <span className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.14em] text-white/45">
                      Zoom <span>{draft.zoom.toFixed(2)}×</span>
                    </span>
                    <input
                      type="range"
                      min="1"
                      max="2.5"
                      step="0.01"
                      value={draft.zoom}
                      disabled={isSaving}
                      onChange={(event) => {
                        const zoom = Number(event.target.value);
                        const limit = Math.max(0, (zoom - 1) * 50);
                        setDraft((current) => ({
                          ...current,
                          zoom,
                          x: clamp(current.x, -limit, limit),
                          y: clamp(current.y, -limit, limit),
                        }));
                      }}
                      className="mt-2 w-full accent-red-500"
                    />
                  </label>
                </div>

                {error ? (
                  <p role="alert" className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-[10px] font-bold text-red-300">
                    {error}
                  </p>
                ) : null}
              </div>
            </div>,
            portalTarget
          )
        : null}
    </>
  );
}
