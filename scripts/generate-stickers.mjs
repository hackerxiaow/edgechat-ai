import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('frontend/public/stickers', { recursive: true });

function svgWrapper(inner, bg = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.18"/>
    </filter>
    <linearGradient id="duckGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffeb3b"/>
      <stop offset="100%" stop-color="#fbc02d"/>
    </linearGradient>
    <linearGradient id="pepeGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8bc34a"/>
      <stop offset="100%" stop-color="#689f38"/>
    </linearGradient>
    <linearGradient id="catGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffcc80"/>
      <stop offset="100%" stop-color="#ffa726"/>
    </linearGradient>
    <linearGradient id="dogeGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffe082"/>
      <stop offset="100%" stop-color="#ffb300"/>
    </linearGradient>
  </defs>
  <g filter="url(#shadow)">
    ${inner}
  </g>
</svg>`;
}

const STICKERS = {
  // === Telegram Duck Series ===
  'duck_thumbs_up.svg': svgWrapper(`
    <!-- Body -->
    <ellipse cx="80" cy="90" rx="45" ry="40" fill="url(#duckGrad)"/>
    <!-- Head -->
    <circle cx="80" cy="55" r="32" fill="url(#duckGrad)"/>
    <!-- Cheeks -->
    <circle cx="62" cy="62" r="6" fill="#ff8a80" opacity="0.6"/>
    <circle cx="98" cy="62" r="6" fill="#ff8a80" opacity="0.6"/>
    <!-- Eyes (Happy arcs) -->
    <path d="M 64 50 Q 70 44 76 50" stroke="#263238" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M 84 50 Q 90 44 96 50" stroke="#263238" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <!-- Beak -->
    <ellipse cx="80" cy="60" rx="14" ry="8" fill="#ff9800"/>
    <!-- Thumbs Up Hand -->
    <rect x="110" y="70" width="16" height="24" rx="8" fill="#ffeb3b" stroke="#fbc02d" stroke-width="2"/>
    <path d="M 118 70 L 118 55 Q 123 52 126 57 L 126 70 Z" fill="#ff9800"/>
  `),

  'duck_heart.svg': svgWrapper(`
    <!-- Body -->
    <ellipse cx="80" cy="90" rx="45" ry="40" fill="url(#duckGrad)"/>
    <!-- Head -->
    <circle cx="80" cy="55" r="32" fill="url(#duckGrad)"/>
    <!-- Heart Eyes -->
    <path d="M 66 48 C 66 44 60 40 56 46 C 52 52 66 60 66 60 C 66 60 80 52 76 46 C 72 40 66 44 66 48 Z" fill="#e91e63"/>
    <path d="M 94 48 C 94 44 88 40 84 46 C 80 52 94 60 94 60 C 94 60 108 52 104 46 C 100 40 94 44 94 48 Z" fill="#e91e63"/>
    <!-- Beak (open happy) -->
    <path d="M 72 62 Q 80 72 88 62 Z" fill="#ff9800"/>
    <!-- Big Heart in hands -->
    <path d="M 80 85 C 80 75 66 68 58 78 C 50 88 80 108 80 108 C 80 108 110 88 102 78 C 94 68 80 75 80 85 Z" fill="#f44336"/>
  `),

  'duck_cool.svg': svgWrapper(`
    <!-- Body -->
    <ellipse cx="80" cy="90" rx="45" ry="40" fill="url(#duckGrad)"/>
    <!-- Head -->
    <circle cx="80" cy="55" r="32" fill="url(#duckGrad)"/>
    <!-- Beak with smug smile -->
    <ellipse cx="80" cy="62" rx="14" ry="7" fill="#ff9800"/>
    <!-- Sunglasses -->
    <path d="M 52 46 L 76 46 L 73 58 L 55 58 Z" fill="#212121"/>
    <path d="M 84 46 L 108 46 L 105 58 L 87 58 Z" fill="#212121"/>
    <line x1="76" y1="48" x2="84" y2="48" stroke="#212121" stroke-width="3"/>
    <line x1="45" y1="49" x2="52" y2="48" stroke="#212121" stroke-width="2.5"/>
    <line x1="108" y1="48" x2="115" y2="49" stroke="#212121" stroke-width="2.5"/>
    <!-- Glasses Glare -->
    <line x1="56" y1="49" x2="62" y2="55" stroke="#ffffff" stroke-width="2" opacity="0.8"/>
    <line x1="88" y1="49" x2="94" y2="55" stroke="#ffffff" stroke-width="2" opacity="0.8"/>
  `),

  'duck_party.svg': svgWrapper(`
    <!-- Body -->
    <ellipse cx="80" cy="95" rx="45" ry="38" fill="url(#duckGrad)"/>
    <!-- Head -->
    <circle cx="80" cy="60" r="30" fill="url(#duckGrad)"/>
    <!-- Party Hat -->
    <polygon points="80,15 65,45 95,45" fill="#e91e63"/>
    <circle cx="80" cy="15" r="5" fill="#ffeb3b"/>
    <circle cx="72" cy="35" r="3" fill="#00e676"/>
    <circle cx="88" cy="30" r="3.5" fill="#00b0ff"/>
    <!-- Happy Eyes -->
    <path d="M 66 58 Q 72 52 78 58" stroke="#263238" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M 82 58 Q 88 52 94 58" stroke="#263238" stroke-width="3" fill="none" stroke-linecap="round"/>
    <!-- Party Horn in Beak -->
    <ellipse cx="80" cy="66" rx="12" ry="6" fill="#ff9800"/>
    <path d="M 88 66 L 125 55 L 122 72 Z" fill="#00e5ff"/>
    <circle cx="125" cy="63" r="5" fill="#ff1744"/>
  `),

  // === Telegram Pepe Series ===
  'pepe_happy.svg': svgWrapper(`
    <!-- Face -->
    <ellipse cx="80" cy="80" rx="55" ry="45" fill="url(#pepeGrad)"/>
    <!-- Big Pepe Eyes -->
    <ellipse cx="60" cy="60" rx="18" ry="14" fill="#ffffff" stroke="#33691e" stroke-width="3"/>
    <ellipse cx="100" cy="60" rx="18" ry="14" fill="#ffffff" stroke="#33691e" stroke-width="3"/>
    <!-- Pupils -->
    <circle cx="62" cy="60" r="7" fill="#212121"/>
    <circle cx="98" cy="60" r="7" fill="#212121"/>
    <circle cx="64" cy="58" r="2.5" fill="#ffffff"/>
    <circle cx="100" cy="58" r="2.5" fill="#ffffff"/>
    <!-- Eyelids -->
    <path d="M 42 55 Q 60 48 78 55" stroke="#33691e" stroke-width="3" fill="none"/>
    <path d="M 82 55 Q 100 48 118 55" stroke="#33691e" stroke-width="3" fill="none"/>
    <!-- Famous Pepe Smile -->
    <path d="M 45 88 Q 80 115 115 88" stroke="#1b5e20" stroke-width="5" fill="#d32f2f" stroke-linecap="round"/>
    <!-- Lips -->
    <path d="M 40 85 Q 80 102 120 85" stroke="#33691e" stroke-width="4" fill="none"/>
  `),

  'pepe_cheers.svg': svgWrapper(`
    <!-- Face -->
    <ellipse cx="70" cy="75" rx="50" ry="42" fill="url(#pepeGrad)"/>
    <!-- Eyes looking smug -->
    <ellipse cx="55" cy="58" rx="16" ry="12" fill="#ffffff" stroke="#33691e" stroke-width="2.5"/>
    <ellipse cx="90" cy="58" rx="16" ry="12" fill="#ffffff" stroke="#33691e" stroke-width="2.5"/>
    <circle cx="58" cy="58" r="6" fill="#212121"/>
    <circle cx="93" cy="58" r="6" fill="#212121"/>
    <!-- Smug half-smile -->
    <path d="M 50 82 Q 75 95 105 78" stroke="#1b5e20" stroke-width="4" fill="none" stroke-linecap="round"/>
    <!-- Wine Glass -->
    <path d="M 115 90 C 115 110 135 110 135 90 Z" fill="rgba(255,255,255,0.7)" stroke="#b0bec5" stroke-width="2"/>
    <path d="M 117 95 C 117 107 133 107 133 95 Z" fill="#b71c1c"/>
    <line x1="125" y1="110" x2="125" y2="130" stroke="#b0bec5" stroke-width="3"/>
    <ellipse cx="125" cy="130" rx="10" ry="3" fill="#b0bec5"/>
  `),

  'pepe_thinking.svg': svgWrapper(`
    <!-- Face -->
    <ellipse cx="80" cy="75" rx="52" ry="42" fill="url(#pepeGrad)"/>
    <!-- Big introspective eyes -->
    <ellipse cx="60" cy="55" rx="16" ry="14" fill="#ffffff" stroke="#33691e" stroke-width="2.5"/>
    <ellipse cx="98" cy="55" rx="16" ry="14" fill="#ffffff" stroke="#33691e" stroke-width="2.5"/>
    <circle cx="63" cy="52" r="6" fill="#212121"/>
    <circle cx="101" cy="52" r="6" fill="#212121"/>
    <!-- Thoughtful mouth -->
    <path d="M 55 86 Q 80 84 105 88" stroke="#1b5e20" stroke-width="4" fill="none"/>
    <!-- Hand on chin -->
    <ellipse cx="80" cy="108" rx="16" ry="12" fill="#8bc34a" stroke="#689f38" stroke-width="2"/>
    <!-- Thinking dots -->
    <circle cx="130" cy="40" r="4" fill="#689f38"/>
    <circle cx="140" cy="30" r="6" fill="#689f38"/>
    <circle cx="150" cy="18" r="8" fill="#689f38"/>
  `),

  // === Telegram Cat Series ===
  'cat_love.svg': svgWrapper(`
    <!-- Head -->
    <ellipse cx="80" cy="85" rx="48" ry="40" fill="url(#catGrad)"/>
    <!-- Ears -->
    <polygon points="42,55 35,25 65,48" fill="#ffa726"/>
    <polygon points="45,52 40,32 62,48" fill="#ff8a80"/>
    <polygon points="118,55 125,25 95,48" fill="#ffa726"/>
    <polygon points="115,52 120,32 98,48" fill="#ff8a80"/>
    <!-- Happy Curved Eyes -->
    <path d="M 58 75 Q 66 67 74 75" stroke="#4e342e" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M 86 75 Q 94 67 102 75" stroke="#4e342e" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <!-- Pink Nose -->
    <polygon points="76,84 84,84 80,89" fill="#e91e63"/>
    <!-- Mouth -->
    <path d="M 74 91 Q 80 96 86 91" stroke="#4e342e" stroke-width="2.5" fill="none"/>
    <!-- Hearts floating -->
    <path d="M 35 45 C 35 38 25 35 20 42 C 15 50 35 65 35 65 C 35 65 55 50 50 42 C 45 35 35 38 35 45 Z" fill="#e91e63"/>
    <path d="M 125 45 C 125 38 115 35 110 42 C 105 50 125 65 125 65 C 125 65 145 50 140 42 C 135 35 125 38 125 45 Z" fill="#e91e63"/>
  `),

  'cat_sleepy.svg': svgWrapper(`
    <!-- Head -->
    <ellipse cx="80" cy="85" rx="48" ry="40" fill="url(#catGrad)"/>
    <!-- Ears -->
    <polygon points="42,55 35,25 65,48" fill="#ffa726"/>
    <polygon points="118,55 125,25 95,48" fill="#ffa726"/>
    <!-- Closed sleeping eyes (straight lines) -->
    <line x1="56" y1="78" x2="74" y2="78" stroke="#4e342e" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="86" y1="78" x2="104" y2="78" stroke="#4e342e" stroke-width="3.5" stroke-linecap="round"/>
    <!-- Nose & tiny mouth -->
    <polygon points="77,84 83,84 80,88" fill="#ff8a80"/>
    <path d="M 76 90 Q 80 93 84 90" stroke="#4e342e" stroke-width="2" fill="none"/>
    <!-- Floating ZZZ -->
    <text x="120" y="45" font-family="sans-serif" font-weight="900" font-size="22" fill="#3f51b5">Z</text>
    <text x="135" y="30" font-family="sans-serif" font-weight="900" font-size="16" fill="#5c6bc0">z</text>
    <text x="145" y="18" font-family="sans-serif" font-weight="900" font-size="12" fill="#7986cb">z</text>
  `),

  // === Telegram Doge Series ===
  'doge_wow.svg': svgWrapper(`
    <!-- Head -->
    <ellipse cx="80" cy="85" rx="46" ry="42" fill="url(#dogeGrad)"/>
    <!-- White muzzle -->
    <ellipse cx="80" cy="95" rx="26" ry="20" fill="#fff8e1"/>
    <!-- Ears -->
    <polygon points="45,55 35,22 68,42" fill="#ffb300"/>
    <polygon points="48,50 40,28 65,42" fill="#ffcc80"/>
    <polygon points="115,55 125,22 92,42" fill="#ffb300"/>
    <polygon points="112,50 120,28 95,42" fill="#ffcc80"/>
    <!-- Big round curious eyes -->
    <circle cx="62" cy="72" r="9" fill="#ffffff" stroke="#3e2723" stroke-width="2"/>
    <circle cx="98" cy="72" r="9" fill="#ffffff" stroke="#3e2723" stroke-width="2"/>
    <circle cx="64" cy="71" r="5" fill="#212121"/>
    <circle cx="96" cy="71" r="5" fill="#212121"/>
    <circle cx="66" cy="69" r="2" fill="#ffffff"/>
    <circle cx="98" cy="69" r="2" fill="#ffffff"/>
    <!-- Nose & Mouth -->
    <ellipse cx="80" cy="88" rx="8" ry="6" fill="#212121"/>
    <path d="M 73 95 Q 80 102 87 95" stroke="#3e2723" stroke-width="2.5" fill="none"/>
    <!-- WOW text floating -->
    <text x="115" y="45" font-family="Comic Sans MS, sans-serif" font-weight="bold" font-size="18" fill="#e91e63">wow</text>
    <text x="15" y="55" font-family="Comic Sans MS, sans-serif" font-weight="bold" font-size="16" fill="#00e676">so chat</text>
  `)
};

for (const [name, content] of Object.entries(STICKERS)) {
  writeFileSync(resolve('frontend/public/stickers', name), content.trim());
}

console.log(`Generated ${Object.keys(STICKERS).length} Telegram stickers in frontend/public/stickers!`);
