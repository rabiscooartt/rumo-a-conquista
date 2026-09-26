import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "achievement-preparation-drafts";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase não está configurado no servidor.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function ensureBucket(supabase: ReturnType<typeof getAdminClient>) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "5MB", allowedMimeTypes: ["application/json"] });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
}

function pathFor(slug: string) { return slug.replace(/[^a-z0-9-]/gi, "-") + ".json"; }

export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get("slug")?.trim();
    if (!slug) return NextResponse.json({ error: "Slug do jogo é obrigatório." }, { status: 400 });
    const supabase = getAdminClient();
    await ensureBucket(supabase);
    const { data, error } = await supabase.storage.from(BUCKET).download(pathFor(slug));
    if (error || !data) return NextResponse.json({ found: false });
    return NextResponse.json({ found: true, draft: JSON.parse(await data.text()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar rascunho." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const slug = String(body.slug ?? "").trim();
    if (!slug || !body.preparation) return NextResponse.json({ error: "Slug e preparação são obrigatórios." }, { status: 400 });
    const supabase = getAdminClient();
    await ensureBucket(supabase);
    const draft = { ...body.preparation, gameSlug: slug, updatedAt: new Date().toISOString() };
    const file = new Blob([JSON.stringify(draft)], { type: "application/json" });
    const { error } = await supabase.storage.from(BUCKET).upload(pathFor(slug), file, { upsert: true, contentType: "application/json", cacheControl: "0" });
    if (error) throw error;
    return NextResponse.json({ saved: true, updatedAt: draft.updatedAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar rascunho." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get("slug")?.trim();
    if (!slug) return NextResponse.json({ error: "Slug do jogo é obrigatório." }, { status: 400 });
    const supabase = getAdminClient();
    await ensureBucket(supabase);
    const { error } = await supabase.storage.from(BUCKET).remove([pathFor(slug)]);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao limpar rascunho." }, { status: 500 });
  }
}