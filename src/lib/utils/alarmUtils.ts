import type {
  AlarmRule,
  AlarmState,
  ComparisonOperator,
  MetricDataPoint,
  MetricType,
  MetricUnit
} from '$lib/types/monitor';

/**
 * Threshold comparison semantics for CloudWatch-style alarm rules.
 * Deliberately isolated from the store and the UI so it stays trivially testable.
 */
export function evaluateThreshold(
  val: number,
  operator: ComparisonOperator,
  threshold: number
): boolean {
  switch (operator) {
    case 'GT':
      return val > threshold;
    case 'GTE':
      return val >= threshold;
    case 'LT':
      return val < threshold;
    case 'LTE':
      return val <= threshold;
    case 'EQ':
      return Math.abs(val - threshold) < 0.0001;
  }
}

/** Canonical display unit for each monitored metric. */
export const METRIC_UNITS: Record<MetricType, MetricUnit> = {
  cpu: '%',
  memory: '%',
  disk: '%',
  networkIn: 'Kbps',
  networkOut: 'Kbps',
  latency: 'ms'
};

/** Human readable labels used by legends, filter chips and chart axes. */
export const METRIC_LABELS: Record<MetricType, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  disk: 'Disk',
  networkIn: 'Network In',
  networkOut: 'Network Out',
  latency: 'Latency'
};

/** Ordered list used to render metric selector controls. */
export const METRIC_ORDER: readonly MetricType[] = [
  'cpu',
  'memory',
  'disk',
  'networkIn',
  'networkOut',
  'latency'
] as const;

/** Ordered list of comparison operators used by the alarm rule editor. */
export const OPERATOR_ORDER: readonly ComparisonOperator[] = ['GT', 'GTE', 'LT', 'LTE', 'EQ'] as const;

/** Readable rendering of a comparison operator. */
export const OPERATOR_SYMBOLS: Record<ComparisonOperator, string> = {
  GT: '>',
  GTE: '>=',
  LT: '<',
  LTE: '<=',
  EQ: '='
};

/** Pull the metric of interest out of a telemetry sample. */
export function extractMetricValue(metrics: MetricDataPoint, metric: MetricType): number {
  switch (metric) {
    case 'cpu':
      return metrics.cpuUsage;
    case 'memory':
      return metrics.memoryUsage;
    case 'disk':
      return metrics.diskUsage;
    case 'networkIn':
      return metrics.networkInKbps;
    case 'networkOut':
      return metrics.networkOutKbps;
    case 'latency':
      return metrics.latencyMs;
  }
}

/**
 * Determine the alarm state a rule should adopt after an evaluation.
 *
 * `OK` -> `INSUFFICIENT_DATA` is emitted whenever the breach streak has not yet
 * reached `evaluationPeriods`, mirroring CloudWatch's pending-data behaviour.
 */
export function nextAlarmState(
  isBreached: boolean,
  consecutiveBreaches: number,
  evaluationPeriods: number,
  currentState: AlarmState
): AlarmState {
  if (isBreached) {
    return consecutiveBreaches >= evaluationPeriods ? 'ALARM' : currentState;
  }
  return 'OK';
}

/** Format a threshold as a human readable condition, e.g. `CPU > 85%`. */
export function describeThreshold(rule: Pick<AlarmRule, 'metric' | 'operator' | 'threshold'>): string {
  const unit = METRIC_UNITS[rule.metric];
  const precision = unit === 'ms' ? 1 : unit === 'Kbps' ? 0 : 2;
  return `${METRIC_LABELS[rule.metric]} ${OPERATOR_SYMBOLS[rule.operator]} ${rule.threshold.toFixed(precision)}${unit}`;
}

/** Validate that a threshold is a finite, strictly positive number. */
export function isValidThreshold(threshold: number): boolean {
  return Number.isFinite(threshold) && threshold > 0;
}

/**
 * Severity heuristic used when an alarm opens an incident: breaches that exceed
 * the threshold by more than 25% are treated as SEV-1, everything else SEV-2.
 */
export function deriveIncidentSeverity(
  breachedValue: number,
  threshold: number,
  operator: ComparisonOperator
): 'SEV-1' | 'SEV-2' | 'SEV-3' {
  if (operator === 'LT' || operator === 'LTE' || operator === 'EQ') return 'SEV-3';
  const ratio = threshold === 0 ? 1 : breachedValue / threshold;
  return ratio > 1.25 ? 'SEV-1' : 'SEV-2';
}
