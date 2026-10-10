type StarRatingProps = {
  /** Nota na escala visual de 0 a 5 estrelas. Valores decimais permitem preenchimento proporcional. */
  rating: number;
  size?: "small" | "medium";
  className?: string;
  ariaLabel?: string;
  title?: string;
};

export default function StarRating({
  rating,
  size = "medium",
  className = "",
  ariaLabel,
  title,
}: StarRatingProps) {
  const safeRating = Number.isFinite(rating)
    ? Math.min(5, Math.max(0, rating))
    : 0;
  const formattedRating = safeRating.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  });

  return (
    <span
      role="img"
      aria-label={ariaLabel || `Nota ${formattedRating} de 5 estrelas`}
      title={title || `${formattedRating} de 5 estrelas`}
      className={`inline-flex shrink-0 items-center gap-0.5 font-black leading-none ${size === "small" ? "text-[18px] tracking-[-0.03em]" : "text-[20px]"} ${className}`.trim()}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(1, safeRating - index));
        const fillPercent = fill * 100;

        return (
          <span
            key={index}
            aria-hidden="true"
            style={{
              backgroundImage: `linear-gradient(90deg, #ef4444 ${fillPercent}%, rgba(239, 68, 68, 0.2) ${fillPercent}%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            ★
          </span>
        );
      })}
    </span>
  );
}
