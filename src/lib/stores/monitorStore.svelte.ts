import Dexie from 'dexie';
import { db, seedInitialDataIfEmpty } from '$lib/db';
import {
  applyEvaluations,
  evaluateRules,
  incidentFromAlarm,
  isTerminalStatus
} from '$lib/engine/alarmEvaluator';
import type {
  AlarmRule,
  AlarmRuleDraft,
  AlarmState,
  FleetSummary,
  Incident,
  IncidentStatus,
  IncidentTimelineEvent,
  LogEntry,
  MetricDataPoint,
  MetricSeries,
  MetricType,
  ServerAsset,
  ServerAssetDraft,
  ServerStatus
} from '$lib/types/monitor';
import { METRIC_UNITS, extractMetricValue } from '$lib/utils/alarmUtils';
import { ID_PREFIXES, generateEntityId } from '$lib/utils/id';
import { clamp, summarizeMetricSeries } from '$lib/utils/statistics';

const CRITICAL = { cpu: 90, memory: 92, latency: 250 } as const;
const WARNING = { cpu: 75, memory: 80, latency: 100 } as const;

const BOOTSTRAP_SAMPLE: MetricDataPoint = {
  timestamp: 0,
  cpuUsage: 35,
  memoryUsage: 50,
  diskUsage: 65,
  networkInKbps: 4500,
  networkOutKbps: 8200,
  latencyMs: 14.5
};

/** Keys that must never be defined on a tag dictionary. */
const FORBIDDEN_TAG_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Tag keys are restricted to word characters, hyphens and dots. */
const SAFE_TAG_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Longest accepted tag key and value. */
const MAX_TAG_KEY_LENGTH = 64;
const MAX_TAG_VALUE_LENGTH = 256;

/**
 * Validate a single tag key.
 *
 * `Object.fromEntries` happily defines an own `__proto__` property, and a plain
 * `Record<string, string>` therefore cannot be trusted to reject it. Reserved
 * names are refused by exact match after a case-fold, and anything outside the
 * conservative key grammar is refused outright.
 */
export function isSafeTagKey(key: string): boolean {
  const trimmed = key.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TAG_KEY_LENGTH) return false;
  if (FORBIDDEN_TAG_KEYS.has(trimmed.toLowerCase())) return false;
  return SAFE_TAG_KEY.test(trimmed);
}

/**
 * Build a tag dictionary that is structurally incapable of prototype pollution.
 *
 * The result is created with a null prototype, so it has no inherited setters,
 * and every key is checked before assignment. Values are coerced to strings.
 */
export function sanitizeTags(
  tags: ReadonlyArray<{ key: string; value: string }>
): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const tag of tags) {
    const key = tag.key.trim();
    if (!isSafeTagKey(key)) continue;
    result[key] = String(tag.value ?? '').trim().slice(0, MAX_TAG_VALUE_LENGTH);
  }

  return result;
}

/**
 * Strip Svelte's reactive proxies from a value.
 *
 * IndexedDB persists through `structuredClone`, which throws a DataCloneError on
 * a `$state` proxy, so every write boundary has to hand Dexie plain data.
 */
function plain<T>(value: T): T {
  return $state.snapshot(value) as T;
}

/**
 * Produce the next telemetry sample for a host.
 *
 * Bounded noise rides on top of the previous reading, offset by a slow sine so
 * charts show a believable workload shape rather than white noise.
 */
function nextSample(previous: MetricDataPoint, now: number): MetricDataPoint {
  const drift = Math.sin(now / 900_000);

  return {
    timestamp: now,
    cpuUsage: Number(
      clamp(previous.cpuUsage + (Math.random() - 0.5) * 7 + drift * 1.6, 1, 100).toFixed(1)
    ),
    memoryUsage: Number(
      clamp(previous.memoryUsage + (Math.random() - 0.5) * 1.8 + drift * 0.5, 5, 99).toFixed(1)
    ),
    diskUsage: Number(Math.min(98, previous.diskUsage + (Math.random() - 0.5) * 0.12).toFixed(2)),
    networkInKbps: Math.max(
      120,
      Math.round(previous.networkInKbps * (0.94 + Math.random() * 0.14) + drift * 400)
    ),
    networkOutKbps: Math.max(
      160,
      Math.round(previous.networkOutKbps * (0.94 + Math.random() * 0.14) + drift * 520)
    ),
    latencyMs: Number(
      clamp(previous.latencyMs + (Math.random() - 0.5) * 3.4 + drift * 2.2, 1.1, 880).toFixed(1)
    )
  };
}

/**
 * Derive the console status of a host from its latest sample.
 * `maintenance` and `offline` are operator-set states and are never overwritten.
 */
function deriveStatus(metrics: MetricDataPoint): ServerStatus {
  if (
    metrics.cpuUsage > CRITICAL.cpu ||
    metrics.memoryUsage > CRITICAL.memory ||
    metrics.latencyMs > CRITICAL.latency
  ) {
    return 'critical';
  }
  if (
    metrics.cpuUsage > WARNING.cpu ||
    metrics.memoryUsage > WARNING.memory ||
    metrics.latencyMs > WARNING.latency
  ) {
    return 'warning';
  }
  return 'healthy';
}

class MonitorState {
  servers = $state<ServerAsset[]>([]);
  alarms = $state<AlarmRule[]>([]);
  incidents = $state<Incident[]>([]);
  activeTelemetry = $state<Record<string, MetricDataPoint | null>>({});
  /** Recent CPU history per server, powering the inline Sparkline column. */
  sparklines = $state<Record<string, number[]>>({});
  isLoading = $state<boolean>(true);
  /** Non-null when the last load or mutation failed. */
  error = $state<string | null>(null);
  autoRefreshInterval = $state<number>(15000);
  isPaused = $state<boolean>(false);
  lastPollAt = $state<number | null>(null);

  private timer: number | null = null;
  private sparklineTimer: number | null = null;
  private isPolling = false;

  /** Roll-up of every counter the dashboard header and shell need. */
  fleetSummary: FleetSummary = $derived.by(() => {
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let maintenanceCount = 0;
    let offlineCount = 0;

    let totalCpu = 0;
    let totalMemory = 0;
    let counted = 0;

    for (const server of this.servers) {
      switch (server.status) {
        case 'healthy':
          healthyCount++;
          break;
        case 'warning':
          warningCount++;
          break;
        case 'critical':
          criticalCount++;
          break;
        case 'maintenance':
          maintenanceCount++;
          break;
        case 'offline':
          offlineCount++;
          break;
      }

      const latest = this.activeTelemetry[server.id];
      if (latest) {
        totalCpu += latest.cpuUsage;
        totalMemory += latest.memoryUsage;
        counted++;
      }
    }

    return {
      totalCount: this.servers.length,
      healthyCount,
      warningCount,
      criticalCount,
      maintenanceCount,
      offlineCount,
      averageCpuUsage: counted > 0 ? Number((totalCpu / counted).toFixed(1)) : 0,
      averageMemoryUsage: counted > 0 ? Number((totalMemory / counted).toFixed(1)) : 0,
      activeAlarmsCount: this.alarms.filter((a) => a.state === 'ALARM' && a.enabled).length,
      openIncidentsCount: this.incidents.filter((i) => !isTerminalStatus(i.status)).length
    };
  });

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;
    this.isLoading = true;
    this.error = null;
    try {
      await seedInitialDataIfEmpty();
      await this.loadAll();
      await this.refreshSparklines();
      this.startPolling();
      this.startSparklinePolling();
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Failed to open the local telemetry store';
    } finally {
      this.isLoading = false;
    }
  }

  /** Re-read every table from IndexedDB into reactive state. */
  async loadAll(): Promise<void> {
    const [servers, alarms, incidents] = await Promise.all([
      db.servers.toArray(),
      db.alarms.toArray(),
      db.incidents.toArray()
    ]);

    this.servers = [...servers].sort((a, b) => a.name.localeCompare(b.name));
    this.alarms = [...alarms].sort((a, b) => a.name.localeCompare(b.name));
    this.incidents = [...incidents].sort((a, b) => b.startedAt - a.startedAt);
    this.activeTelemetry = await this.loadLatestTelemetryMap();
  }

  /**
   * Latest sample per server. Keys are pre-populated with `null` so consumers can
   * distinguish "no telemetry yet" from "server not in the inventory".
   */
  private async loadLatestTelemetryMap(): Promise<Record<string, MetricDataPoint | null>> {
    const map: Record<string, MetricDataPoint | null> = {};
    for (const server of this.servers) map[server.id] = null;

    for (const server of this.servers) {
      const record = await db.telemetry
        .where('[serverId+timestamp]')
        .between([server.id, Dexie.minKey], [server.id, Dexie.maxKey])
        .last();
      if (record) map[server.id] = record.metrics;
    }
    return map;
  }

  setRefreshInterval(ms: number): void {
    this.autoRefreshInterval = ms;
    this.isPaused = ms <= 0;
    this.startPolling();
  }

  startPolling(): void {
    if (typeof window === 'undefined') return;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.isPaused || this.autoRefreshInterval <= 0) return;

    this.timer = window.setInterval(() => {
      void this.pollCycle();
    }, this.autoRefreshInterval);
  }

  private startSparklinePolling(): void {
    if (typeof window === 'undefined') return;
    if (this.sparklineTimer !== null) window.clearInterval(this.sparklineTimer);
    this.sparklineTimer = window.setInterval(() => {
      void this.refreshSparklines();
    }, 30_000);
  }

  /** Stop every timer. Called when the shell unmounts. */
  destroy(): void {
    if (typeof window === 'undefined') return;
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.sparklineTimer !== null) window.clearInterval(this.sparklineTimer);
    this.timer = null;
    this.sparklineTimer = null;
  }

  /* ---------------------------------------------------------------- */
  /* Telemetry engine                                                  */
  /* ---------------------------------------------------------------- */

  /** One collector cycle. Guarded so overlapping ticks cannot interleave. */
  async pollCycle(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const now = Date.now();
      const telemetry: Record<string, MetricDataPoint | null> = { ...this.activeTelemetry };
      const servers = [...this.servers];
      const changedServers: ServerAsset[] = [];
      const newLogRows: LogEntry[] = [];
      const newTelemetryRows: { serverId: string; timestamp: number; metrics: MetricDataPoint }[] = [];
      const openedIncidents: Incident[] = [];

      let alarms = [...this.alarms];

      for (let index = 0; index < servers.length; index++) {
        const server = servers[index];
        if (!server) continue;
        if (server.status === 'offline' || server.status === 'maintenance') continue;

        const previous = telemetry[server.id] ?? { ...BOOTSTRAP_SAMPLE, timestamp: now - 15_000 };
        const metrics = nextSample(previous, now);
        telemetry[server.id] = metrics;
        newTelemetryRows.push({ serverId: server.id, timestamp: now, metrics });

        const logEntry = this.buildLogEntry(server.id, metrics, now);
        if (logEntry) newLogRows.push(logEntry);

        // Rules bound to this host plus the fleet-scoped rules.
        const batch = evaluateRules(alarms, server.id, metrics, now);
        if (batch.evaluations.length > 0) alarms = applyEvaluations(alarms, batch.evaluations);

        for (const evaluation of batch.triggered) {
          openedIncidents.push(
            incidentFromAlarm(evaluation.rule, server, server.id, evaluation.breachedValue, now)
          );
        }

        // The heartbeat always advances, even when the derived status is stable.
        const updated: ServerAsset = {
          ...server,
          status: deriveStatus(metrics),
          lastHeartbeat: now,
          updatedAt: now
        };
        servers[index] = updated;
        changedServers.push(updated);
      }

      const cutoff = now - 7 * 24 * 60 * 60 * 1000;
      await db.transaction(
        'rw',
        [db.servers, db.telemetry, db.alarms, db.logs, db.incidents],
        async () => {
          if (changedServers.length > 0) await db.servers.bulkPut(plain(changedServers));
          if (newTelemetryRows.length > 0) await db.telemetry.bulkAdd(plain(newTelemetryRows));
          if (newLogRows.length > 0) await db.logs.bulkAdd(plain(newLogRows));
          await db.alarms.bulkPut(plain(alarms));
          if (openedIncidents.length > 0) await db.incidents.bulkAdd(plain(openedIncidents));
          await db.telemetry.where('timestamp').below(cutoff).delete();
          await db.logs.where('timestamp').below(cutoff).delete();
        }
      );

      this.activeTelemetry = telemetry;
      this.servers = servers;
      this.alarms = alarms;
      if (openedIncidents.length > 0) this.incidents = [...openedIncidents, ...this.incidents];
      this.lastPollAt = now;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Telemetry cycle failed';
    } finally {
      this.isPolling = false;
    }
  }

  /** Build a log line for a sample, or null when the sample is unremarkable. */
  private buildLogEntry(serverId: string, metrics: MetricDataPoint, now: number): LogEntry | null {
    const base = {
      id: generateEntityId(ID_PREFIXES.log),
      serverId,
      timestamp: now,
      service: 'telemetry-agent'
    };

    if (metrics.cpuUsage > 90 || metrics.latencyMs > 250) {
      return {
        ...base,
        level: 'ERROR',
        message: `Resource breach: CPU ${metrics.cpuUsage}%, memory ${metrics.memoryUsage}%, latency ${metrics.latencyMs}ms`
      };
    }
    if (metrics.cpuUsage > 75 || metrics.latencyMs > 100) {
      return {
        ...base,
        level: 'WARN',
        message: `Elevated load detected: CPU ${metrics.cpuUsage}%, latency ${metrics.latencyMs}ms`
      };
    }
    if (metrics.memoryUsage > 88) {
      return {
        ...base,
        level: 'WARN',
        message: `Memory pressure: ${metrics.memoryUsage}% of the configured heap is resident`
      };
    }
    if (Math.random() < 0.22) {
      return {
        ...base,
        level: 'INFO',
        message: `Heartbeat acknowledged: in ${metrics.networkInKbps} Kbps, out ${metrics.networkOutKbps} Kbps`
      };
    }
    return null;
  }

  /** Load one metric's history for a server and summarise it for the chart. */
  async loadMetricSeries(
    serverId: string,
    metric: MetricType,
    sinceMs: number,
    maxPoints = 240
  ): Promise<MetricSeries> {
    const records = await db.telemetry
      .where('[serverId+timestamp]')
      .between([serverId, sinceMs], [serverId, Date.now()], true, true)
      .toArray();

    const ordered = records.sort((a, b) => a.timestamp - b.timestamp);
    const stride = Math.max(1, Math.ceil(ordered.length / maxPoints));
    const sampled = stride > 1 ? ordered.filter((_, index) => index % stride === 0) : ordered;

    return summarizeMetricSeries(
      metric,
      METRIC_UNITS[metric],
      sampled.map((record) => record.timestamp),
      sampled.map((record) => extractMetricValue(record.metrics, metric)),
      5
    );
  }

  /** Refresh the per-server CPU trend used by the table Sparkline column. */
  async refreshSparklines(windowMs = 60 * 60 * 1000, points = 24): Promise<void> {
    if (typeof window === 'undefined') return;
    const since = Date.now() - windowMs;
    const records = await db.telemetry.where('timestamp').above(since).toArray();

    const grouped = new Map<string, number[]>();
    for (const record of records) {
      const bucket = grouped.get(record.serverId);
      if (bucket) bucket.push(record.metrics.cpuUsage);
      else grouped.set(record.serverId, [record.metrics.cpuUsage]);
    }

    const next: Record<string, number[]> = {};
    for (const server of this.servers) next[server.id] = (grouped.get(server.id) ?? []).slice(-points);
    this.sparklines = next;
  }

  /** CPU trend for a server, or an empty series while the cache is warming. */
  sparklineFor(serverId: string): number[] {
    return this.sparklines[serverId] ?? [];
  }

  /* ---------------------------------------------------------------- */
  /* Asset CRUD                                                        */
  /* ---------------------------------------------------------------- */

  /** Register a new instance. */
  async createServer(draft: ServerAssetDraft): Promise<ServerAsset> {
    const now = Date.now();
    const id = `${ID_PREFIXES.server}-${generateEntityId('x').slice(2)}`;
    const server: ServerAsset = {
      id,
      name: draft.name,
      hostname: draft.hostname,
      ipAddress: draft.ipAddress,
      region: draft.region,
      availabilityZone: draft.availabilityZone,
      environment: draft.environment,
      status: draft.status,
      tags: sanitizeTags(draft.tags),
      specs: {
        cpuCores: draft.cpuCores,
        memoryGb: draft.memoryGb,
        diskGb: draft.diskGb,
        architecture: draft.architecture
      },
      description: draft.description.trim() || undefined,
      owner: draft.owner.trim() || undefined,
      provisionedBy: draft.provisionedBy.trim() || undefined,
      lastHeartbeat: now,
      createdAt: now,
      updatedAt: now
    };

    const sample = nextSample(BOOTSTRAP_SAMPLE, now);
    await db.transaction('rw', [db.servers, db.telemetry], async () => {
      await db.servers.add(plain(server));
      await db.telemetry.add(plain({ serverId: id, timestamp: now, metrics: sample }));
    });

    this.servers = [...this.servers, server].sort((a, b) => a.name.localeCompare(b.name));
    this.activeTelemetry = { ...this.activeTelemetry, [id]: sample };
    await this.refreshSparklines();
    return server;
  }

  /** Patch an existing asset. Only the supplied fields are overwritten. */
  async updateServer(id: string, patch: Partial<ServerAssetDraft>): Promise<ServerAsset> {
    const current = this.servers.find((server) => server.id === id);
    if (!current) throw new Error(`Unknown instance: ${id}`);

    const updated: ServerAsset = {
      ...current,
      name: patch.name ?? current.name,
      hostname: patch.hostname ?? current.hostname,
      ipAddress: patch.ipAddress ?? current.ipAddress,
      region: patch.region ?? current.region,
      availabilityZone: patch.availabilityZone ?? current.availabilityZone,
      environment: patch.environment ?? current.environment,
      status: patch.status ?? current.status,
      description:
        patch.description === undefined
          ? current.description
          : patch.description.trim() || undefined,
      owner: patch.owner === undefined ? current.owner : patch.owner.trim() || undefined,
      provisionedBy:
        patch.provisionedBy === undefined
          ? current.provisionedBy
          : patch.provisionedBy.trim() || undefined,
      tags: patch.tags ? sanitizeTags(patch.tags) : current.tags,
      specs: {
        cpuCores: patch.cpuCores ?? current.specs.cpuCores,
        memoryGb: patch.memoryGb ?? current.specs.memoryGb,
        diskGb: patch.diskGb ?? current.specs.diskGb,
        architecture: patch.architecture ?? current.specs.architecture
      },
      updatedAt: Date.now()
    };

    await db.servers.put(plain(updated));
    this.servers = this.servers.map((server) => (server.id === id ? updated : server));
    return updated;
  }

  /**
   * Remove an asset and every row that belongs to it.
   *
   * Alarm rules must be swept in the same transaction: leaving them behind
   * produces rules that reference a server id nothing can resolve, and those
   * orphans still count towards the active-alarm rollup on the shell.
   */
  async deleteServer(id: string): Promise<void> {
    await db.transaction(
      'rw',
      [db.servers, db.telemetry, db.logs, db.incidents, db.alarms],
      async () => {
        await db.servers.delete(id);
        await db.telemetry.where('serverId').equals(id).delete();
        await db.logs.where('serverId').equals(id).delete();
        await db.incidents.where('serverId').equals(id).delete();
        await db.alarms.where('serverId').equals(id).delete();
      }
    );

    this.servers = this.servers.filter((server) => server.id !== id);
    this.incidents = this.incidents.filter((incident) => incident.serverId !== id);
    this.alarms = this.alarms.filter((alarm) => alarm.serverId !== id);

    const nextTelemetry = { ...this.activeTelemetry };
    delete nextTelemetry[id];
    this.activeTelemetry = nextTelemetry;

    const nextSpark = { ...this.sparklines };
    delete nextSpark[id];
    this.sparklines = nextSpark;
  }

  /* ---------------------------------------------------------------- */
  /* Alarm CRUD                                                        */
  /* ---------------------------------------------------------------- */

  /** Create an alarm rule. */
  async createAlarm(draft: AlarmRuleDraft): Promise<AlarmRule> {
    const now = Date.now();
    const rule: AlarmRule = {
      id: generateEntityId(ID_PREFIXES.alarm),
      serverId: draft.serverId,
      name: draft.name,
      metric: draft.metric,
      operator: draft.operator,
      threshold: draft.threshold,
      evaluationPeriods: draft.evaluationPeriods,
      periodSeconds: draft.periodSeconds,
      state: 'INSUFFICIENT_DATA',
      enabled: draft.enabled,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now,
      createdAt: now
    };

    await db.alarms.add(plain(rule));
    this.alarms = [...this.alarms, rule].sort((a, b) => a.name.localeCompare(b.name));
    return rule;
  }

  /** Patch an alarm rule. */
  async updateAlarm(id: string, patch: Partial<AlarmRuleDraft>): Promise<AlarmRule> {
    const current = this.alarms.find((rule) => rule.id === id);
    if (!current) throw new Error(`Unknown alarm rule: ${id}`);

    const updated: AlarmRule = plain({ ...current, ...patch });
    await db.alarms.put(plain(updated));
    this.alarms = this.alarms.map((rule) => (rule.id === id ? updated : rule));
    return updated;
  }

  /** Enable or disable a rule. */
  async setAlarmEnabled(id: string, enabled: boolean): Promise<void> {
    await this.updateAlarm(id, { enabled });
  }

  /** Operator override of the alarm state, e.g. acknowledging a false positive. */
  async setAlarmState(id: string, state: AlarmState): Promise<void> {
    const current = this.alarms.find((rule) => rule.id === id);
    if (!current) throw new Error(`Unknown alarm rule: ${id}`);
    const now = Date.now();
    const updated: AlarmRule = plain({
      ...current,
      state,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now
    });
    await db.alarms.put(updated);
    this.alarms = this.alarms.map((rule) => (rule.id === id ? updated : rule));
  }

  /** Delete a rule and detach it from any incident that referenced it. */
  async deleteAlarm(id: string): Promise<void> {
    const attached = await db.incidents.filter((incident) => incident.alarmRuleId === id).toArray();
    const detached = attached.map<Incident>((incident) => ({ ...incident, alarmRuleId: null }));

    await db.transaction('rw', [db.alarms, db.incidents], async () => {
      await db.alarms.delete(id);
      if (detached.length > 0) await db.incidents.bulkPut(plain(detached));
    });

    this.alarms = this.alarms.filter((rule) => rule.id !== id);
    this.incidents = this.incidents.map((incident) =>
      incident.alarmRuleId === id ? { ...incident, alarmRuleId: null } : incident
    );
  }

  /* ---------------------------------------------------------------- */
  /* Incident lifecycle                                                */
  /* ---------------------------------------------------------------- */

  /** Append an operator note. The timeline is append-only, never rewritten. */
  async appendIncidentNote(incidentId: string, message: string, author: string): Promise<void> {
    const current = this.incidents.find((incident) => incident.id === incidentId);
    if (!current) throw new Error(`Unknown incident: ${incidentId}`);

    const event: IncidentTimelineEvent = {
      id: generateEntityId(ID_PREFIXES.event),
      timestamp: Date.now(),
      message,
      author
    };

    const updated: Incident = plain({ ...current, timeline: [...current.timeline, event] });
    await db.incidents.put(updated);
    this.incidents = this.incidents.map((incident) =>
      incident.id === incidentId ? updated : incident
    );
  }

  /**
   * Move an incident to another lifecycle state, recording the transition on
   * the timeline and stamping `resolvedAt` on the terminal transition.
   */
  async transitionIncident(
    incidentId: string,
    status: IncidentStatus,
    author: string
  ): Promise<void> {
    const current = this.incidents.find((incident) => incident.id === incidentId);
    if (!current) throw new Error(`Unknown incident: ${incidentId}`);
    if (current.status === status) return;

    const now = Date.now();
    const event: IncidentTimelineEvent = {
      id: generateEntityId(ID_PREFIXES.event),
      timestamp: now,
      message: `Status changed from ${current.status} to ${status}`,
      author,
      statusTransition: status
    };

    const updated: Incident = plain({
      ...current,
      status,
      resolvedAt: status === 'resolved' ? now : current.resolvedAt,
      timeline: [...current.timeline, event]
    });

    await db.incidents.put(updated);
    this.incidents = this.incidents.map((incident) =>
      incident.id === incidentId ? updated : incident
    );
  }

  /** Change the severity of an incident and record the rationale. */
  async setIncidentSeverity(
    incidentId: string,
    severity: Incident['severity'],
    author: string
  ): Promise<void> {
    const current = this.incidents.find((incident) => incident.id === incidentId);
    if (!current) throw new Error(`Unknown incident: ${incidentId}`);
    if (current.severity === severity) return;

    const event: IncidentTimelineEvent = {
      id: generateEntityId(ID_PREFIXES.event),
      timestamp: Date.now(),
      message: `Severity changed from ${current.severity} to ${severity}`,
      author,
      statusTransition: current.status
    };

    const updated: Incident = plain({ ...current, severity, timeline: [...current.timeline, event] });
    await db.incidents.put(updated);
    this.incidents = this.incidents.map((incident) =>
      incident.id === incidentId ? updated : incident
    );
  }

  /** Raise an incident manually, e.g. for an issue no alarm covers. */
  async raiseIncident(input: {
    serverId: string;
    title: string;
    severity: Incident['severity'];
    author: string;
  }): Promise<Incident> {
    const now = Date.now();
    const server = this.servers.find((item) => item.id === input.serverId);
    const incident: Incident = {
      id: generateEntityId(ID_PREFIXES.incident),
      serverId: input.serverId,
      serverName: server?.name ?? input.serverId,
      alarmRuleId: null,
      title: input.title,
      severity: input.severity,
      status: 'open',
      startedAt: now,
      resolvedAt: null,
      timeline: [
        {
          id: generateEntityId(ID_PREFIXES.event),
          timestamp: now,
          message: 'Incident raised manually',
          author: input.author,
          statusTransition: 'open'
        }
      ]
    };

    await db.incidents.add(plain(incident));
    this.incidents = [incident, ...this.incidents];
    return incident;
  }
}

export const monitorStore = new MonitorState();
