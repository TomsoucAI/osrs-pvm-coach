// The rule, on every tab: a duration always reads m:ss, like an in-game timer (150 seconds reads 2:30).

/** Seconds as m:ss, rounded to the nearest second. */
export function duration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
