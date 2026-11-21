/** The ring mark: two interlocking rings, the second passing behind a wall. Drawn by hand as SVG. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path fill="var(--accent)" fillRule="evenodd" d="M24 10a22 22 0 1 0 0 44 22 22 0 0 0 0-44Zm0 9a13 13 0 1 1 0 26 13 13 0 0 1 0-26Z" />
      <path fill="var(--accent)" d="M44 10.6v9.5a13 13 0 0 1 0 23.8v9.5a22 22 0 0 0 0-42.8Z" />
    </svg>
  );
}
