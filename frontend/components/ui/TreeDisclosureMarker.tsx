export function TreeDisclosureMarker({
  expanded = false,
  size = 12,
}: {
  readonly expanded?: boolean;
  readonly size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        display: 'block',
        color: 'currentColor',
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 120ms ease',
        opacity: 0.82,
      }}
    >
      <path d="M4 2.5 7.5 6 4 9.5" />
    </svg>
  );
}
