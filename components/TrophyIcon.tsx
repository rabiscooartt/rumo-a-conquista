import type { SVGProps } from "react";

export type TrophyRank = "Bronze" | "Prata" | "Ouro" | "Emblema";

const rankColors: Record<TrophyRank, string> = {
  Bronze: "#CD7F32",
  Prata: "#C7CBD1",
  Ouro: "#E0B83D",
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
        fill={rankColors[rank]}
        d="M11 4h10v3h3v3c0 4.32-2.27 7.62-6 8.68V22h4v3H10v-3h4v-3.32C10.27 17.62 8 14.32 8 10V7h3V4Zm-1 6c0 2.55 1.18 4.78 3.04 5.73A8.18 8.18 0 0 1 13 13H10Zm12 0v3c0 1.01-.36 1.94-1.04 2.73C22.82 14.78 24 12.55 24 10v-1h-2v1ZM8 7H4v3c0 3.82 2.54 7 6 7.86v-3.08C8.89 14.12 8 11.73 8 9.5V7Zm16 0v2.5c0 2.23-.89 4.62-2 5.28v3.08C25.46 17 28 13.82 28 10V7h-4Z"
      />
      <path
        fill={rankColors[rank]}
        d="M7 25h18v3H7z"
      />
    </svg>
  );
}
