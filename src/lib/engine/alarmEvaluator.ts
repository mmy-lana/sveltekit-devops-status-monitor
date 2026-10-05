import type {
  AlarmRule,
  AlarmState,
  Incident,
  IncidentStatus,
  MetricDataPoint,
  ServerAsset
} from '$lib/types/monitor';
import {
  deriveIncidentSeverity,
  evaluateThreshold,
  extractMetricValue,
  METRIC_LABELS,
  METRIC_UNITS
} from '$lib/utils/alarmUtils';
import { ID_PREFIXES, generateEntityId } from '$lib/utils/id';

/**
 * Pure alarm evaluation engine.
 *
 * Every function here is side-effect free: it takes a rule plus a telemetry
 * sample and returns the next immutable rule state. Persistence and incident
 * creation are the caller's responsibility, which keeps the breach semantics
 * independently testable.
 */

/** Sentinel `serverId` that scopes a rule to the whole fleet. */
export const FLEET_SCOPE = 'all';

/** Outcome of evaluating a single rule against a single sample. */
export interface RuleEvaluation {
  /** The next rule state. Always a new object; never mutated in place. */
  rule: AlarmRule;
  /** The value the rule was evaluated against. */
  breachedValue: number;
  /** True when this evaluation moved the rule into the ALARM state. */
  triggered: boolean;
  /** True when `state` differs from the previous state. */
  stateChanged: boolean;
  /** True when the breach streak counter moved. */
  streakChanged: boolean;
  /** True when this sample satisfied the comparison. */
  breached: boolean;
}

/** Aggregate outcome for one telemetry sample across a set of rules. */
export interface BatchEvaluation {
  /** Evaluations, in the same order as the supplied rules. */
  evaluations: RuleEvaluation[];
  /** Evaluations that transitioned into ALARM and need an incident. */
  triggered: RuleEvaluation[];
  /** Indexes of rules whose persisted state actually changed. */
  changedIndexes: number[];
}

function sameState(a: AlarmState, b: AlarmState): boolean {
  return a === b;
}

/**
 * Advance one rule by a single evaluation period.
 *
 * The streak counter only reaches `evaluationPeriods` before the rule latches
 * into ALARM, which is what makes short CPU spikes avoid paging an operator.
 */
export function evaluateRule(
  rule: AlarmRule,
  metrics: MetricDataPoint,
  now: number
): RuleEvaluation {
  const breachedValue = extractMetricValue(metrics, rule.metric);
  const breached = evaluateThreshold(breachedValue, rule.operator, rule.threshold);

  const previousBreaches = rule.consecutiveBreaches;
  const consecutiveBreaches = breached ? previousBreaches + 1 : 0;

  let state = rule.state;
  let triggered = false;

  if (breached) {
    if (consecutiveBreaches >= rule.evaluationPeriods && state !== 'ALARM') {
      state = 'ALARM';
      triggered = true;
    }
  } else if (state === 'ALARM') {
    state = 'OK';
  }

  const stateChanged = !sameState(state, rule.state);
  const lastStateChangeAt = stateChanged ? now : rule.lastStateChangeAt;

  return {
    rule: {
      ...rule,
      consecutiveBreaches,
      state,
      lastEvaluatedAt: now,
      lastStateChangeAt
    },
    breachedValue,
    triggered,
    stateChanged,
    streakChanged: consecutiveBreaches !== previousBreaches,
    breached
  };
}

/**
 * Evaluate every rule that applies to `serverId` against one sample.
 *
 * Rules scoped to the fleet sentinel are included alongside the rules bound to
 * this specific server.
 */
export function evaluateRules(
  rules: readonly AlarmRule[],
  serverId: string,
  metrics: MetricDataPoint,
  now: number
): BatchEvaluation {
  const evaluations: RuleEvaluation[] = [];
  const triggered: RuleEvaluation[] = [];
  const changedIndexes: number[] = [];

  rules.forEach((rule, index) => {
    if (!rule.enabled) return;
    if (rule.serverId !== serverId && rule.serverId !== FLEET_SCOPE) return;

    const evaluation = evaluateRule(rule, metrics, now);
    evaluations.push(evaluation);
    if (evaluation.triggered) triggered.push(evaluation);
    if (evaluation.stateChanged) changedIndexes.push(index);
  });

  return { evaluations, triggered, changedIndexes };
}

/** Merge evaluated rules back into the full rule set, preserving identity. */
export function applyEvaluations(
  rules: readonly AlarmRule[],
  evaluations: readonly RuleEvaluation[]
): AlarmRule[] {
  if (evaluations.length === 0) return [...rules];
  const byId = new Map(evaluations.map((evaluation) => [evaluation.rule.id, evaluation.rule]));
  return rules.map((rule) => byId.get(rule.id) ?? rule);
}

/** Unit-aware rendering of a rule threshold, e.g. `CPU > 85.00%`. */
export function thresholdSummary(rule: AlarmRule): string {
  const unit = METRIC_UNITS[rule.metric];
  const precision = unit === 'ms' ? 1 : unit === 'Kbps' ? 0 : 2;
  return `${rule.threshold.toFixed(precision)}${unit}`;
}

/** Human sentence describing what a rule watches, used in list subtitles. */
export function describeRule(rule: AlarmRule): string {
  return `${rule.metric} ${rule.operator} ${thresholdSummary(rule)} for ${rule.evaluationPeriods} x ${rule.periodSeconds}s`;
}

/**
 * Build the incident that a freshly triggered rule should open.
 * The timeline always starts with the automated detection event so the record
 * is self-describing even if no operator ever annotates it.
 */
export function incidentFromAlarm(
  alarm: AlarmRule,
  server: ServerAsset | undefined,
  serverId: string,
  breachedValue: number,
  now: number
): Incident {
  const unit = METRIC_UNITS[alarm.metric];
  const precision = unit === 'ms' ? 1 : unit === 'Kbps' ? 0 : 2;

  return {
    id: generateEntityId(ID_PREFIXES.incident),
    serverId,
    serverName: server?.name ?? serverId,
    alarmRuleId: alarm.id,
    title: `${alarm.name} breached: ${breachedValue.toFixed(precision)}${unit}`,
    severity: deriveIncidentSeverity(breachedValue, alarm.threshold, alarm.operator),
    status: 'open',
    startedAt: now,
    resolvedAt: null,
    timeline: [
      {
        id: generateEntityId(ID_PREFIXES.event),
        timestamp: now,
        message: `Automated evaluation detected a breach: ${breachedValue.toFixed(precision)}${unit} ${alarm.operator} ${thresholdSummary(alarm)}`,
        author: 'Automated Monitor',
        statusTransition: 'open'
      }
    ]
  };
}

/** Ordered incident lifecycle, used to validate and drive transitions. */
export const INCIDENT_LIFECYCLE: readonly IncidentStatus[] = [
  'open',
  'investigating',
  'mitigated',
  'resolved'
] as const;

/** Statuses an incident may move to next. */
export function nextIncidentStatuses(current: IncidentStatus): IncidentStatus[] {
  const index = INCIDENT_LIFECYCLE.indexOf(current);
  return INCIDENT_LIFECYCLE.slice(index + 1);
}

/** True when no further status transition is possible. */
export function isTerminalStatus(status: IncidentStatus): boolean {
  return status === 'resolved';
}

/**
 * Elapsed time for a resolved incident, clamped at zero.
 *
 * `resolvedAt` and `startedAt` are written by different code paths, so clock
 * skew or a manual edit can produce an end earlier than the start. A negative
 * duration would silently drag the fleet-wide mean below zero.
 */
export function resolvedDurationMs(incident: Incident & { resolvedAt: number }): number {
  return Math.max(0, incident.resolvedAt - incident.startedAt);
}

/** Mean time to resolve, in milliseconds, over a set of incidents. */
export function meanTimeToResolve(incidents: readonly Incident[]): number | null {
  const resolved = incidents.filter(
    (incident): incident is Incident & { resolvedAt: number } => incident.resolvedAt !== null
  );
  if (resolved.length === 0) return null;
  const total = resolved.reduce((sum, incident) => sum + resolvedDurationMs(incident), 0);
  return Math.max(0, Math.round(total / resolved.length));
}

/**
 * Metrics whose values are bounded ratios, and therefore capped at 100.
 * Everything else is a physical quantity with its own ceiling.
 */
export const PERCENTAGE_METRICS: readonly AlarmRule['metric'][] = ['cpu', 'memory', 'disk'] as const;

/** Metrics measured in Kbps. */
export const BANDWIDTH_METRICS: readonly AlarmRule['metric'][] = ['networkIn', 'networkOut'] as const;

/** Inclusive ceiling per metric family, in that metric's own unit. */
export const METRIC_CEILING: Record<AlarmRule['metric'], number> = {
  cpu: 100,
  memory: 100,
  disk: 100,
  latency: 100_000,
  networkIn: 100_000_000,
  networkOut: 100_000_000
};

/** True when the metric is a bounded 0-100 ratio. */
export function isPercentageMetric(metric: AlarmRule['metric']): boolean {
  return PERCENTAGE_METRICS.includes(metric);
}

/** True when the metric is a bandwidth channel in Kbps. */
export function isBandwidthMetric(metric: AlarmRule['metric']): boolean {
  return BANDWIDTH_METRICS.includes(metric);
}

/**
 * Validate a threshold against the metric it guards.
 *
 * The ceiling must be selected by explicit membership rather than by exclusion:
 * an exclusion test silently mis-classifies any metric added later, which is how
 * bandwidth thresholds came to be rejected as if they were percentages.
 */
export function validateThreshold(metric: AlarmRule['metric'], threshold: number): string | null {
  if (!Number.isFinite(threshold)) return 'Threshold must be a finite number';
  if (threshold <= 0) return 'Threshold must be greater than zero';

  const ceiling = METRIC_CEILING[metric];
  if (isPercentageMetric(metric)) {
    if (threshold > ceiling) return `${METRIC_LABELS[metric]} must be a percentage and cannot exceed ${ceiling}`;
  } else if (threshold > ceiling) {
    return `${METRIC_LABELS[metric]} threshold cannot exceed ${ceiling} ${METRIC_UNITS[metric]}`;
  }

  return null;
}
