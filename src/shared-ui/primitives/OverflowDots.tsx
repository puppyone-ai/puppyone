export function OverflowDots({ orientation = "horizontal" }: {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <span className={`po-overflow-dots po-overflow-dots--${orientation}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}
