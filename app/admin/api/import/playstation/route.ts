import { NextResponse } from "next/server";

type ImportedAchievement = {
  title: string;
  description: string;
  trophy: string;
  rank: string;
  image: string;
  officialImage: string;
  source: string;
  externalId: string;
  isCustom: boolean;
  isHidden: boolean;
};

const achievements: ImportedAchievement[] = [
  {
    title: "...",
    description: "...",
    trophy: "🏆",
    rank: "Bronze",
    image: "",
    officialImage: "...",
    source: "playstation",
    externalId: "...",
    isCustom: false,
    isHidden: false,
  },
];

export async function GET() {
  return NextResponse.json({
    ok: true,
    achievements,
  });
}

export async function POST() {
  return NextResponse.json({
    ok: true,
    achievements,
  });
}