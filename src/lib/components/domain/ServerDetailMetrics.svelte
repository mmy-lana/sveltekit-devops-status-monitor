<script lang="ts" module>
  import type { AlarmRule, MetricSeries, MetricType, TimeRangeValue } from '#lib/types/monitor';
  import type { ChartThreshold } from '#lib/components/compound/MetricChart.svelte';

  export interface ServerDetailMetricsProps {
    /** Display name used in labels and empty copy. */
    serverName: string;
    /** Primary series on the left axis. */
    series: MetricSeries[];
    /** Comparison series on the right axis, or stacked onto the left. */
    secondarySeries: MetricSeries | null;
    /** Threshold guides drawn from the instance's own alarm rules. */
    thresholds: ChartThreshold[];
    loading?: boolean;
    onmetricchange?: (metric: MetricType) => void;
    onsecondarychange?: (metric: MetricType) => void;
    onrangechange?: (range: TimeRangeValue) => void;
    activeMetric?: MetricType;
    secondaryMetric?: MetricType;
    range?: TimeRangeValue;
  }

  export const METRIC_TABS: ReadonlyArray<{ key: MetricType; label: string }> = [
    { key: 'cpu', label: 'CPU' },
    { key: 'memory', label: 'Memory' },
    { key: 'disk', label: 'Disk' },
    { key: 'latency', label: 'Latency' }
  ] as const;
</script>

<script lang="ts">
  import Card from '#lib/components/primitives/Card.svelte';
  import MetricChart from '#lib/components/compound/MetricChart.svelte';
  import TimeRangeSelector from '#lib/components/compound/TimeRangeSelector.svelte';
  import { METRIC_LABELS, METRIC_ORDER, METRIC_UNITS } from '#lib/utils/alarmUtils';
  import { formatBytes, formatMetricValue } from '#lib/utils/formatting';

  let {
    serverName,
    series,
    secondarySeries,
    thresholds,
    loading = false,
    onmetricchange,
    onsecondarychange,
    onrangechange,
    activeMetric = 'cpu',
    secondaryMetric = 'memory',
    range = '1h'
  }: ServerDetailMetricsProps = $props();

  const chartSeries = $derived(secondarySeries ? [series[0], secondarySeries].filter(Boolean) : series);
  const secondaryOptions = $derived(
    METRIC_ORDER.filter((option) => option !== activeMetric).map((option) => ({
      value: option,
      label: METRIC_LABELS[option]
    }))
  );
</script>

<Card
  title="Telemetry"
  subtitle="Dual-axis utilisation over the selected window"
  padding="md"
  testId="telemetry-panel"
>
  {#snippet actions()}
    <TimeRangeSelector
      value={range}
      onchange={(next) => onrangechange?.(next)}
    />
  {/snippet}

  {#snippet toolbar()}
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="scroll-strip" role="tablist" aria-label="Metric" data-testid="metric-tabs">
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
            onclick={() => onmetricchange?.(tab.key)}
          >
            {tab.label}
          </button>
        {/each}
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <label for="secondary-metric" class="shrink-0 text-[11px] text-cw-muted">Compare</label>
        <div class="w-40">
          <select
            id="secondary-metric"
            data-testid="secondary-metric"
            class="h-11 w-full cursor-pointer rounded border border-slate-border-strong bg-slate-base px-2.5 text-[12px] text-cw-text focus:border-cw-accent focus:outline-none"
            value={secondaryMetric}
            onchange={(event) => onsecondarychange?.(event.currentTarget.value as MetricType)}
          >
            {#each secondaryOptions as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
      </div>
    </div>
  {/snippet}

  {#if loading}
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
      series={chartSeries}
      {thresholds}
      height={240}
      stacked
      label={`${METRIC_LABELS[activeMetric]} for ${serverName} over the last ${range}`}
      formatValue={(item, value) => formatMetricValue(value, item.unit)}
      emptyTitle={`No ${METRIC_LABELS[activeMetric].toLowerCase()} samples in the last ${range}`}
    />

    <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="series-stats">
      {#each chartSeries as item (item.metric)}
        <div class="rounded border border-slate-border bg-slate-base px-3 py-2">
          <dt class="truncate text-[10px] uppercase tracking-wider text-cw-faint">
            {METRIC_LABELS[item.metric]}
          </dt>
          <dd class="tnum mt-1 font-mono text-[12px] text-cw-text">
            <span class="text-cw-faint">avg</span>
            {item.unit === 'Kbps' ? formatBytes(item.average) : `${item.average.toFixed(1)}${item.unit}`}
            <span class="ml-2 text-cw-faint">p95</span>
            {item.unit === 'Kbps' ? formatBytes(item.p95) : `${item.p95.toFixed(1)}${item.unit}`}
          </dd>
        </div>
      {/each}
      {#if chartSeries[0]}
        {@const primary = chartSeries[0]}
        <div class="rounded border border-slate-border bg-slate-base px-3 py-2">
          <dt class="truncate text-[10px] uppercase tracking-wider text-cw-faint">
            {METRIC_LABELS[primary.metric]} peak
          </dt>
          <dd class="tnum mt-1 font-mono text-[12px] text-cw-text">
            {primary.unit === 'Kbps' ? formatBytes(primary.max) : `${primary.max.toFixed(1)}${primary.unit}`}
            <span class="ml-2 text-cw-faint">σ</span>
            {primary.unit === 'Kbps'
              ? formatBytes(primary.stdDev)
              : `${primary.stdDev.toFixed(1)}${METRIC_UNITS[primary.metric]}`}
          </dd>
        </div>
      {/if}
    </dl>
  {/if}
</Card>
