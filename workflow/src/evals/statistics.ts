/** The 97.5% quantile of the standard normal distribution. */
export const z975 = 1.959963984540054;

/** Student's t 97.5% quantiles for 1 to 30 degrees of freedom. */
const t975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** Student's t 97.5% quantile: the table up to 30 degrees of freedom, the Cornish-Fisher expansion above. */
export function tQuantile975(degrees: number): number {
  if (!Number.isInteger(degrees) || degrees < 1) throw new Error(`No t quantile for ${degrees} degrees of freedom.`);
  if (degrees <= t975.length) return t975[degrees - 1]!;
  const z = z975;
  return z + (z ** 3 + z) / (4 * degrees) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * degrees ** 2);
}

export type Interval = { readonly low: number; readonly high: number };

/** The 95% Wilson score interval of a pass rate; null without samples. */
export function wilsonInterval(passes: number, count: number): Interval | null {
  if (count === 0) return null;
  const rate = passes / count;
  const z2 = z975 ** 2;
  const centre = (rate + z2 / (2 * count)) / (1 + z2 / count);
  const half = (z975 * Math.sqrt((rate * (1 - rate)) / count + z2 / (4 * count ** 2))) / (1 + z2 / count);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export type PairedStatistics = {
  readonly count: number;
  readonly mean: number | null;
  /** The standard error of the mean, s/√n with the sample standard deviation s; null below two pairs. */
  readonly standardError: number | null;
  /** The 95% interval of the mean from Student's t with n − 1 degrees of freedom; null below two pairs. */
  readonly interval: Interval | null;
};

/** The mean of paired differences with its standard error and 95% t interval. */
export function pairedStatistics(differences: readonly number[]): PairedStatistics {
  const count = differences.length;
  if (count === 0) return { count, mean: null, standardError: null, interval: null };
  const mean = differences.reduce((sum, value) => sum + value, 0) / count;
  if (count < 2) return { count, mean, standardError: null, interval: null };
  const variance = differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
  const standardError = Math.sqrt(variance / count);
  const half = tQuantile975(count - 1) * standardError;
  return { count, mean, standardError, interval: { low: mean - half, high: mean + half } };
}

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}
