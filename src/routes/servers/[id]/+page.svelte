<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Badge from '$lib/components/primitives/Badge.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import Card from '$lib/components/primitives/Card.svelte';
  import ProgressBar from '$lib/components/primitives/ProgressBar.svelte';
  import MetricChart from '$lib/components/compound/MetricChart.svelte';
  import LogConsole from '$lib/components/compound/LogConsole.svelte';
  import RefreshRateDropdown from '$lib/components/compound/RefreshRateDropdown.svelte';
  import StatusSummaryCard from '$lib/components/compound/StatusSummaryCard.svelte';
  import TimeRangeSelector from '$lib/components/compound/TimeRangeSelector.svelte';
  import { monitorStore } from '$lib/stores/monitorStore.svelte';
  import { db, getLogsForServer } from '$lib/db';
  import { METRIC_LABELS, METRIC_ORDER } from '$lib/utils/alarmUtils';
  import { describeThreshold } from '$lib/utils/alarmUtils';
  import { durationForTimeRange, formatBytes, formatRelativeTime } from '$lib/utils/formatting';
  import type {
    AlarmRule,
    LogEntry,
    MetricSeries,
    MetricType,
    TimeRangeValue
  } from '$lib/types/monitor';

  const serverId = $derived(page.params.id ?? '');

  const server = $derived(monitorStore.servers.find((item) => item.id === serverId) ?? null);
  const live = $derived(monitorStore.activeTelemetry[serverId] ?? null);

  let range = $state<TimeRangeValue>('1h');
  let activeMetric = $state<MetricType>('cpu');
  let secondaryMetric = $state<MetricType>('memory');
  let series = $state<MetricSeries[]>([]);
  let logs = $state<LogEntry[]>([]);
  let serverAlarms = $state<AlarmRule[]>([]);
  let loadingSeries = $state(true);
  let loadingLogs = $state(true);
  let logsError = $state<string | null>(null);

  const METRIC_TABS = [
    { key: 'cpu' as MetricType, label: 'CPU' },
    { key: 'memory' as MetricType, label: 'Memory' },
    { key: 'disk' as MetricType, label: 'Disk' },
    { key: 'latency' as MetricType, label: 'Latency' }
  ];

  const serverIncidents = $derived(
    monitorStore.incidents.filter((incident) => incident.serverId === serverId)
  );

  const thresholds = $derived(
    serverAlarms
      .filter((alarm) => alarm.enabled && alarm.serverId === serverId)
      .map((alarm) => ({
        value: alarm.threshold,
        label: `${alarm.metric} ${describeThreshold(alarm).split(' ').slice(1).join(' ')}`,
        tone: (alarm.operator === 'LT' || alarm.operator === 'LTE' ? 'amber' : 'rose') as 'amber' | 'rose'
      }))
      .slice(0, 4)
  );

  async function loadSeries() {
    if (!serverId) return;
    loadingSeries = true;
    try {
      const since = Date.now() - durationForTimeRange(range);
      const primary = await monitorStore.loadMetricSeries(serverId, activeMetric, since);
      const secondary =
        secondaryMetric === activeMetric
          ? await monitorStore.loadMetricSeries(serverId, 'networkIn', since)
          : await monitorStore.loadMetricSeries(serverId, secondaryMetric, since);
      series = [primary, secondary];
    } finally {
      loadingSeries = false;
    }
  }

  async function loadAlarms() {
    if (!serverId) return;
    serverAlarms = await db.alarms
      .filter((alarm) => alarm.serverId === serverId || alarm.serverId === 'all')
      .toArray();
  }

  async function loadLogs() {
    if (!serverId) return;
    loadingLogs = true;
    logsError = null;
    try {
      logs = await getLogsForServer(serverId, 400);
    } catch (error) {
      logsError = error instanceof Error ? error.message : 'Unable to read the log store';
      logs = [];
    } finally {
      loadingLogs = false;
    }
  }

  onMount(() => {
    void loadSeries();
    void loadAlarms();
    void loadLogs();
  });

  // Re-query whenever the target, range or metric selection changes.
  $effect(() => {
    void serverId;
    void range;
    void activeMetric;
    void secondaryMetric;
    void loadSeries();
  });

  // Logs trail the telemetry store, so they refresh on the poll cadence.
  $effect(() => {
    if (monitorStore.lastPollAt) void loadLogs();
  });

  function selectTab(metric: MetricType) {
    if (metric === activeMetric) return;
    activeMetric = metric;
    secondaryMetric = secondaryMetric === metric ? (metric === 'cpu' ? 'memory' : 'cpu') : secondaryMetric;
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      {#if !server}
        <h1 class="text-lg font-semibold tracking-tight text-cw-text">Instance not found</h1>
        <p class="mt-0.5 text-[12px] text-cw-muted">
          No asset is registered under the id
          <span class="font-mono text-cw-text">{serverId}</span>.
        </p>
      {:else}
        <div class="flex flex-wrap items-center gap-2">
          <h1
            class="truncate text-lg font-semibold tracking-tight text-cw-text md:text-xl"
            data-testid="server-identity"
          >
            {server.name}
          </h1>
          <Badge variant="status" value={server.status} dot pulse={server.status === 'critical'} />
          <Badge variant="environment" size="sm" value={server.environment} />
        </div>
        <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-cw-muted">
          <span data-testid="server-hostname">{server.hostname}</span>
          <span>{server.ipAddress}</span>
          <span>{server.region} / {server.availabilityZone}</span>
          <span>heartbeat {formatRelativeTime(server.lastHeartbeat)}</span>
        </p>
      {/if}
    </div>

    {#if server}
      <div class="flex shrink-0 items-center gap-2">
        <RefreshRateDropdown
          value={monitorStore.autoRefreshInterval as 0 | 5000 | 15000 | 30000 | 60000}
          onchange={(next) => monitorStore.setRefreshInterval(next)}
        />
      </div>
    {/if}
  </div>

  {#if server}
    <Card padding="none" testId="server-specs">
      {#snippet toolbar()}
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-cw-faint">vCPU</dt>
            <dd class="tnum mt-0.5 font-mono text-[12px] text-cw-text">{server.specs.cpuCores} cores</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-cw-faint">Memory</dt>
            <dd class="tnum mt-0.5 font-mono text-[12px] text-cw-text">{server.specs.memoryGb} GB</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-cw-faint">Disk</dt>
            <dd class="tnum mt-0.5 font-mono text-[12px] text-cw-text">{server.specs.diskGb} GB</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-cw-faint">Architecture</dt>
            <dd class="mt-0.5 font-mono text-[12px] text-cw-text">{server.specs.architecture}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-cw-faint">Owner</dt>
            <dd class="mt-0.5 truncate text-[12px] text-cw-text">{server.owner ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-cw-faint">Provisioned by</dt>
            <dd class="mt-0.5 truncate font-mono text-[12px] text-cw-text">
              {server.provisionedBy ?? 'manual'}
            </dd>
          </div>
        </dl>
      {/snippet}

      {#if server.description}
        <p class="text-[12px] leading-relaxed text-cw-muted">{server.description}</p>
      {/if}

      {#if Object.keys(server.tags).length > 0}
        <ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Asset tags">
          {#each Object.entries(server.tags) as [key, value] (key)}
            <li
              class="rounded border border-slate-border-strong bg-slate-base px-2 py-0.5 font-mono text-[10px] text-cw-muted"
            >
              {key}=<span class="text-cw-text">{value}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-3">
      {#each [
        { key: 'cpu', label: 'CPU', value: live?.cpuUsage ?? 0, unit: '%', warn: 75, crit: 90 },
        { key: 'memory', label: 'Memory', value: live?.memoryUsage ?? 0, unit: '%', warn: 80, crit: 92 },
        { key: 'disk', label: 'Disk', value: live?.diskUsage ?? 0, unit: '%', warn: 75, crit: 90 },
        { key: 'latency', label: 'Latency', value: live?.latencyMs ?? 0, unit: 'ms', warn: 100, crit: 250 }
      ] as metric (metric.key)}
        {@const tone = metric.value >= metric.crit ? 'rose' : metric.value >= metric.warn ? 'amber' : 'emerald'}
        <StatusSummaryCard
          label={metric.label}
          value={`${metric.value.toFixed(1)}${metric.unit}`}
          tone={tone}
          progress={metric.unit === '%' ? metric.value : undefined}
          progressLabel={`${metric.label} utilization for ${server.name}`}
          warningThreshold={metric.warn}
          criticalThreshold={metric.crit}
          testId={`metric-${metric.key}-card`}
          tooltip={`Live ${metric.label.toLowerCase()} reading from the most recent collector sample.`}
        />
      {/each}
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card
        title="Telemetry"
        subtitle="Dual-axis utilisation over the selected window"
        padding="md"
        testId="telemetry-panel"
      >
        {#snippet actions()}
          <TimeRangeSelector bind:value={range} />
        {/snippet}

        {#snippet toolbar()}
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div
              class="scroll-strip"
              role="tablist"
              aria-label="Metric"
              data-testid="metric-tabs"
            >
              {#each METRIC_TABS as tab (tab.key)}
                <button
                  type="button"
                  role="tab"
                  data-testid="metric-tab"
                  data-metric={tab.key}
                  aria-selected={activeMetric === tab.key}
                  tabindex={activeMetric === tab.key ? 0 : -1}
                  class="h-11 shrink-0 rounded border px-3 text-[12px] font-medium transition-colors {activeMetric ===
                  tab.key
                    ? 'border-cw-accent/45 bg-cw-accent/14 text-cw-accent'
                    : 'border-slate-border-strong text-cw-muted hover:bg-white/5 hover:text-cw-text'}"
                  onclick={() => selectTab(tab.key)}
                >
                  {tab.label}
                </button>
              {/each}
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <label
                for="secondary-metric"
                class="shrink-0 text-[11px] text-cw-muted"
              >Compare</label>
              <div class="w-40">
                <select
                  id="secondary-metric"
                  data-testid="secondary-metric"
                  class="h-11 w-full cursor-pointer rounded border border-slate-border-strong bg-slate-base px-2.5 text-[12px] text-cw-text focus:border-cw-accent focus:outline-none"
                  value={secondaryMetric}
                  onchange={(event) =>
                    (secondaryMetric = event.currentTarget.value as MetricType)}
                >
                  {#each METRIC_ORDER.filter((item) => item !== activeMetric) as option (option)}
                    <option value={option}>{METRIC_LABELS[option]}</option>
                  {/each}
                </select>
              </div>
            </div>
          </div>
        {/snippet}

        {#if loadingSeries}
          <div
            class="flex h-[240px] items-center justify-center rounded border border-slate-border bg-slate-base"
            role="status"
            aria-busy="true"
            data-testid="chart-loading"
          >
            <span class="font-mono text-[11px] text-cw-muted">Querying telemetry store…</span>
          </div>
        {:else}
          <MetricChart
            {series}
            {thresholds}
            height={240}
            stacked
            label={`${METRIC_LABELS[activeMetric]} and ${METRIC_LABELS[secondaryMetric]} over the last ${range}`}
            formatValue={(item, value) => formatBytes(value)}
            emptyTitle={`No ${METRIC_LABELS[activeMetric].toLowerCase()} samples in the last ${range}`}
          />

          <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {#each series as item (item.metric)}
              <div class="rounded border border-slate-border bg-slate-base px-3 py-2">
                <dt class="truncate text-[10px] uppercase tracking-wider text-cw-faint">
                  {METRIC_LABELS[item.metric]}
                </dt>
                <dd class="tnum mt-1 font-mono text-[12px] text-cw-text">
                  <span class="text-cw-faint">avg</span> {item.average.toFixed(1)}{item.unit === 'Kbps' ? '' : item.unit}
                  <span class="ml-2 text-cw-faint">p95</span>
                  {item.p95.toFixed(1)}{item.unit === 'Kbps' ? '' : item.unit}
                </dd>
              </div>
            {/each}
          </dl>
        {/if}
      </Card>

      <div class="flex flex-col gap-4">
        <Card title="Active alarms" meta={`${serverAlarms.length}`} padding="none" testId="server-alarms">
          {#if serverAlarms.length === 0}
            <p class="px-4 py-6 text-center text-[11px] text-cw-muted">
              No alarm rules are attached to this instance or the fleet.
            </p>
          {:else}
            <ul class="divide-y divide-slate-border/70">
              {#each serverAlarms as alarm (alarm.id)}
                <li class="px-4 py-2.5">
                  <div class="flex items-start justify-between gap-2">
                    <span class="min-w-0 truncate text-[12px] text-cw-text">{alarm.name}</span>
                    <Badge variant="alarm" size="sm" value={alarm.state} dot />
                  </div>
                  <p class="mt-0.5 truncate font-mono text-[10px] text-cw-faint">
                    {describeThreshold(alarm)} · {alarm.evaluationPeriods}x{alarm.periodSeconds}s
                    {alarm.serverId === 'all' ? ' · fleet-wide' : ''}
                  </p>
                </li>
              {/each}
            </ul>
          {/if}
        </Card>

        <Card title="Open incidents" meta={`${serverIncidents.length}`} padding="none" testId="server-incidents">
          {#if serverIncidents.length === 0}
            <p class="px-4 py-6 text-center text-[11px] text-cw-muted">
              No incidents have been raised against this instance.
            </p>
          {:else}
            <ul class="divide-y divide-slate-border/70">
              {#each serverIncidents as incident (incident.id)}
                <li class="px-4 py-2.5">
                  <div class="flex items-start justify-between gap-2">
                    <span class="min-w-0 text-[12px] text-cw-text">{incident.title}</span>
                    <Badge variant="severity" size="sm" value={incident.severity} />
                  </div>
                  <p class="mt-0.5 font-mono text-[10px] text-cw-faint">
                    {incident.status} · started {formatRelativeTime(incident.startedAt)}
                  </p>
                </li>
              {/each}
            </ul>
          {/if}
        </Card>
      </div>
    </div>

    <Card
      title="Instance logs"
      subtitle="Live tail from the telemetry agent"
      padding="md"
      testId="log-panel"
    >
      {#snippet actions()}
        <Button
          variant="secondary"
          size="sm"
          testId="log-reload"
          onclick={() => void loadLogs()}
        >
          Reload
        </Button>
      {/snippet}

      {#if logsError}
        <div
          class="flex flex-col items-center gap-2 rounded border border-cw-rose/40 bg-cw-rose/10 px-4 py-8 text-center"
          data-testid="log-error"
          role="alert"
        >
          <p class="text-[12px] font-semibold text-cw-rose">Log stream unavailable</p>
          <p class="max-w-sm text-[11px] leading-relaxed text-cw-muted">{logsError}</p>
          <Button variant="secondary" size="sm" onclick={() => void loadLogs()}>Retry</Button>
        </div>
      {:else}
        <LogConsole
          entries={logs}
          loading={loadingLogs}
          totalCount={logs.length}
          label={`Log console for ${server.name}`}
        />
      {/if}
    </Card>
  {:else if !monitorStore.isLoading}
    <div
      class="flex flex-col items-center gap-3 rounded border border-slate-border bg-slate-card px-6 py-16 text-center"
      data-testid="server-not-found"
    >
      <svg
        viewBox="0 0 48 48"
        class="h-10 w-10 text-cw-faint"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <rect x="7" y="11" width="34" height="22" rx="3" />
        <path d="M17 39h14M24 33v6" stroke-linecap="round" />
        <path d="m20 22 8-6M28 22l-8-6" stroke-linecap="round" />
      </svg>
      <p class="text-[13px] font-semibold text-cw-text">Instance not found</p>
      <p class="max-w-sm text-[11px] leading-relaxed text-cw-muted">
        The requested instance is not present in the local asset inventory. It may have been
        de-registered, or the link may be stale.
      </p>
      <a
        href="/"
        class="flex h-11 items-center rounded border border-slate-border-strong px-4 text-[12px] text-cw-text transition-colors hover:bg-white/5"
      >
        Back to fleet dashboard
      </a>
    </div>
  {/if}
</div>
