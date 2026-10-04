import type { ComparisonOperator } from '$lib/types/monitor';

export function evaluateThreshold(
  val: number,
  operator: ComparisonOperator,
  threshold: number
): boolean {
  switch (operator) {
    case 'GT': return val > threshold;
    case 'GTE': return val >= threshold;
    case 'LT': return val < threshold;
    case 'LTE': return val <= threshold;
    case 'EQ': return Math.abs(val - threshold) < 0.0001;
  }
}
