export function StenoMark({ size = 22, className = "" }) {
  return (
    <img
      src="/dragonfly-logo-512.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: 6 }}
    />
  );
}

export function Wordmark({ size = 19 }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-serif)",
        fontSize: size,
        fontWeight: 400,
        letterSpacing: "-0.01em",
        color: "var(--fg-1)",
        lineHeight: 1,
      }}
    >
      stenoAI.
    </span>
  );
}
