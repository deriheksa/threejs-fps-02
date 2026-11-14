// EMBERLINE — the look plan, in one place.
// Warm dusk industrial palette: ember orange is the one accent, slate blue marks the
// player's team, brick red marks the enemy team, and everything else is warm dark.
export const PALETTE = {
  canvas: '#171310',
  surface: '#241c15',
  hairline: '#3a2d21',
  ink: '#f2e9d8',
  muted: '#a3907a',
  accent: '#ff7a1a',
  ally: '#5aa2ff',
  foe: '#ff4a38',
  money: '#ffd24a',
  ground: '#3d2f1f',
  container: '#7a4a28',
  containerB: '#4a5a6e',
  crate: '#6b5232',
};

export function shade(name) {
  return PALETTE[name];
}
