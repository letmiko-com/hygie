// Display rules for state of mind, shared by the screen's panels.
//
// Colour: valence runs from -1 to +1, so the scale runs from the cold data
// token to the warm one through the neutral one. It encodes WHAT WAS LOGGED,
// not a verdict on it: an unpleasant day is not an error state, and nothing
// here is tinted red as a warning.
//
// The mix is done with color-mix in oklch on the design tokens rather than on
// fixed colours, so the scale follows the theme like every other data colour.

const COLD = 'var(--data-distance)';
const NEUTRAL = 'var(--data-neutral)';
const WARM = 'var(--data-power)';

/** Colour for a valence in [-1, +1]. */
export function valenceColor(valence: number): string {
  const v = Math.max(-1, Math.min(1, valence));
  if (v < 0) {
    // -1 -> fully cold, 0 -> neutral
    return `color-mix(in oklch, ${COLD} ${Math.round(-v * 100)}%, ${NEUTRAL})`;
  }
  return `color-mix(in oklch, ${WARM} ${Math.round(v * 100)}%, ${NEUTRAL})`;
}

/**
 * Colour for one of Apple's seven regions (1 very unpleasant .. 7 very
 * pleasant), placed at the centre of its band.
 */
export function classificationColor(classification: number): string {
  const clamped = Math.max(1, Math.min(7, classification));
  return valenceColor((clamped - 4) / 3);
}
