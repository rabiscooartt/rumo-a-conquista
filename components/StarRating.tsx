type StarRatingProps = {
  /** Nota na escala visual de 0 a 5 estrelas. Valores decimais permitem preenchimento proporcional. */
  rating: number;
  size?: "small" | "medium";
  className?: string;
  ariaLabel?: string;
  title?: string;
  tone?: "default" | "vivid";
};

export default function StarRating({
  rating,
  size = "medium",
  className = "",
  ariaLabel,
  title,
  tone = "default",
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

        if (tone === "vivid") {
          return (
            <span
              key={index}
              aria-hidden="true"
              className="relative inline-block shrink-0 leading-none"
            >
              <span className="inline-block text-[#361618]">★</span>
              {fillPercent > 0 ? (
                <span
                  className="absolute left-0 top-0 inline-block h-full overflow-hidden whitespace-nowrap text-[#ef4444]"
                  style={{ width: fillPercent + "%" }}
                >
                  ★
                </span>
              ) : null}
            </span>
          );
        }

        return (
          <span
            key={index}
            aria-hidden="true"
            style={{
              backgroundImage: "linear-gradient(90deg, #ef4444 " + fillPercent + "%, rgba(239, 68, 68, 0.2) " + fillPercent + "%)",
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
