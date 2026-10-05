/**
 * Pure mathematical helpers.
 *
 * Every function in this module is side-effect free and safe to call from
 * Svelte 5 `$derived` computations. No DOM, no timers, no randomness.
 */
import type { MetricSeries, MetricType, MetricUnit } from '#lib/types/monitor';

/**
 * Trailing moving average.
 *
 * The first `windowSize - 1` entries average a shorter (still valid) window so
 * the returned array always has the same length as the input.
 *
 * @param data        Source series.
 * @param windowSize  Number of trailing samples to average. Values <= 1 pass through.
 */
export function calculateMovingAverage(data: number[], windowSize: number): number[] {
  if (data.length === 0) return [];
  if (windowSize <= 1) return [...data];

  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const subset = data.slice(start, i + 1);
    const sum = subset.reduce((acc, curr) => acc + curr, 0);
    result.push(Number((sum / subset.length).toFixed(2)));
  }
  return result;
}

/**
 * Linearly interpolated percentile.
 *
 * @param percentile Percentile in the inclusive range 0-100.
 * @returns The interpolated percentile, rounded to 2 decimals, or 0 for empty input.
 */
export function calculatePercentile(data: number[], percentile: number): number {
  if (data.length === 0) return 0;
  const clamped = Math.min(100, Math.max(0, percentile));
  const sorted = [...data].sort((a, b) => a - b);
  const index = (clamped / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) return sorted[lower];
  return Number((sorted[lower] * (1 - weight) + sorted[upper] * weight).toFixed(2));
}

/** Convenience wrapper for the 95th percentile, the SLO convention. */
export function calculateP95(data: number[]): number {
  return calculatePercentile(data, 95);
}

/**
 * Sample standard deviation using Bessel's correction (n - 1 denominator).
 * Series with fewer than two samples have no dispersion and return 0.
 */
export function calculateStdDev(data: number[]): number {
  if (data.length <= 1) return 0;
  const mean = data.reduce((acc, curr) => acc + curr, 0) / data.length;
  const variance = data.reduce((acc, curr) => acc + Math.pow(curr - mean, 2), 0) / (data.length - 1);
  return Number(Math.sqrt(variance).toFixed(2));
}

/** Arithmetic mean rounded to 2 decimals; 0 for an empty series. */
export function calculateMean(data: number[]): number {
  if (data.length === 0) return 0;
  const sum = data.reduce((acc, curr) => acc + curr, 0);
  return Number((sum / data.length).toFixed(2));
}

/** Smallest value in the series, or 0 when empty. */
export function calculateMin(data: number[]): number {
  if (data.length === 0) return 0;
  return Math.min(...data);
}

/** Largest value in the series, or 0 when empty. */
export function calculateMax(data: number[]): number {
  if (data.length === 0) return 0;
  return Math.max(...data);
}

/** Constrain `value` to the inclusive `[min, max]` interval. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation helper used by the chart scales. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp(t, 0, 1);
}

/**
 * Map `value` from `[inMin, inMax]` onto `[outMin, outMax]`, inverted when the
 * domain is descending. Degenerate domains collapse to `outMin`.
 */
export function scaleToRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  if (inMax === inMin) return outMin;
  const t = (value - inMin) / (inMax - inMin);
  return lerp(outMin, outMax, t);
}

/**
 * Summarise a raw telemetry series into the chart-ready `MetricSeries` shape:
 * min, max, mean, P95, standard deviation and a smoothed overlay.
 *
 * Stays pure so it can run inside a `$derived` without touching the database.
 */
export function summarizeMetricSeries(
  metric: MetricType,
  unit: MetricUnit,
  timestamps: number[],
  values: number[],
  smoothingWindow = 5
): MetricSeries {
  return {
    metric,
    unit,
    timestamps,
    values,
    min: calculateMin(values),
    max: calculateMax(values),
    average: calculateMean(values),
    p95: calculateP95(values),
    stdDev: calculateStdDev(values),
    movingAverage: calculateMovingAverage(values, smoothingWindow)
  };
}
