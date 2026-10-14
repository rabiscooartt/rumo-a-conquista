import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";

const BUCKET = "game-review-drafts";

async function isAdmin(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminSession(token);
}

async function ensureBucket(supabase: ReturnType<typeof createAdminSupabaseClient>) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["application/json"],
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
}

function pathFor(slug: string) {
  return slug.replace(/[^a-z0-9-]/gi, "-") + ".json";
}

export async function GET(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ found: false, error: "Entre no modo Admin para acessar os rascunhos." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const slug = request.nextUrl.searchParams.get("slug")?.trim() || "";
    if (!slug || slug.length > 120) {
      return NextResponse.json({ error: "Slug do jogo inválido." }, { status: 400 });
    }
    const supabase = createAdminSupabaseClient();
    await ensureBucket(supabase);
    const { data, error } = await supabase.storage.from(BUCKET).download(pathFor(slug));
    if (error || !data) {
      return NextResponse.json({ found: false }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ found: true, draft: JSON.parse(await data.text()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar o rascunho." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ saved: false, error: "Entre no modo Admin para salvar rascunhos." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const body = (await request.json()) as { slug?: unknown; draft?: unknown };
    const slug = String(body.slug ?? "").trim();
    if (!slug || slug.length > 120 || !body.draft || typeof body.draft !== "object" || Array.isArray(body.draft)) {
      return NextResponse.json({ saved: false, error: "Slug e conteúdo do rascunho são obrigatórios." }, { status: 400 });
    }
    const supabase = createAdminSupabaseClient();
    await ensureBucket(supabase);
    const draft = { ...(body.draft as Record<string, unknown>), gameSlug: slug, updatedAt: new Date().toISOString() };
    const file = new Blob([JSON.stringify(draft)], { type: "application/json" });
    const { error } = await supabase.storage.from(BUCKET).upload(pathFor(slug), file, {
      upsert: true,
      contentType: "application/json",
      cacheControl: "0",
    });
    if (error) throw error;
    return NextResponse.json({ saved: true, updatedAt: draft.updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ saved: false, error: error instanceof Error ? error.message : "Erro ao salvar o rascunho." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
