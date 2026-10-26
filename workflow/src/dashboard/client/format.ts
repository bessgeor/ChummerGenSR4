/** A duration as the page shows it: seconds, minutes or hours with one decimal. */
export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "–";
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/** A count as the page shows it: missing data is a dash, never zero; fractions get one decimal. */
export function formatCount(value: number | null): string {
  if (value === null) return "–";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function since(utc: string, now: number): string {
  return formatDuration(Math.max(0, now - Date.parse(utc)));
}
