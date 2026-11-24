// Shared by the server-rendered charts and the Projection, which also renders in the browser.

/** Rounds a drawing coordinate to one decimal place, to keep the path short. */
export function coordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

/** An SVG path through `values`, one per step along x, such as `M52,14 L60.5,20`. */
export function linePath(values: number[], x: (index: number) => number, y: (value: number) => number): string {
  return values.map((value, index) => `${index ? "L" : "M"}${coordinate(x(index))},${coordinate(y(value))}`).join(" ");
}
