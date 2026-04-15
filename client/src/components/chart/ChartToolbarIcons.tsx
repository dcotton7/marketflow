/** TradingView-style indicators control: four equal squares in a 2×2 grid. */
export function IndicatorsFourSquaresIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="1" y="1" width="5" height="5" rx="0.75" />
      <rect x="8" y="1" width="5" height="5" rx="0.75" />
      <rect x="1" y="8" width="5" height="5" rx="0.75" />
      <rect x="8" y="8" width="5" height="5" rx="0.75" />
    </svg>
  );
}
