import type { SVGProps } from "react";

export type TrophyRank = "Bronze" | "Prata" | "Ouro" | "Maestria" | "Emblema";

const rankColors: Record<TrophyRank, string> = {
  Bronze: "#CD7F32",
  Prata: "#C7CBD1",
  Ouro: "#E0B83D",
  Maestria: "#A78BFA",
  Emblema: "#F3C623",
};

export default function TrophyIcon({
  rank,
  className = "h-5 w-5",
  ...props
}: SVGProps<SVGSVGElement> & { rank: TrophyRank }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path
        d="M9 4h14v6.8c0 4.35-2.75 7.2-7 7.2s-7-2.85-7-7.2V4Z"
        fill={rankColors[rank]}
      />
      <path
        d="M9 6H5.5v3.1c0 3.15 1.95 5.55 5.15 5.95M23 6h3.5v3.1c0 3.15-1.95 5.55-5.15 5.95"
        fill="none"
        stroke={rankColors[rank]}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 18v4M11 25h10"
        fill="none"
        stroke={rankColors[rank]}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
