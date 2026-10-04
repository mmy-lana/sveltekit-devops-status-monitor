export type ServerStatus = 'healthy' | 'warning' | 'critical' | 'maintenance' | 'offline';
export type Environment = 'production' | 'staging' | 'development' | 'testing';
export type MetricType = 'cpu' | 'memory' | 'disk' | 'networkIn' | 'networkOut' | 'latency';
export type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
export type ComparisonOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
export type IncidentSeverity = 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4';
export type IncidentStatus = 'open' | 'investigating' | 'mitigated' | 'resolved';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface ServerSpecs {
  cpuCores: number;
  memoryGb: number;
  diskGb: number;
  architecture: 'x86_64' | 'arm64';
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

export interface TimeRangeFilter {
  label: string;
  value: '1h' | '3h' | '6h' | '12h' | '24h' | '7d';
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
