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

export async function seedInitialDataIfEmpty(): Promise<void> {
  const serverCount = await db.servers.count();
  if (serverCount > 0) return;

  const now = Date.now();
  const initialServers: ServerAsset[] = [
    {
      id: 'srv-use1-api-01',
      name: 'prod-use1-api-gw-01',
      hostname: 'api-gw-01.us-east-1.internal',
      ipAddress: '10.0.12.4',
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      environment: 'production',
      status: 'healthy',
      tags: { service: 'gateway', tier: 'edge', team: 'platform' },
      specs: { cpuCores: 8, memoryGb: 32, diskGb: 200, architecture: 'arm64' },
      description: 'Primary ingress gateway handling external traffic',
      owner: 'infra-team',
      provisionedBy: 'terraform',
      lastHeartbeat: now,
      createdAt: now - 86400000 * 30,
      updatedAt: now
    },
    {
      id: 'srv-use1-api-02',
      name: 'prod-use1-api-gw-02',
      hostname: 'api-gw-02.us-east-1.internal',
      ipAddress: '10.0.12.5',
      region: 'us-east-1',
      availabilityZone: 'us-east-1b',
      environment: 'production',
      status: 'healthy',
      tags: { service: 'gateway', tier: 'edge', team: 'platform' },
      specs: { cpuCores: 8, memoryGb: 32, diskGb: 200, architecture: 'arm64' },
      description: 'Secondary ingress gateway cluster node',
      owner: 'infra-team',
      provisionedBy: 'terraform',
      lastHeartbeat: now,
      createdAt: now - 86400000 * 30,
      updatedAt: now
    },
    {
      id: 'srv-use1-db-primary',
      name: 'prod-use1-postgres-primary',
      hostname: 'pg-primary.us-east-1.internal',
      ipAddress: '10.0.20.10',
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      environment: 'production',
      status: 'healthy',
      tags: { service: 'database', engine: 'postgresql', tier: 'data' },
      specs: { cpuCores: 16, memoryGb: 64, diskGb: 1000, architecture: 'x86_64' },
      description: 'Primary relational database node',
      owner: 'dba-team',
      provisionedBy: 'ansible',
      lastHeartbeat: now,
      createdAt: now - 86400000 * 60,
      updatedAt: now
    },
    {
      id: 'srv-euw1-k8s-node-01',
      name: 'prod-euw1-k8s-worker-01',
      hostname: 'k8s-w01.eu-west-1.internal',
      ipAddress: '10.1.10.45',
      region: 'eu-west-1',
      availabilityZone: 'eu-west-1a',
      environment: 'production',
      status: 'warning',
      tags: { cluster: 'eu-core', role: 'worker', team: 'platform' },
      specs: { cpuCores: 8, memoryGb: 32, diskGb: 300, architecture: 'x86_64' },
      description: 'Kubernetes worker node running batch workers',
      owner: 'platform-team',
      provisionedBy: 'kops',
      lastHeartbeat: now,
      createdAt: now - 86400000 * 20,
      updatedAt: now
    },
    {
      id: 'srv-apse1-redis-01',
      name: 'prod-apse1-cache-cluster-01',
      hostname: 'redis-01.ap-southeast-1.internal',
      ipAddress: '10.2.5.18',
      region: 'ap-southeast-1',
      availabilityZone: 'ap-southeast-1a',
      environment: 'production',
      status: 'healthy',
      tags: { service: 'cache', engine: 'redis', tier: 'data' },
      specs: { cpuCores: 4, memoryGb: 16, diskGb: 100, architecture: 'arm64' },
      description: 'Session store Redis cluster leader',
      owner: 'backend-team',
      provisionedBy: 'terraform',
      lastHeartbeat: now,
      createdAt: now - 86400000 * 15,
      updatedAt: now
    },
    {
      id: 'srv-stg-auth-01',
      name: 'staging-use1-auth-srv-01',
      hostname: 'auth-stg.us-east-1.internal',
      ipAddress: '10.0.99.12',
      region: 'us-east-1',
      availabilityZone: 'us-east-1c',
      environment: 'staging',
      status: 'healthy',
      tags: { service: 'auth', tier: 'backend', env: 'staging' },
      specs: { cpuCores: 4, memoryGb: 16, diskGb: 100, architecture: 'arm64' },
      description: 'Staging OAuth identity token service',
      owner: 'secops',
      provisionedBy: 'terraform',
      lastHeartbeat: now,
      createdAt: now - 86400000 * 10,
      updatedAt: now
    }
  ];

  await db.servers.bulkAdd(initialServers);

  const initialAlarms: AlarmRule[] = [
    {
      id: 'alm-cpu-high-global',
      serverId: 'all',
      name: 'Global High CPU Utilization',
      metric: 'cpu',
      operator: 'GT',
      threshold: 85,
      evaluationPeriods: 2,
      periodSeconds: 10,
      state: 'OK',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now,
      createdAt: now
    },
    {
      id: 'alm-mem-high-db',
      serverId: 'srv-use1-db-primary',
      name: 'PostgreSQL Memory Pressure',
      metric: 'memory',
      operator: 'GT',
      threshold: 90,
      evaluationPeriods: 2,
      periodSeconds: 10,
      state: 'OK',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now,
      createdAt: now
    }
  ];

  await db.alarms.bulkAdd(initialAlarms);

  for (const server of initialServers) {
    const dataPoint = {
      timestamp: now,
      cpuUsage: server.status === 'warning' ? 78.4 : 32.5,
      memoryUsage: 48.0,
      diskUsage: 54.2,
      networkInKbps: 3400,
      networkOutKbps: 7600,
      latencyMs: server.status === 'warning' ? 124.0 : 15.2
    };

    await db.telemetry.add({
      serverId: server.id,
      timestamp: now,
      metrics: dataPoint
    });

    await db.logs.add({
      id: `log-${server.id}-init`,
      serverId: server.id,
      timestamp: now,
      level: 'INFO',
      service: 'systemd',
      message: `System monitor initialized for instance ${server.hostname}`
    });
  }
}
