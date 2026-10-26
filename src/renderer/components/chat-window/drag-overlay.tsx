export function DragOverlay({ isDragOver }: { isDragOver: boolean }) {
  return (
    <>
      {" "}
      {isDragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_var(--ease-smooth-out)_both] items-center justify-center backdrop-blur-[1px]"
          style={{ background: "color-mix(in srgb, var(--fx-accent-blue) 6%, transparent)" }}
        >
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{
                  transformOrigin: "center",
                  animationDelay: `${delay}s`,
                  borderColor: "color-mix(in srgb, var(--fx-accent-blue) 50%, transparent)",
                }}
              />
            ))}
          </div>
          <svg
            width="280"
            height="280"
            viewBox="0 0 140 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: "drop-shadow(0 6px 18px color-mix(in srgb, var(--fx-accent-blue) 18%, transparent))" }}
          >
            <rect
              x="28"
              y="44"
              width="84"
              height="60"
              rx="8"
              fill="color-mix(in srgb, var(--fx-accent-blue) 8%, transparent)"
              stroke="color-mix(in srgb, var(--fx-accent-blue) 50%, transparent)"
              strokeWidth="1.8"
            />
            <path
              d="M36 100 L54 72 L68 88 L80 74 L104 100Z"
              fill="color-mix(in srgb, var(--fx-accent-blue) 16%, transparent)"
              stroke="color-mix(in srgb, var(--fx-accent-blue) 40%, transparent)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle
              cx="96"
              cy="58"
              r="8"
              fill="color-mix(in srgb, var(--fx-accent-blue) 22%, transparent)"
              stroke="color-mix(in srgb, var(--fx-accent-blue) 55%, transparent)"
              strokeWidth="1.6"
            />
            <g
              stroke="color-mix(in srgb, var(--fx-accent-blue) 45%, transparent)"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <line x1="96" y1="46" x2="96" y2="43" />
              <line x1="96" y1="70" x2="96" y2="73" />
              <line x1="84" y1="58" x2="81" y2="58" />
              <line x1="108" y1="58" x2="111" y2="58" />
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4" />
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6" />
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4" />
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6" />
            </g>
          </svg>
        </div>
      )}
    </>
  );
}
