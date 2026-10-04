import { db, seedInitialDataIfEmpty } from '$lib/db';
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
      await seedInitialDataIfEmpty();
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
    let message = `Telemetry heartbeat: CPU ${metrics.cpuUsage}%, Latency ${metrics.latencyMs}ms`;

    if (metrics.cpuUsage > 90 || metrics.latencyMs > 250) {
      level = 'ERROR';
      message = `Critical resource threshold: CPU at ${metrics.cpuUsage}%, Latency ${metrics.latencyMs}ms`;
    } else if (metrics.cpuUsage > 75 || metrics.latencyMs > 100) {
      level = 'WARN';
      message = `High load warning: CPU at ${metrics.cpuUsage}%`;
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
