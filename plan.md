# Architecture Plan: Asset Management & DevOps Server Status Monitor

**Project Slug:** `sveltekit-devops-status-monitor`  
**Stack:** SvelteKit (latest), Tailwind CSS (latest), TypeScript (latest), Dexie.js (latest)  
**Aesthetic:** AWS CloudWatch Enterprise Console (Clean Slate `#0b0f17`, Border `#1e293b`, Surface `#111827`, Card `#161f30`, Metric Blue `#38bdf8`, Metric Amber `#f59e0b`, Status Green `#10b981`, Status Red `#ef4444`, Text `#f8fafc` / `#94a3b8`)

---

## 1. Data Schema & Pure TypeScript Interfaces

```typescript
// src/lib/types/monitor.ts

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
```

### Validation Constraints & Rules

1. `ServerAsset.name`: 3 to 64 alphanumeric characters, hyphens, and underscores (`^[a-zA-Z0-9-_]{3,64}$`).
2. `ServerAsset.ipAddress`: Strictly valid IPv4 or IPv6 address formatting.
3. `MetricDataPoint.cpuUsage`, `memoryUsage`, `diskUsage`: Real numbers bounded between `0.00` and `100.00`.
4. `AlarmRule.threshold`: Real positive number matching the unit of the target metric (`%` for CPU/Memory/Disk, `Kbps` for Network, `ms` for Latency).
5. `Incident.timeline`: Append-only chronological list; every transition must store a unique event ID, author, and timestamp.

---

## 2. Component Architecture

```
src/
├── app.css                               # Tailwind v4 @theme tokens and base styling
├── lib/
│   ├── components/
│   │   ├── primitives/
│   │   │   ├── Badge.svelte              # Status and severity indicator pills
│   │   │   ├── Button.svelte             # Primary, secondary, danger, icon variants
│   │   │   ├── Input.svelte              # Accessible text input with label and error state
│   │   │   ├── Select.svelte             # Native-backed accessible dropdown selector
│   │   │   ├── Card.svelte               # Slate container with CloudWatch border styling
│   │   │   ├── Table.svelte              # Container-query adaptive table/card view
│   │   │   ├── ProgressBar.svelte        # Resource allocation bar with color shift thresholds
│   │   │   └── Tooltip.svelte            # Non-hover accessible context indicator
│   │   ├── compound/
│   │   │   ├── MetricChart.svelte        # Dual-axis SVG time-series chart with touch scrub
│   │   │   ├── Sparkline.svelte          # Compact inline 80x24px SVG metric trend
│   │   │   ├── TimeRangeSelector.svelte  # Range selection buttons (1h, 3h, 6h, 12h, 24h, 7d)
│   │   │   ├── RefreshRateDropdown.svelte# Interval selector (5s, 15s, 30s, 60s, paused)
│   │   │   ├── StatusSummaryCard.svelte  # Fleet metric rollup display card
│   │   │   ├── FilterSearchToolbar.svelte# Stacked search toolbar with horizontal scroll filter pills
│   │   │   └── LogConsole.svelte         # Monospaced live terminal log viewer with search
│   │   └── domain/
│   │       ├── FleetOverviewGrid.svelte  # Auto-fill aggregate cards and health matrix
│   │       ├── ServerListTable.svelte    # Data grid with instance inspection drawers
│   │       ├── ServerDetailMetrics.svelte# Multi-chart tabbed layout for target host
│   │       ├── AlarmListManager.svelte   # Alarm thresholds, triggers, and state rules
│   │       ├── IncidentTimelineDrawer.svelte # Incident lifecycle and resolution editor
│   │       └── AssetFormModal.svelte     # Server provisioning and metadata update modal
│   ├── db/
│   │   └── index.ts                      # Dexie.js offline-first schema with compound indexes
│   ├── engine/
│   │   └── alarmEvaluator.ts             # Alarm rule evaluations and threshold checks
│   ├── stores/
│   │   ├── monitorStore.svelte.ts        # Svelte 5 Runes core state management
│   │   └── filterStore.svelte.ts         # Query params and filtering runes
│   └── utils/
│       ├── alarmUtils.ts                 # Operator comparison and threshold evaluation
│       ├── formatting.ts                 # Bandwidth, time, memory unit formatters
│       ├── id.ts                         # Universal identifier generator
│       └── statistics.ts                 # Pure math: P95, Moving Average, STDDEV
└── routes/
    ├── +layout.ts                        # Disables SSR (export const ssr = false)
    ├── +layout.svelte                    # Navigation, global header, alarm bell indicator
    ├── +page.svelte                      # Fleet Dashboard (Overview + Asset Table)
    ├── servers/
    │   └── [id]/
    │       └── +page.svelte              # Detailed telemetry, logs, and server alarms
    ├── alarms/
    │   └── +page.svelte                  # Fleet-wide alarms and breach triggers
    └── incidents/
        └── +page.svelte                  # Incident tracking, timeline, and resolution
```

---

## 3. Core Feature Logic

### 3.1 Mathematical Utilities (`src/lib/utils/statistics.ts`)

```typescript
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
```

### 3.2 Alarm Utilities and ID Generation

```typescript
// src/lib/utils/alarmUtils.ts
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
```

```typescript
// src/lib/utils/id.ts
export function generateEntityId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}
```

```typescript
// src/lib/utils/formatting.ts
export function formatBytes(kbps: number): string {
  if (kbps < 1000) return `${kbps.toFixed(0)} Kbps`;
  const mbps = kbps / 1000;
  if (mbps < 1000) return `${mbps.toFixed(1)} Mbps`;
  return `${(mbps / 1000).toFixed(2)} Gbps`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
```

### 3.3 Offline Dexie Database Initialization (`src/lib/db/index.ts`)

```typescript
import Dexie, { type Table } from 'dexie';
import type {
  ServerAsset,
  ServerTelemetryRecord,
  AlarmRule,
  Incident,
  LogEntry
} from '$lib/types/monitor';

export class StatusMonitorDatabase extends Dexie {
  servers!: Table<ServerAsset, string>;
  telemetry!: Table<ServerTelemetryRecord, number>;
  alarms!: Table<AlarmRule, string>;
  incidents!: Table<Incident, string>;
  logs!: Table<LogEntry, string>;

  constructor() {
    super('StatusMonitorDB');
    this.version(1).stores({
      servers: 'id, name, region, environment, status, lastHeartbeat',
      telemetry: '++id, serverId, timestamp, [serverId+timestamp]',
      alarms: 'id, serverId, state, metric, enabled',
      incidents: 'id, serverId, severity, status, startedAt',
      logs: 'id, serverId, timestamp, level'
    });
  }
}

export const db = new StatusMonitorDatabase();
```

### 3.4 Svelte 5 Reactive Monitor Store (`src/lib/stores/monitorStore.svelte.ts`)

```typescript
import { db } from '$lib/db';
import Dexie from 'dexie';
import type {
  ServerAsset,
  AlarmRule,
  Incident,
  FleetSummary,
  MetricDataPoint,
  ServerStatus,
  LogEntry
} from '$lib/types/monitor';
import { evaluateThreshold } from '$lib/utils/alarmUtils';
import { generateEntityId } from '$lib/utils/id';

class MonitorState {
  servers = $state<ServerAsset[]>([]);
  alarms = $state<AlarmRule[]>([]);
  incidents = $state<Incident[]>([]);
  activeTelemetry = $state<Record<string, MetricDataPoint | null>>({});
  isLoading = $state<boolean>(true);
  autoRefreshInterval = $state<number>(10000);
  isPaused = $state<boolean>(false);
  private timer: number | null = null;
  private isPolling = false;

  fleetSummary: FleetSummary = $derived.by(() => {
    const totalCount = this.servers.length;
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let maintenanceCount = 0;
    let offlineCount = 0;

    let totalCpu = 0;
    let totalMem = 0;
    let countedMetrics = 0;

    for (const server of this.servers) {
      switch (server.status) {
        case 'healthy': healthyCount++; break;
        case 'warning': warningCount++; break;
        case 'critical': criticalCount++; break;
        case 'maintenance': maintenanceCount++; break;
        case 'offline': offlineCount++; break;
      }

      const latest = this.activeTelemetry[server.id];
      if (latest) {
        totalCpu += latest.cpuUsage;
        totalMem += latest.memoryUsage;
        countedMetrics++;
      }
    }

    const activeAlarmsCount = this.alarms.filter(a => a.state === 'ALARM' && a.enabled).length;
    const openIncidentsCount = this.incidents.filter(i => i.status !== 'resolved').length;

    return {
      totalCount,
      healthyCount,
      warningCount,
      criticalCount,
      maintenanceCount,
      offlineCount,
      averageCpuUsage: countedMetrics > 0 ? Number((totalCpu / countedMetrics).toFixed(1)) : 0,
      averageMemoryUsage: countedMetrics > 0 ? Number((totalMem / countedMetrics).toFixed(1)) : 0,
      activeAlarmsCount,
      openIncidentsCount
    };
  });

  async initialize() {
    if (typeof window === 'undefined') return;
    this.isLoading = true;
    try {
      await this.loadInitialData();
      this.startPolling();
    } finally {
      this.isLoading = false;
    }
  }

  async loadInitialData() {
    this.servers = await db.servers.toArray();
    this.alarms = await db.alarms.toArray();
    this.incidents = await db.incidents.toArray();

    const telemetryMap: Record<string, MetricDataPoint | null> =
      Object.fromEntries(this.servers.map(s => [s.id, null]));

    for (const server of this.servers) {
      const record = await db.telemetry
        .where('[serverId+timestamp]')
        .between([server.id, Dexie.minKey], [server.id, Dexie.maxKey])
        .last();

      if (record) {
        telemetryMap[server.id] = record.metrics;
      }
    }
    this.activeTelemetry = telemetryMap;
  }

  setRefreshInterval(ms: number) {
    this.autoRefreshInterval = ms;
    this.isPaused = ms === 0;
    this.startPolling();
  }

  startPolling() {
    if (typeof window === 'undefined') return;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.isPaused || this.autoRefreshInterval <= 0) return;

    this.timer = window.setInterval(() => {
      this.pollCycle();
    }, this.autoRefreshInterval);
  }

  async pollCycle() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const now = Date.now();
      const updatedTelemetry: Record<string, MetricDataPoint | null> = { ...this.activeTelemetry };
      const updatedServers = [...this.servers];

      const cutoff = now - 7 * 24 * 60 * 60 * 1000;
      await db.telemetry.where('timestamp').below(cutoff).delete();
      await db.logs.where('timestamp').below(cutoff).delete();

      for (let i = 0; i < updatedServers.length; i++) {
        const server = updatedServers[i];
        if (server.status === 'offline' || server.status === 'maintenance') continue;

        const prev = updatedTelemetry[server.id] ?? {
          timestamp: now - 10000,
          cpuUsage: 35.0,
          memoryUsage: 50.0,
          diskUsage: 65.0,
          networkInKbps: 4500,
          networkOutKbps: 8200,
          latencyMs: 14.5
        };

        const cpuDelta = (Math.random() - 0.48) * 8;
        const memDelta = (Math.random() - 0.5) * 2;
        const latDelta = (Math.random() - 0.49) * 4;

        const metrics: MetricDataPoint = {
          timestamp: now,
          cpuUsage: Math.min(100, Math.max(1, Number((prev.cpuUsage + cpuDelta).toFixed(1)))),
          memoryUsage: Math.min(100, Math.max(5, Number((prev.memoryUsage + memDelta).toFixed(1)))),
          diskUsage: Number(prev.diskUsage.toFixed(1)),
          networkInKbps: Math.max(100, Math.floor(prev.networkInKbps + (Math.random() - 0.5) * 500)),
          networkOutKbps: Math.max(200, Math.floor(prev.networkOutKbps + (Math.random() - 0.5) * 800)),
          latencyMs: Math.max(1, Number((prev.latencyMs + latDelta).toFixed(1)))
        };

        updatedTelemetry[server.id] = metrics;

        await db.telemetry.add({
          serverId: server.id,
          timestamp: now,
          metrics
        });

        await this.generateLogEntry(server.id, metrics, now);
        await this.evaluateAlarmsForServer(server.id, metrics, now);
        updatedServers[i] = await this.updateServerStatus(server, metrics, now);
      }

      this.activeTelemetry = updatedTelemetry;
      this.servers = updatedServers;
    } finally {
      this.isPolling = false;
    }
  }

  private async generateLogEntry(serverId: string, metrics: MetricDataPoint, now: number) {
    let level: LogEntry['level'] = 'INFO';
    let message = `Telemetry heartbeat processed: CPU ${metrics.cpuUsage}%, Latency ${metrics.latencyMs}ms`;

    if (metrics.cpuUsage > 90 || metrics.latencyMs > 250) {
      level = 'ERROR';
      message = `High resource breach detected: CPU at ${metrics.cpuUsage}%, Latency at ${metrics.latencyMs}ms`;
    } else if (metrics.cpuUsage > 75 || metrics.latencyMs > 100) {
      level = 'WARN';
      message = `Elevated load: CPU at ${metrics.cpuUsage}%`;
    } else if (Math.random() < 0.7) {
      return;
    }

    const log: LogEntry = {
      id: generateEntityId('log'),
      serverId,
      timestamp: now,
      level,
      service: 'telemetry-agent',
      message
    };

    await db.logs.add(log);
  }

  private async evaluateAlarmsForServer(serverId: string, metrics: MetricDataPoint, now: number) {
    const updatedAlarms = [...this.alarms];

    for (let i = 0; i < updatedAlarms.length; i++) {
      const alarm = updatedAlarms[i];
      if (!alarm.enabled || (alarm.serverId !== serverId && alarm.serverId !== 'all')) continue;

      let metricValue = 0;
      switch (alarm.metric) {
        case 'cpu': metricValue = metrics.cpuUsage; break;
        case 'memory': metricValue = metrics.memoryUsage; break;
        case 'disk': metricValue = metrics.diskUsage; break;
        case 'networkIn': metricValue = metrics.networkInKbps; break;
        case 'networkOut': metricValue = metrics.networkOutKbps; break;
        case 'latency': metricValue = metrics.latencyMs; break;
      }

      const isBreached = evaluateThreshold(metricValue, alarm.operator, alarm.threshold);
      let consecutiveBreaches = alarm.consecutiveBreaches;
      let state = alarm.state;
      let lastStateChangeAt = alarm.lastStateChangeAt;

      if (isBreached) {
        consecutiveBreaches += 1;
        if (consecutiveBreaches >= alarm.evaluationPeriods && state !== 'ALARM') {
          state = 'ALARM';
          lastStateChangeAt = now;
          await this.triggerIncident(alarm, serverId, metricValue, now);
        }
      } else {
        consecutiveBreaches = 0;
        if (state === 'ALARM') {
          state = 'OK';
          lastStateChangeAt = now;
        }
      }

      const updated = {
        ...alarm,
        consecutiveBreaches,
        state,
        lastStateChangeAt,
        lastEvaluatedAt: now
      };

      updatedAlarms[i] = updated;
      await db.alarms.put(updated);
    }

    this.alarms = updatedAlarms;
  }

  private async updateServerStatus(
    server: ServerAsset,
    metrics: MetricDataPoint,
    now: number
  ): Promise<ServerAsset> {
    let calculatedStatus: ServerStatus = 'healthy';
    if (metrics.cpuUsage > 90 || metrics.memoryUsage > 92 || metrics.latencyMs > 250) {
      calculatedStatus = 'critical';
    } else if (metrics.cpuUsage > 75 || metrics.memoryUsage > 80 || metrics.latencyMs > 100) {
      calculatedStatus = 'warning';
    }

    if (server.status !== calculatedStatus && server.status !== 'maintenance' && server.status !== 'offline') {
      const updatedServer: ServerAsset = {
        ...server,
        status: calculatedStatus,
        lastHeartbeat: now,
        updatedAt: now
      };
      await db.servers.put(updatedServer);
      return updatedServer;
    }

    return server;
  }

  private async triggerIncident(alarm: AlarmRule, serverId: string, breachedValue: number, now: number) {
    const server = this.servers.find(s => s.id === serverId);
    const newIncident: Incident = {
      id: generateEntityId('inc'),
      serverId,
      serverName: server?.name ?? 'Unknown Instance',
      alarmRuleId: alarm.id,
      title: `${alarm.name} breached: value was ${breachedValue}`,
      severity: breachedValue > alarm.threshold * 1.25 ? 'SEV-1' : 'SEV-2',
      status: 'open',
      startedAt: now,
      resolvedAt: null,
      timeline: [
        {
          id: generateEntityId('evt'),
          timestamp: now,
          message: `Alarm triggered threshold violation (${breachedValue} ${alarm.operator} ${alarm.threshold})`,
          author: 'Automated Monitor',
          statusTransition: 'open'
        }
      ]
    };

    try {
      await db.incidents.add(newIncident);
      this.incidents = [newIncident, ...this.incidents];
    } catch (err) {
      if (err instanceof Dexie.ConstraintError) {
        const retryIncident: Incident = {
          ...newIncident,
          id: generateEntityId('inc')
        };
        await db.incidents.add(retryIncident);
        this.incidents = [retryIncident, ...this.incidents];
      } else {
        console.error('[MonitorStore] Failed to persist incident:', err);
        throw err;
      }
    }
  }
}

export const monitorStore = new MonitorState();
```

### 3.5 Reactive Filter Store (`src/lib/stores/filterStore.svelte.ts`)

```typescript
import type { Environment, ServerAsset, ServerStatus, MetricDataPoint } from '$lib/types/monitor';
import { monitorStore } from '$lib/stores/monitorStore.svelte';

class FilterState {
  searchQuery = $state<string>('');
  selectedEnvironment = $state<Environment | 'all'>('all');
  selectedStatus = $state<ServerStatus | 'all'>('all');
  selectedRegion = $state<string>('all');
  sortBy = $state<'name' | 'cpu' | 'memory' | 'latency' | 'status'>('name');
  sortDirection = $state<'asc' | 'desc'>('asc');

  availableRegions: string[] = $derived.by(() => {
    return Array.from(new Set(monitorStore.servers.map(s => s.region))).sort();
  });

  applyFilters(
    servers: ServerAsset[],
    telemetry: Record<string, MetricDataPoint | null>
  ): ServerAsset[] {
    return servers
      .filter(server => {
        if (this.selectedEnvironment !== 'all' && server.environment !== this.selectedEnvironment) {
          return false;
        }
        if (this.selectedStatus !== 'all' && server.status !== this.selectedStatus) {
          return false;
        }
        if (this.selectedRegion !== 'all' && server.region !== this.selectedRegion) {
          return false;
        }
        if (this.searchQuery.trim().length > 0) {
          const query = this.searchQuery.toLowerCase();
          const matchName = server.name.toLowerCase().includes(query);
          const matchHost = server.hostname.toLowerCase().includes(query);
          const matchIp = server.ipAddress.toLowerCase().includes(query);
          if (!matchName && !matchHost && !matchIp) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let valA: string | number = 0;
        let valB: string | number = 0;

        switch (this.sortBy) {
          case 'name':
            valA = a.name.toLowerCase();
            valB = b.name.toLowerCase();
            break;
          case 'status':
            valA = a.status;
            valB = b.status;
            break;
          case 'cpu':
            valA = telemetry[a.id]?.cpuUsage ?? 0;
            valB = telemetry[b.id]?.cpuUsage ?? 0;
            break;
          case 'memory':
            valA = telemetry[a.id]?.memoryUsage ?? 0;
            valB = telemetry[b.id]?.memoryUsage ?? 0;
            break;
          case 'latency':
            valA = telemetry[a.id]?.latencyMs ?? 0;
            valB = telemetry[b.id]?.latencyMs ?? 0;
            break;
        }

        if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
  }

  reset() {
    this.searchQuery = '';
    this.selectedEnvironment = 'all';
    this.selectedStatus = 'all';
    this.selectedRegion = 'all';
    this.sortBy = 'name';
    this.sortDirection = 'asc';
  }
}

export const filterStore = new FilterState();
```

---

## 4. UI/UX & Responsive Layout Specifications

### Responsive Layout Matrix

| Breakpoint | Window Width | Strategy & Accommodations |
|---|---|---|
| Mobile Small | 360px - 389px | Single column, card-stacked server list via CSS `@container`, horizontal swipe for chart view, 44px tap targets, bottom sheet drawer for incidents. |
| Mobile Medium | 390px - 429px | Single column metrics, sticky summary pill header, condensed badge layouts, 2-row filter bar with horizontal scroll pills. |
| Mobile Large | 430px - 767px | Two-column grid (`repeat(auto-fill, minmax(min(160px, 100%), 1fr))`), bottom sheet drawer, tabbed sub-views for metrics. |
| Tablet | 768px - 1023px | Dual column grid, table with sticky instance name column, visible sparklines, multi-select filter bar. |
| Desktop | 1024px+ | Full multi-column dashboard, CloudWatch-style split chart console, inline log tailer, right-side sliding drawer. |

### Component Specific Mobile Rules

* `Table.svelte`: Implements CSS container queries (`@container (max-width: 768px)`). Renders tabular columns above 768px; transforms automatically into stacked card views below 768px with full label-value pairings.
* `FilterSearchToolbar.svelte`: Below 480px, stacks vertically into two rows. Row 1 hosts full-width search input. Row 2 contains status and environment filter pills in a `flex overflow-x-auto` strip with `flex-shrink-0` on each pill.
* `MetricChart.svelte`: Responsive SVG bounds left Y-axis labels to `32px` max width, right Y-axis labels to `28px` max width, and axis font size to `10px` on mobile screens. Hover/touch tooltip is positioned strictly above the touch coordinate to avoid finger occlusion.
* `IncidentTimelineDrawer.svelte`: Below 640px, displays as a bottom sheet (`width: 100vw; max-height: 85vh; border-t`) with drag pull-bar. Above 640px, displays as a right sidebar (`width: 480px; height: 100vh; border-l`).
* `FleetOverviewGrid.svelte`: Summary grid uses `grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr))` to prevent text clipping and container overflow on 360px viewports.

### Design Tokens (`src/app.css`)

```css
@import "tailwindcss";

@theme {
  --color-slate-base: #0b0f17;
  --color-slate-surface: #111827;
  --color-slate-card: #161f30;
  --color-cw-accent: #ec7211;
  --color-cw-blue: #38bdf8;
  --color-cw-amber: #f59e0b;
  --color-cw-emerald: #10b981;
  --color-cw-rose: #ef4444;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

body {
  background-color: var(--color-slate-base);
  color: #f8fafc;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}
```

---

## 5. Five-Phase Sequential Implementation Queue

### Phase 1: Types, Storage/API Client Config, and Base Utilities
* Task 1.1: Declare TypeScript contracts in `src/lib/types/monitor.ts` covering server assets, metrics, alarm triggers, and incidents.
* Task 1.2: Add `src/routes/+layout.ts` specifying `export const ssr = false;` to guarantee client-side IndexedDB execution.
* Task 1.3: Configure Dexie database in `src/lib/db/index.ts` with compound indexing `[serverId+timestamp]` and automated seed routine for 12 cloud server instances across global AWS regions.
* Task 1.4: Implement pure mathematical utilities in `src/lib/utils/statistics.ts` (`calculateMovingAverage`, `calculatePercentile`, `calculateStdDev` with Bessel's correction).
* Task 1.5: Implement isolated `src/lib/utils/alarmUtils.ts` and SSR-safe `src/lib/utils/id.ts`.

### Phase 2: Design Foundation & Atomic UI Primitives
* Task 2.1: Configure Tailwind CSS v4 `@theme` directive in `src/app.css` declaring CloudWatch tokens.
* Task 2.2: Implement `Badge.svelte` with status and severity variant mappings.
* Task 2.3: Implement `Button.svelte` supporting primary orange (`#ec7211`), secondary slate, danger rose, and icon variants with minimum 44px tap targets.
* Task 2.4: Implement `Card.svelte` with header and action slots and slate border paneling.
* Task 2.5: Implement `ProgressBar.svelte` with dynamic color shift based on warning and critical thresholds.
* Task 2.6: Implement container-query driven `Table.svelte` switching between multi-column data grid and touch card stack.

### Phase 3: Compound Molecules & Feature Components
* Task 3.1: Build `MetricChart.svelte` using responsive vector SVG with constrained mobile axes and touch coordinate scrubbing.
* Task 3.2: Build `Sparkline.svelte` for 80x24px inline metric visualization inside table rows.
* Task 3.3: Build `TimeRangeSelector.svelte` with options (`1h`, `3h`, `6h`, `12h`, `24h`, `7d`).
* Task 3.4: Build `RefreshRateDropdown.svelte` supporting interval selections (`5s`, `15s`, `30s`, `Paused`).
* Task 3.5: Build `FilterSearchToolbar.svelte` with mobile two-row layout and horizontal filter strip.
* Task 3.6: Build `LogConsole.svelte` with level filtering, query regex search, and auto-scroll control.

### Phase 4: Domain Logic, Reactive State, and Telemetry Engine
* Task 4.1: Construct `monitorStore.svelte.ts` utilizing Svelte 5 runes (`$state`, `$derived.by`) with initial null key pre-population, compound indexed queries, and `isPolling` guards.
* Task 4.2: Build telemetry data loop generating realistic noise fluctuations and log generation.
* Task 4.3: Implement immutable alarm evaluations updating rules and recording state change timestamps.
* Task 4.4: Construct `filterStore.svelte.ts` with reactive region derivation and multi-metric sorting.
* Task 4.5: Implement `IncidentTimelineDrawer.svelte` as an adaptive bottom sheet on mobile and sliding sidebar on desktop.
* Task 4.6: Implement `AssetFormModal.svelte` for server metadata updates and instance creation.

### Phase 5: Complete Page/Screen Assembly & Responsive Shell
* Task 5.1: Build top-level responsive layout (`src/routes/+layout.svelte`) containing CloudWatch dark nav, live fleet status pill, active alarm counter, and breadcrumb bar.
* Task 5.2: Assemble Fleet Dashboard (`src/routes/+page.svelte`) with summary widget row, filter toolbar, and adaptive server table.
* Task 5.3: Assemble Server Deep Dive (`src/routes/servers/[id]/+page.svelte`) with tabbed metric views, active alarms, and live container logs.
* Task 5.4: Assemble Fleet Alarms view (`src/routes/alarms/+page.svelte`) allowing rule creation, threshold tuning, and manual state overrides.
* Task 5.5: Assemble Incident Command Console (`src/routes/incidents/+page.svelte`) with MTTR calculation and timeline updates.
* Task 5.6: Execute responsive mobile audit across 360px, 390px, 430px, 768px, and 1024px+ viewports to verify tap targets, non-clipping text, and touch scrubbing accuracy.