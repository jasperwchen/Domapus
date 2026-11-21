export const TREND_UP_CLASS = "text-green-700 dark:text-green-500";
export const TREND_DOWN_CLASS = "text-red-600 dark:text-red-500";

/** Filled triangle that carries the sign, so the number beside it is shown unsigned. */
export function TrendTriangle({ up, className = "" }: { up: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      className={`h-[0.7em] w-[0.7em] shrink-0 fill-current ${className}`}
      role="img"
      aria-label={up ? "up" : "down"}
    >
      <path d={up ? "M5 1 9.5 9h-9z" : "M5 9 .5 1h9z"} />
    </svg>
  );
}
