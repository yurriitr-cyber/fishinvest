/** Canonical display names — keep in sync with apps/web/src/lib/labels.ts */
export const FISH_DISPLAY_NAMES: Record<string, string> = {
  GLDFSH: 'GOLDI',
  NEON: 'GRACEFULLY',
  CATFSH: 'ZOOFI',
  CLOWN: 'PORCUPINEFISH',
  HORSE: 'LIONFISH',
  DGUPPY: 'MEG',
  PIRANA: 'MONKFISH',
  CBETTA: 'SQUIDI',
  BARRA: 'GIGA JELLY',
  QKOI: 'BLOOP',
  ANGEL: 'MOZZI',
  AROWANA: 'TWISTY TOOTH',
  EPUFFER: 'ELECTRIC EEL',
  ASHARK: 'DemogorFish',
  BDRAGON: 'MONSTER',
  STING: 'STING',
  MANTA: 'PHANTOM',
  MWHALE: 'DEEP FEAR',
};

export function fishDisplayName(symbol: string, fallback?: string | null) {
  return FISH_DISPLAY_NAMES[symbol.toUpperCase()] || fallback || symbol;
}
