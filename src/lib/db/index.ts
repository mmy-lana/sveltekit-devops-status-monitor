import Dexie, { type Table } from 'dexie';
import type {
  AlarmRule,
  Incident,
  LogEntry,
  MetricDataPoint,
  ServerAsset,
  ServerTelemetryRecord
} from '$lib/types/monitor';
import { ID_PREFIXES } from '$lib/utils/id';
import { RETENTION_MS } from '$lib/utils/formatting';

/**
 * Offline-first persistence layer.
 *
 * The whole application runs against IndexedDB: SSR is disabled in
 * `src/routes/+layout.ts` so this module is only ever constructed in a browser.
 */
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ */
/* Seed data                                                           */
/* ------------------------------------------------------------------ */

/** Baseline load profile each seeded instance oscillates around. */
interface LoadProfile {
  cpu: number;
  memory: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  latency: number;
}

interface SeedServer
  extends Omit<ServerAsset, 'lastHeartbeat' | 'createdAt' | 'updatedAt' | 'profile'> {
  profile: LoadProfile;
}

const SEED_SERVERS: readonly SeedServer[] = [
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
    description: 'Primary ingress gateway terminating external TLS traffic',
    owner: 'infra-team',
    provisionedBy: 'terraform',
    profile: { cpu: 41, memory: 52, disk: 47, networkIn: 18400, networkOut: 26200, latency: 18 }
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
    description: 'Secondary ingress gateway, active-active with api-gw-01',
    owner: 'infra-team',
    provisionedBy: 'terraform',
    profile: { cpu: 44, memory: 49, disk: 47, networkIn: 17100, networkOut: 24800, latency: 17 }
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
    description: 'Primary relational database node with synchronous standby',
    owner: 'dba-team',
    provisionedBy: 'ansible',
    profile: { cpu: 55, memory: 68, disk: 63, networkIn: 9200, networkOut: 12400, latency: 9 }
  },
  {
    id: 'srv-use2-queue-01',
    name: 'prod-use2-queue-broker-01',
    hostname: 'rabbit-01.us-east-2.internal',
    ipAddress: '10.3.40.21',
    region: 'us-east-2',
    availabilityZone: 'us-east-2a',
    environment: 'production',
    status: 'healthy',
    tags: { service: 'broker', engine: 'rabbitmq', tier: 'data' },
    specs: { cpuCores: 8, memoryGb: 32, diskGb: 400, architecture: 'x86_64' },
    description: 'AMQP broker for asynchronous job dispatch',
    owner: 'backend-team',
    provisionedBy: 'terraform',
    profile: { cpu: 33, memory: 44, disk: 58, networkIn: 7400, networkOut: 11800, latency: 12 }
  },
  {
    id: 'srv-usw2-k8s-01',
    name: 'prod-usw2-k8s-worker-01',
    hostname: 'k8s-w01.us-west-2.internal',
    ipAddress: '10.1.10.45',
    region: 'us-west-2',
    availabilityZone: 'us-west-2a',
    environment: 'production',
    status: 'warning',
    tags: { cluster: 'us-core', role: 'worker', team: 'platform' },
    specs: { cpuCores: 8, memoryGb: 32, diskGb: 300, architecture: 'x86_64' },
    description: 'Kubernetes worker running the nightly batch scheduler',
    owner: 'platform-team',
    provisionedBy: 'kops',
    profile: { cpu: 78, memory: 72, disk: 61, networkIn: 21500, networkOut: 19800, latency: 126 }
  },
  {
    id: 'srv-usw2-k8s-02',
    name: 'prod-usw2-k8s-worker-02',
    hostname: 'k8s-w02.us-west-2.internal',
    ipAddress: '10.1.10.46',
    region: 'us-west-2',
    availabilityZone: 'us-west-2b',
    environment: 'production',
    status: 'healthy',
    tags: { cluster: 'us-core', role: 'worker', team: 'platform' },
    specs: { cpuCores: 8, memoryGb: 32, diskGb: 300, architecture: 'x86_64' },
    description: 'Kubernetes worker running the stateless API deployment',
    owner: 'platform-team',
    provisionedBy: 'kops',
    profile: { cpu: 47, memory: 55, disk: 61, networkIn: 16800, networkOut: 15200, latency: 21 }
  },
  {
    id: 'srv-euw1-eu-core-01',
    name: 'prod-euw1-k8s-worker-01',
    hostname: 'k8s-euw1-01.eu-west-1.internal',
    ipAddress: '10.4.10.45',
    region: 'eu-west-1',
    availabilityZone: 'eu-west-1a',
    environment: 'production',
    status: 'healthy',
    tags: { cluster: 'eu-core', role: 'worker', team: 'platform' },
    specs: { cpuCores: 16, memoryGb: 64, diskGb: 500, architecture: 'x86_64' },
    description: 'European core cluster worker handling EU customer traffic',
    owner: 'platform-team',
    provisionedBy: 'kops',
    profile: { cpu: 51, memory: 58, disk: 44, networkIn: 12300, networkOut: 14600, latency: 24 }
  },
  {
    id: 'srv-euc1-search-01',
    name: 'prod-euc1-elastic-01',
    hostname: 'es-master.eu-central-1.internal',
    ipAddress: '10.5.30.14',
    region: 'eu-central-1',
    availabilityZone: 'eu-central-1a',
    environment: 'production',
    status: 'healthy',
    tags: { service: 'search', engine: 'elasticsearch', tier: 'data' },
    specs: { cpuCores: 16, memoryGb: 128, diskGb: 2000, architecture: 'arm64' },
    description: 'Full-text search cluster master holding the product catalogue',
    owner: 'search-team',
    provisionedBy: 'ansible',
    profile: { cpu: 62, memory: 71, disk: 68, networkIn: 19800, networkOut: 24300, latency: 16 }
  },
  {
    id: 'srv-apse1-cache-01',
    name: 'prod-apse1-cache-cluster-01',
    hostname: 'redis-01.ap-southeast-1.internal',
    ipAddress: '10.2.5.18',
    region: 'ap-southeast-1',
    availabilityZone: 'ap-southeast-1a',
    environment: 'production',
    status: 'healthy',
    tags: { service: 'cache', engine: 'redis', tier: 'data' },
    specs: { cpuCores: 4, memoryGb: 16, diskGb: 100, architecture: 'arm64' },
    description: 'Session store Redis cluster leader for APAC traffic',
    owner: 'backend-team',
    provisionedBy: 'terraform',
    profile: { cpu: 29, memory: 63, disk: 39, networkIn: 13600, networkOut: 13100, latency: 34 }
  },
  {
    id: 'srv-apse2-batch-01',
    name: 'prod-apse2-batch-runner-01',
    hostname: 'batch-01.ap-southeast-2.internal',
    ipAddress: '10.6.70.31',
    region: 'ap-southeast-2',
    availabilityZone: 'ap-southeast-2a',
    environment: 'production',
    status: 'maintenance',
    tags: { service: 'batch', team: 'data-eng', tier: 'worker' },
    specs: { cpuCores: 8, memoryGb: 64, diskGb: 800, architecture: 'x86_64' },
    description: 'Spot batch runner; drained for kernel security patching',
    owner: 'data-eng',
    provisionedBy: 'ansible',
    profile: { cpu: 12, memory: 22, disk: 72, networkIn: 2100, networkOut: 3400, latency: 41 }
  },
  {
    id: 'srv-apne1-stg-auth-01',
    name: 'staging-apne1-auth-srv-01',
    hostname: 'auth-stg.ap-northeast-1.internal',
    ipAddress: '10.7.99.12',
    region: 'ap-northeast-1',
    availabilityZone: 'ap-northeast-1a',
    environment: 'staging',
    status: 'healthy',
    tags: { service: 'auth', tier: 'backend', env: 'staging' },
    specs: { cpuCores: 4, memoryGb: 16, diskGb: 100, architecture: 'arm64' },
    description: 'Staging OAuth identity token service for APAC QA',
    owner: 'secops',
    provisionedBy: 'terraform',
    profile: { cpu: 22, memory: 38, disk: 31, networkIn: 3100, networkOut: 2900, latency: 28 }
  },
  {
    id: 'srv-sae1-edge-01',
    name: 'dev-sae1-edge-sim-01',
    hostname: 'edge-sim-01.sa-east-1.internal',
    ipAddress: '10.8.55.9',
    region: 'sa-east-1',
    availabilityZone: 'sa-east-1a',
    environment: 'development',
    status: 'offline',
    tags: { service: 'edge', team: 'net-eng', tier: 'lab' },
    specs: { cpuCores: 2, memoryGb: 8, diskGb: 50, architecture: 'x86_64' },
    description: 'Traffic simulator lab box, powered down ahead of the Sao Paulo DR drill',
    owner: 'net-eng',
    provisionedBy: 'manual',
    profile: { cpu: 8, memory: 15, disk: 22, networkIn: 800, networkOut: 900, latency: 52 }
  }
];

/**
 * Deterministic PRNG (mulberry32) so the seeded fleet produces a stable,
 * reproducible telemetry shape on every fresh database.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampRound(value: number, min: number, max: number, decimals: number): number {
  const bounded = Math.min(max, Math.max(min, value));
  return Number(bounded.toFixed(decimals));
}

/**
 * Build one telemetry sample that orbits a server's baseline profile with a
 * slow sine component (workload shape) plus bounded random noise.
 */
function synthesizeSample(
  profile: LoadProfile,
  random: () => number,
  index: number,
  intervalMs: number
): MetricDataPoint {
  const phase = (index * intervalMs) / (45 * MINUTE);
  const wave = Math.sin(phase);

  const cpu = profile.cpu + wave * 9 + (random() - 0.5) * 11;
  const memory = profile.memory + Math.sin(phase / 2.4) * 4 + (random() - 0.5) * 3.2;
  const diskDrift = (index % 240) * 0.006;
  const disk = profile.disk + diskDrift + (random() - 0.5) * 1.4;
  const networkIn = profile.networkIn * (0.82 + wave * 0.16) + (random() - 0.5) * 3400;
  const networkOut = profile.networkOut * (0.85 - wave * 0.14) + (random() - 0.5) * 4100;
  const latency = profile.latency * (1 + wave * 0.28) + (random() - 0.5) * 7;

  return {
    timestamp: 0,
    cpuUsage: clampRound(cpu, 1, 100, 1),
    memoryUsage: clampRound(memory, 5, 99, 1),
    diskUsage: clampRound(disk, 5, 98, 1),
    networkInKbps: Math.max(120, Math.round(networkIn)),
    networkOutKbps: Math.max(160, Math.round(networkOut)),
    latencyMs: clampRound(latency, 1.2, 900, 1)
  };
}

/**
 * Adaptive backfill resolution: fine grained for the recent 24 hours so the
 * 1h-24h ranges are dense, coarse grained across the full 7 day retention
 * window so the 7d range still renders a meaningful curve.
 */
function buildBackfillSchedule(now: number): number[] {
  const timestamps: number[] = [];
  const recentFrom = now - DAY;

  for (let t = now - RETENTION_MS; t < recentFrom; t += 2 * HOUR) timestamps.push(t);
  for (let t = recentFrom; t <= now; t += 5 * MINUTE) timestamps.push(t);

  return timestamps;
}

const SEED_LOG_TEMPLATES: ReadonlyArray<{
  level: LogEntry['level'];
  service: string;
  message: string;
}> = [
  { level: 'INFO', service: 'telemetry-agent', message: 'Telemetry heartbeat acknowledged by collector' },
  { level: 'INFO', service: 'kernel', message: 'Scheduled routine maintenance window completed' },
  { level: 'DEBUG', service: 'connection-pool', message: 'Connection pool resized to 48 idle connections' },
  { level: 'DEBUG', service: 'telemetry-agent', message: 'Scrape completed for 12 registered metric streams' },
  { level: 'INFO', service: 'auth', message: 'Session token rotation finished without error' },
  { level: 'WARN', service: 'disk-monitor', message: 'Filesystem utilisation above the 70% advisory watermark' },
  { level: 'WARN', service: 'network', message: 'Transient packet loss observed on the primary NIC' },
  { level: 'ERROR', service: 'health-probe', message: 'Synthetic endpoint probe returned HTTP 503, retry 2/3' },
  { level: 'INFO', service: 'cert-manager', message: 'TLS leaf certificate renewed, 89 days remaining' },
  { level: 'DEBUG', service: 'kernel', message: 'CPU frequency governor set to performance' }
];

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

let seedPromise: Promise<void> | null = null;

/**
 * Populate an empty database with 12 cloud instances spanning nine global AWS
 * regions, seven days of backfilled telemetry, alarm rules, log history and
 * a resolved incident. Concurrent callers share the same in-flight promise.
 */
export async function seedInitialDataIfEmpty(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = performSeed().finally(() => {
    seedPromise = null;
  });
  return seedPromise;
}

async function performSeed(): Promise<void> {
  const existing = await db.servers.count();
  if (existing > 0) return;

  const now = Date.now();

  const servers: ServerAsset[] = SEED_SERVERS.map((seed, index) => {
    const { profile, ...asset } = seed;
    void profile;
    return {
      ...asset,
      lastHeartbeat: now - index * 1200,
      createdAt: now - (12 + index * 5) * DAY,
      updatedAt: now
    };
  });

  const telemetry: ServerTelemetryRecord[] = [];
  const logs: LogEntry[] = [];
  const schedule = buildBackfillSchedule(now);

  SEED_SERVERS.forEach((seed, serverIndex) => {
    const random = createRandom(0x9e3779b9 + serverIndex * 2654435761);

    schedule.forEach((timestamp, pointIndex) => {
      const previous = pointIndex > 0 ? schedule[pointIndex - 1] : timestamp - 2 * HOUR;
      const intervalMs = timestamp - previous;
      const sample = synthesizeSample(seed.profile, random, pointIndex, intervalMs);
      telemetry.push({ serverId: seed.id, timestamp, metrics: { ...sample, timestamp } });
    });

    const latestRecord = telemetry[telemetry.length - 1];
    if (latestRecord) {
      logs.push({
        id: `log-${seed.id}-boot`,
        serverId: seed.id,
        timestamp: latestRecord.timestamp,
        level: 'INFO',
        service: 'systemd',
        message: `System monitor initialised for instance ${seed.hostname}`
      });
    }

    const logRandom = createRandom(0x85ebca6b + serverIndex * 40503);
    const logCount = 36;
    for (let i = 0; i < logCount; i++) {
      const template = SEED_LOG_TEMPLATES[Math.floor(logRandom() * SEED_LOG_TEMPLATES.length)];
      const timestamp = now - Math.floor(logRandom() * 6 * HOUR) - i * 40_000;
      logs.push({
        id: `${ID_PREFIXES.log}-${seed.id}-${i}`,
        serverId: seed.id,
        timestamp,
        level: template.level,
        service: template.service,
        message: template.message
      });
    }
  });

  const alarms: AlarmRule[] = [
    {
      id: 'alm-fleet-cpu-critical',
      serverId: 'all',
      name: 'Fleet CPU Saturation',
      metric: 'cpu',
      operator: 'GT',
      threshold: 90,
      evaluationPeriods: 2,
      periodSeconds: 10,
      state: 'OK',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now - 2 * HOUR,
      createdAt: now - 21 * DAY
    },
    {
      id: 'alm-fleet-latency-degraded',
      serverId: 'all',
      name: 'Request Latency Degradation',
      metric: 'latency',
      operator: 'GT',
      threshold: 200,
      evaluationPeriods: 3,
      periodSeconds: 10,
      state: 'OK',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now - 6 * HOUR,
      createdAt: now - 18 * DAY
    },
    {
      id: 'alm-pg-memory-pressure',
      serverId: 'srv-use1-db-primary',
      name: 'PostgreSQL Memory Pressure',
      metric: 'memory',
      operator: 'GT',
      threshold: 88,
      evaluationPeriods: 2,
      periodSeconds: 10,
      state: 'OK',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now - 30 * HOUR,
      createdAt: now - 30 * DAY
    },
    {
      id: 'alm-es-disk-fill',
      serverId: 'srv-euc1-search-01',
      name: 'Elasticsearch Disk Fill Rate',
      metric: 'disk',
      operator: 'GTE',
      threshold: 85,
      evaluationPeriods: 4,
      periodSeconds: 10,
      state: 'INSUFFICIENT_DATA',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now,
      createdAt: now - 9 * DAY
    },
    {
      id: 'alm-gw-egress-spike',
      serverId: 'srv-use1-api-01',
      name: 'Gateway Egress Spike',
      metric: 'networkOut',
      operator: 'GT',
      threshold: 60000,
      evaluationPeriods: 2,
      periodSeconds: 10,
      state: 'OK',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now - 4 * HOUR,
      createdAt: now - 14 * DAY
    },
    {
      id: 'alm-cache-eviction-pressure',
      serverId: 'srv-apse1-cache-01',
      name: 'Redis Eviction Pressure',
      metric: 'memory',
      operator: 'GT',
      threshold: 92,
      evaluationPeriods: 2,
      periodSeconds: 10,
      state: 'OK',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now - 2 * DAY,
      createdAt: now - 26 * DAY
    },
    {
      id: 'alm-batch-underutilised',
      serverId: 'srv-apse2-batch-01',
      name: 'Batch Runner Starvation',
      metric: 'cpu',
      operator: 'LT',
      threshold: 15,
      evaluationPeriods: 6,
      periodSeconds: 10,
      state: 'OK',
      enabled: false,
      consecutiveBreaches: 0,
      lastEvaluatedAt: now,
      lastStateChangeAt: now,
      createdAt: now - 7 * DAY
    },
    {
      id: 'alm-edge-sim-offline',
      serverId: 'srv-sae1-edge-01',
      name: 'Lab Simulator Reachability',
      metric: 'latency',
      operator: 'GT',
      threshold: 40,
      evaluationPeriods: 3,
      periodSeconds: 10,
      state: 'ALARM',
      enabled: true,
      consecutiveBreaches: 5,
      lastEvaluatedAt: now,
      lastStateChangeAt: now - 47 * MINUTE,
      createdAt: now - 5 * DAY
    }
  ];

  const incidents: Incident[] = [
    {
      id: 'inc-seed-0001',
      serverId: 'srv-usw2-k8s-01',
      serverName: 'prod-usw2-k8s-worker-01',
      alarmRuleId: 'alm-fleet-latency-degraded',
      title: 'Batch scheduler latency exceeded the 200ms degradation threshold',
      severity: 'SEV-2',
      status: 'investigating',
      startedAt: now - 5 * HOUR,
      resolvedAt: null,
      timeline: [
        {
          id: 'evt-seed-0001-a',
          timestamp: now - 5 * HOUR,
          message: 'Alarm triggered: Request Latency Degradation breached at 241ms',
          author: 'Automated Monitor',
          statusTransition: 'open'
        },
        {
          id: 'evt-seed-0001-b',
          timestamp: now - 4 * HOUR - 20 * MINUTE,
          message: 'On-call acknowledged and paged the platform team',
          author: 'a.okonkwo',
          statusTransition: 'investigating'
        },
        {
          id: 'evt-seed-0001-c',
          timestamp: now - 2 * HOUR,
          message: 'Suspected noisy-neighbour pod identified; drain requested on worker-01',
          author: 'a.okonkwo'
        }
      ]
    },
    {
      id: 'inc-seed-0002',
      serverId: 'srv-sae1-edge-01',
      serverName: 'dev-sae1-edge-sim-01',
      alarmRuleId: 'alm-edge-sim-offline',
      title: 'Lab simulator stopped emitting heartbeats ahead of the DR drill',
      severity: 'SEV-3',
      status: 'mitigated',
      startedAt: now - 3 * HOUR,
      resolvedAt: null,
      timeline: [
        {
          id: 'evt-seed-0002-a',
          timestamp: now - 3 * HOUR,
          message: 'Alarm triggered: Lab Simulator Reachability breached at 52ms',
          author: 'Automated Monitor',
          statusTransition: 'open'
        },
        {
          id: 'evt-seed-0002-b',
          timestamp: now - 70 * MINUTE,
          message: 'Instance intentionally powered down for kernel patching window',
          author: 'net-eng',
          statusTransition: 'mitigated'
        }
      ]
    },
    {
      id: 'inc-seed-0003',
      serverId: 'srv-apse1-cache-01',
      serverName: 'prod-apse1-cache-cluster-01',
      alarmRuleId: 'alm-cache-eviction-pressure',
      title: 'Redis cluster failover caused a 47 minute session-store outage',
      severity: 'SEV-1',
      status: 'resolved',
      startedAt: now - 2 * DAY,
      resolvedAt: now - 2 * DAY + 47 * MINUTE,
      timeline: [
        {
          id: 'evt-seed-0003-a',
          timestamp: now - 2 * DAY,
          message: 'Alarm triggered: cache node memory breached 94%',
          author: 'Automated Monitor',
          statusTransition: 'open'
        },
        {
          id: 'evt-seed-0003-b',
          timestamp: now - 2 * DAY + 6 * MINUTE,
          message: 'Failover to the secondary replica completed automatically',
          author: 'r.tanaka',
          statusTransition: 'investigating'
        },
        {
          id: 'evt-seed-0003-c',
          timestamp: now - 2 * DAY + 31 * MINUTE,
          message: 'Connection pool limits raised after traffic shift was verified',
          author: 'r.tanaka',
          statusTransition: 'mitigated'
        },
        {
          id: 'evt-seed-0003-d',
          timestamp: now - 2 * DAY + 47 * MINUTE,
          message: 'Root cause: unbounded key TTL. Post-incident review AR-419 filed.',
          author: 'r.tanaka',
          statusTransition: 'resolved'
        }
      ]
    }
  ];

  await db.transaction(
    'rw',
    [db.servers, db.telemetry, db.alarms, db.incidents, db.logs],
    async () => {
      await db.servers.bulkAdd(servers);
      await db.telemetry.bulkAdd(telemetry);
      await db.logs.bulkAdd(logs);
      await db.alarms.bulkAdd(alarms);
      await db.incidents.bulkAdd(incidents);
    }
  );
}

/* ------------------------------------------------------------------ */
/* Query helpers                                                       */
/* ------------------------------------------------------------------ */

/** Latest telemetry sample for every server, keyed by server id. */
export async function loadLatestTelemetry(): Promise<Record<string, MetricDataPoint | null>> {
  const servers = await db.servers.toArray();
  const map: Record<string, MetricDataPoint | null> = {};

  for (const server of servers) {
    const record = await db.telemetry
      .where('[serverId+timestamp]')
      .between([server.id, Dexie.minKey], [server.id, Dexie.maxKey])
      .last();
    map[server.id] = record ? record.metrics : null;
  }

  return map;
}

/** Telemetry for a single server within `[since, now]`, oldest first. */
export async function getTelemetryRange(
  serverId: string,
  since: number,
  until = Date.now()
): Promise<MetricDataPoint[]> {
  const records = await db.telemetry
    .where('[serverId+timestamp]')
    .between([serverId, since], [serverId, until], true, true)
    .toArray();
  return records.map((record) => record.metrics);
}

/** Most recent logs for a server, newest first. */
export async function getLogsForServer(serverId: string, limit = 400): Promise<LogEntry[]> {
  const records = await db.logs.where('serverId').equals(serverId).toArray();
  return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/** Alarm rules attached to a server, or every rule when no id is supplied. */
export async function getAlarmsForServer(serverId?: string): Promise<AlarmRule[]> {
  const alarms = await db.alarms.toArray();
  if (!serverId) return alarms;
  return alarms.filter((alarm) => alarm.serverId === serverId || alarm.serverId === 'all');
}

/** Delete telemetry and log rows older than the retention window. */
export async function pruneExpiredData(now = Date.now()): Promise<number> {
  const cutoff = now - RETENTION_MS;
  const [telemetryRemoved, logsRemoved] = await Promise.all([
    db.telemetry.where('timestamp').below(cutoff).delete(),
    db.logs.where('timestamp').below(cutoff).delete()
  ]);
  return telemetryRemoved + logsRemoved;
}

/** Wipe every table. Exposed for the console-driven reset path. */
export async function resetDatabase(): Promise<void> {
  await Promise.all([
    db.servers.clear(),
    db.telemetry.clear(),
    db.alarms.clear(),
    db.incidents.clear(),
    db.logs.clear()
  ]);
}
