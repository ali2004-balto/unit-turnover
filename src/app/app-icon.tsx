/**
 * The app's icon, drawn once and used at every size: a house in white on the
 * app's blue. The house sits in the middle 60%, so it survives being cut to a
 * circle or a rounded square on phones.
 */
export const ICON_BLUE = "#1f4e78";

export function AppIcon({ size }: { size: number }) {
  const glyph = Math.round(size * 0.58);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: ICON_BLUE }}>
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      </svg>
    </div>
  );
}
