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

export function calculatePercentile(data: number[], percentile: number): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) return sorted[lower];
  return Number((sorted[lower] * (1 - weight) + sorted[upper] * weight).toFixed(2));
}

// Sample standard deviation (Bessel's corrected, n - 1)
export function calculateStdDev(data: number[]): number {
  if (data.length <= 1) return 0;
  const mean = data.reduce((acc, curr) => acc + curr, 0) / data.length;
  const variance = data.reduce((acc, curr) => acc + Math.pow(curr - mean, 2), 0) / (data.length - 1);
  return Number(Math.sqrt(variance).toFixed(2));
}
