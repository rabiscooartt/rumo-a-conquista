type PlatformIconProps = {
  platform?: string;
  className?: string;
};

function normalizePlatform(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Shared platform mark used in the Library and throughout the site. */
export default function PlatformIcon({
  platform,
  className = "h-4 w-4",
}: PlatformIconProps) {
  const label = platform || "Steam";
  const normalizedPlatform = normalizePlatform(label);

  if (normalizedPlatform === "steam") {
    return (
      <img
        src="/images/platforms/steam.png"
        alt=""
        aria-hidden="true"
        className={className + " shrink-0 object-contain"}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className + " shrink-0"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.25" />
      <path d="M8.5 10.5H15.5V15H8.5Z" strokeLinejoin="round" />
      <path d="M10 8.5V10.5M14 8.5V10.5" />
    </svg>
  );
}
