// Lengths are stored in meters; maps choose feet or meters for display.
export const FT = 0.3048;
export const toUnit = (meters, units) => (units === 'ft' ? meters / FT : meters);
export const fromUnit = (value, units) => (units === 'ft' ? value * FT : value);

const trim = n => String(+n.toFixed(2));

/** "12 ft", "3.5 m", "0.4 ft" — fewer decimals for bigger numbers. */
export function formatLength(meters, units) {
  const v = toUnit(meters, units);
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : v >= 1 ? 1 : 2;
  return `${trim(+v.toFixed(digits))} ${units}`;
}

/** A round grid spacing that gives at most ~16 lines across the map. */
export function gridStep(maxMeters, units) {
  const span = toUnit(maxMeters, units);
  const steps = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500];
  const step = steps.find(s => span / s <= 16) ?? steps.at(-1);
  return { meters: fromUnit(step, units), label: `${step} ${units}` };
}
