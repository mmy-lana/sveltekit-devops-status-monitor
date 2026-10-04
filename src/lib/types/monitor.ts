/**
 * Canonical domain contracts for the Asset Management & DevOps Status Monitor.
 * Every layer (Dexie persistence, telemetry engine, alarm evaluator, UI) is
 * typed against this single source of truth.
 */

/* ------------------------------------------------------------------ */
/* Primitive unions                                                    */
/* ------------------------------------------------------------------ */

export type ServerStatus = 'healthy' | 'warning' | 'critical' | 'maintenance' | 'offline';
export type Environment = 'production' | 'staging' | 'development' | 'testing';
export type MetricType = 'cpu' | 'memory' | 'disk' | 'networkIn' | 'networkOut' | 'latency';
export type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
export type ComparisonOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
export type IncidentSeverity = 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4';
export type IncidentStatus = 'open' | 'investigating' | 'mitigated' | 'resolved';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/** Unit that a metric or alarm threshold is expressed in. */
export type MetricUnit = '%' | 'Kbps' | 'ms';

/** Server architecture supported by the asset inventory. */
export type ServerArchitecture = 'x86_64' | 'arm64';

/* ------------------------------------------------------------------ */
/* Sorting / range primitives                                          */
/* ------------------------------------------------------------------ */

export type SortKey = 'name' | 'cpu' | 'memory' | 'latency' | 'status';
export type SortDirection = 'asc' | 'desc';
export type TimeRangeValue = '1h' | '3h' | '6h' | '12h' | '24h' | '7d';
export type RefreshRateMs = 0 | 5000 | 15000 | 30000 | 60000;

/* ------------------------------------------------------------------ */
/* Core entities                                                       */
/* ------------------------------------------------------------------ */

export interface ServerSpecs {
  cpuCores: number;
  memoryGb: number;
  diskGb: number;
  architecture: ServerArchitecture;
}

export interface ServerAsset {
  id: string;
  name: string;
  hostname: string;
  ipAddress: string;
  region: string;
  availabilityZone: string;
  environment: Environment;
  status: ServerStatus;
  tags: Record<string, string>;
  specs: ServerSpecs;
  description?: string;
  owner?: string;
  provisionedBy?: string;
  lastHeartbeat: number;
  createdAt: number;
  updatedAt: number;
}

export interface MetricDataPoint {
  timestamp: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkInKbps: number;
  networkOutKbps: number;
  latencyMs: number;
}

export interface ServerTelemetryRecord {
  id?: number;
  serverId: string;
  timestamp: number;
  metrics: MetricDataPoint;
}

export interface AlarmRule {
  id: string;
  serverId: string;
  name: string;
  metric: MetricType;
  operator: ComparisonOperator;
  threshold: number;
  evaluationPeriods: number;
  periodSeconds: number;
  state: AlarmState;
  enabled: boolean;
  consecutiveBreaches: number;
  lastEvaluatedAt: number;
  lastStateChangeAt: number;
  createdAt: number;
}

export interface IncidentTimelineEvent {
  id: string;
  timestamp: number;
  message: string;
  author: string;
  statusTransition?: IncidentStatus;
}

export interface Incident {
  id: string;
  serverId: string;
  serverName: string;
  alarmRuleId: string | null;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: number;
  resolvedAt: number | null;
  timeline: IncidentTimelineEvent[];
}

export interface LogEntry {
  id: string;
  serverId: string;
  timestamp: number;
  level: LogLevel;
  service: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* View models                                                         */
/* ------------------------------------------------------------------ */

export interface TimeRangeFilter {
  label: string;
  value: TimeRangeValue;
  durationMs: number;
}

export interface FleetSummary {
  totalCount: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  maintenanceCount: number;
  offlineCount: number;
  averageCpuUsage: number;
  averageMemoryUsage: number;
  activeAlarmsCount: number;
  openIncidentsCount: number;
}

/** A flattened, chart-ready series extracted from raw telemetry records. */
export interface MetricSeries {
  metric: MetricType;
  unit: MetricUnit;
  timestamps: number[];
  values: number[];
  min: number;
  max: number;
  average: number;
  p95: number;
  stdDev: number;
  movingAverage: number[];
}

/** Draft shape used by the asset provisioning / metadata modal. */
export interface ServerAssetDraft {
  name: string;
  hostname: string;
  ipAddress: string;
  region: string;
  availabilityZone: string;
  environment: Environment;
  status: ServerStatus;
  description: string;
  owner: string;
  provisionedBy: string;
  cpuCores: number;
  memoryGb: number;
  diskGb: number;
  architecture: ServerArchitecture;
  tags: Array<{ key: string; value: string }>;
}

/** Draft shape used by the alarm rule editor. */
export interface AlarmRuleDraft {
  name: string;
  serverId: string;
  metric: MetricType;
  operator: ComparisonOperator;
  threshold: number;
  evaluationPeriods: number;
  periodSeconds: number;
  enabled: boolean;
}

/** Field-level validation outcome shared by both modal forms. */
export type ValidationErrors<TField extends string = string> = Partial<Record<TField, string>>;
