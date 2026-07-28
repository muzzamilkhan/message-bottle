export function Bottle({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 260"
      className={className}
      role="img"
      aria-label="A glass bottle with a rolled letter inside, floating on the sea"
    >
      {/* cork */}
      <rect x="82" y="10" width="36" height="26" rx="8" fill="#c98a4b" />
      <rect x="80" y="30" width="40" height="14" rx="6" fill="#b3763a" />
      {/* neck */}
      <path d="M84 42 h32 v24 l10 18 H74 l10-18 Z" fill="#bfe9f2" opacity="0.85" />
      {/* body */}
      <path
        d="M60 92 q-14 18 -14 60 q0 60 54 60 q54 0 54-60 q0-42-14-60 q-6-10-6-14 H66 q0 4-6 14Z"
        fill="#bfe9f2"
        opacity="0.7"
      />
      {/* rolled letter */}
      <rect x="74" y="118" width="52" height="70" rx="10" fill="#fdfaf3" />
      <rect x="74" y="118" width="52" height="70" rx="10" fill="url(#paperShade)" opacity="0.25" />
      <line x1="86" y1="136" x2="114" y2="136" stroke="#f4c0d0" strokeWidth="3" strokeLinecap="round" />
      <line x1="86" y1="150" x2="114" y2="150" stroke="#cfe6ec" strokeWidth="3" strokeLinecap="round" />
      <line x1="86" y1="164" x2="106" y2="164" stroke="#cfe6ec" strokeWidth="3" strokeLinecap="round" />
      {/* string tie */}
      <path d="M92 116 q8 8 16 0" stroke="#f76090" strokeWidth="3" fill="none" />
      {/* glass shine */}
      <path d="M70 100 q-8 20 -6 54" stroke="white" strokeWidth="6" fill="none" opacity="0.6" strokeLinecap="round" />
      <defs>
        <linearGradient id="paperShade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e4b45a" />
          <stop offset="1" stopColor="#f76090" />
        </linearGradient>
      </defs>
    </svg>
  );
}
