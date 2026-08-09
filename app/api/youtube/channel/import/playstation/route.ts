import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Importação do PlayStation ainda não implementada.",
    },
    { status: 501 }
  );
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Importação do PlayStation ainda não implementada.",
    },
    { status: 501 }
  );
}