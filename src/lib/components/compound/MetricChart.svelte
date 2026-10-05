<script lang="ts" module>
  import type { MetricSeries } from '#lib/types/monitor';

  /** Optional threshold rules drawn as horizontal guides with a label. */
  export interface ChartThreshold {
    value: number;
    label: string;
    tone: 'amber' | 'rose' | 'blue';
  }

  export interface MetricChartProps {
    /** One or two series. Two series occupy the left and right Y axes. */
    series: MetricSeries[];
    /** Height of the plot area in CSS pixels. */
    height?: number;
    /** Colour per series; defaults to the CloudWatch blue then amber. */
    colors?: string[];
    /** Horizontal threshold guides. */
    thresholds?: ChartThreshold[];
    /** Formats the scrub readout for a series. */
    formatValue?: (series: MetricSeries, value: number) => string;
    /** Formats the scrub readout timestamp. */
    formatTimestamp?: (timestamp: number) => string;
    /** Accessible description of the plot. */
    label?: string;
    /** Title rendered in the empty state. */
    emptyTitle?: string;
    /** Body copy rendered in the empty state. */
    emptyDescription?: string;
    /** Stacking behaviour when both series are present. */
    stacked?: boolean;
  }

  const DEFAULT_COLORS = ['#38bdf8', '#f59e0b'];
  const GRID_COUNT = 4;

  /** How far outside the observed range a threshold may sit to stay on-canvas. */
  const THRESHOLD_DOMAIN_FACTOR = 4;

  /** Round a domain out to a friendly axis bound. */
  function niceBound(value: number): number {
    if (value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalised = value / magnitude;
    const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
    return step * magnitude;
  }
</script>

<script lang="ts">
  import { calculateMax, calculateMin } from '#lib/utils/statistics';

  let {
    series,
    height = 240,
    colors = DEFAULT_COLORS,
    thresholds = [],
    formatValue,
    formatTimestamp,
    label = 'Telemetry time series',
    emptyTitle = 'No telemetry in range',
    emptyDescription = 'Telemetry samples land here once the collector reports for this window.',
    stacked = false
  }: MetricChartProps = $props();

  let host = $state<HTMLDivElement | null>(null);
  let width = $state(0);
  let hoverIndex = $state<number | null>(null);

  const isCompact = $derived(width > 0 && width < 640);

  const padding = $derived({
    top: isCompact ? 10 : 14,
    right: isCompact ? 30 : 38,
    bottom: isCompact ? 20 : 24,
    left: isCompact ? 34 : 46
  });

  const plotWidth = $derived(Math.max(10, width - padding.left - padding.right));
  const plotHeight = $derived(Math.max(10, height - padding.top - padding.bottom));

  const primary = $derived(series[0] ?? null);
  const secondary = $derived(series[1] ?? null);

  /**
   * Widen the data domain to include any threshold guide that is plausibly
   * near the observed range.
   *
   * An alarm threshold above every sample is precisely the case where the
   * operator wants to see the line, but a naive data-derived scale would place
   * it off-canvas and silently omit it. A threshold more than
   * {@link THRESHOLD_DOMAIN_FACTOR} times the observed maximum is treated as
   * unrelated to this window and left out so it cannot squash the series.
   */
  function domainWithThresholds(
    values: number[],
    guides: ChartThreshold[],
    padRatio = 0.12
  ): { min: number; max: number } {
    if (values.length === 0) return { min: 0, max: 1 };

    let min = calculateMin(values);
    let max = calculateMax(values);
    if (max === min) return { min: Math.max(0, min - 1), max: max + 1 };

    for (const guide of guides) {
      const value = guide.value;
      if (!Number.isFinite(value)) continue;
      if (value > max && value <= max * THRESHOLD_DOMAIN_FACTOR) max = value;
      if (value < min && value >= min * (1 / THRESHOLD_DOMAIN_FACTOR)) min = value;
    }

    const pad = (max - min) * padRatio;
    return { min: Math.max(0, min - pad), max: max + pad };
  }

  const primaryDomain = $derived.by(() =>
    domainWithThresholds(primary?.values ?? [], thresholds)
  );

  const secondaryDomain = $derived.by(() => {
    if (!secondary || secondary.values.length === 0) return primaryDomain;
    const min = calculateMin(secondary.values);
    const max = calculateMax(secondary.values);
    if (max === min) return { min: Math.max(0, min - 1), max: max + 1 };
    const pad = (max - min) * 0.12;
    return { min: Math.max(0, min - pad), max: max + pad };
  });

  const timeDomain = $derived.by(() => {
    const stamps = primary?.timestamps ?? [];
    if (stamps.length === 0) return { min: 0, max: 1 };
    return { min: stamps[0] ?? 0, max: stamps[stamps.length - 1] ?? 1 };
  });

  const hasData = $derived(
    series.length > 0 && series.some((s) => s.values.length > 0) && (primary?.timestamps.length ?? 0) > 0
  );

  function xAt(timestamp: number): number {
    const span = timeDomain.max - timeDomain.min;
    if (span <= 0) return padding.left;
    return padding.left + ((timestamp - timeDomain.min) / span) * plotWidth;
  }

  function yAt(value: number, domain: { min: number; max: number }): number {
    const span = domain.max - domain.min;
    if (span <= 0) return padding.top + plotHeight / 2;
    return padding.top + plotHeight - ((value - domain.min) / span) * plotHeight;
  }

  function buildLine(active: MetricSeries, domain: { min: number; max: number }): string {
    return active.values
      .map((value, index) => {
        const timestamp = active.timestamps[index] ?? 0;
        return `${index === 0 ? 'M' : 'L'}${xAt(timestamp).toFixed(2)},${yAt(value, domain).toFixed(2)}`;
      })
      .join(' ');
  }

  function buildArea(active: MetricSeries, domain: { min: number; max: number }): string {
    if (active.values.length === 0) return '';
    const line = buildLine(active, domain);
    const firstX = xAt(active.timestamps[0] ?? 0);
    const lastX = xAt(active.timestamps[active.timestamps.length - 1] ?? 0);
    const base = padding.top + plotHeight;
    return `${line} L${lastX.toFixed(2)},${base} L${firstX.toFixed(2)},${base} Z`;
  }

  /** Cumulative ceiling for the stacked overlay of the second series. */
  function stackedCeiling(index: number): number {
    if (!primary || !secondary) return 0;
    return (primary.values[index] ?? 0) + (secondary.values[index] ?? 0);
  }

  const leftTicks = $derived.by(() => {
    const ticks: { value: number; y: number }[] = [];
    const { min, max } = primaryDomain;
    for (let i = 0; i <= GRID_COUNT; i++) {
      const value = min + ((max - min) * i) / GRID_COUNT;
      ticks.push({ value, y: yAt(value, primaryDomain) });
    }
    return ticks;
  });

  const rightTicks = $derived.by(() => {
    if (!secondary) return [];
    const ticks: { value: number; y: number }[] = [];
    const { min, max } = secondaryDomain;
    for (let i = 0; i <= GRID_COUNT; i++) {
      const value = min + ((max - min) * i) / GRID_COUNT;
      ticks.push({ value, y: yAt(value, secondaryDomain) });
    }
    return ticks;
  });

  const xTicks = $derived.by(() => {
    const stamps = primary?.timestamps ?? [];
    if (stamps.length === 0) return [];
    const wanted = isCompact ? 3 : 5;
    const step = Math.max(1, Math.floor((stamps.length - 1) / (wanted - 1)));
    const ticks: { timestamp: number; x: number }[] = [];
    for (let i = 0; i < stamps.length; i += step) {
      const timestamp = stamps[i];
      if (timestamp === undefined) continue;
      ticks.push({ timestamp, x: xAt(timestamp) });
    }
    const last = stamps[stamps.length - 1];
    if (last !== undefined) {
      const final = { timestamp: last, x: xAt(last) };
      const previous = ticks[ticks.length - 1];
      if (!previous || Math.abs(previous.x - final.x) > 24) ticks.push(final);
    }
    return ticks;
  });

  const scrub = $derived.by(() => {
    // Bind to a local const first: reactive state is not narrowed across the closure.
    const index = hoverIndex;
    if (index === null || !primary) return null;
    const timestamp = primary.timestamps[index];
    if (timestamp === undefined) return null;
    return {
      x: xAt(timestamp),
      timestamp,
      entries: series.map((active, seriesIndex) => {
        const value = active.values[index] ?? 0;
        const domain = seriesIndex === 0 ? primaryDomain : secondaryDomain;
        return {
          series: active,
          value,
          color: colors[seriesIndex % colors.length],
          y: yAt(value, domain),
          text: formatValue
            ? formatValue(active, value)
            : `${value.toFixed(1)}${active.unit}`
        };
      })
    };
  });

  /**
   * The readout is anchored above the scrub line and clamped inside the plot so
   * a finger never covers the values it is inspecting.
   */
  const readoutBox = $derived.by(() => {
    if (!scrub) return null;
    const boxWidth = Math.min(220, Math.max(150, plotWidth * 0.6));
    const boxHeight = 22 + scrub.entries.length * 16;
    const left = Math.min(
      Math.max(padding.left, scrub.x - boxWidth / 2),
      padding.left + plotWidth - boxWidth
    );
    const rawTop = scrub.entries[0].y - 12 - boxHeight;
    const top = Math.max(padding.top, rawTop);
    return { left, top, width: boxWidth, height: boxHeight, flipped: rawTop < padding.top };
  });

  function handlePointer(event: PointerEvent) {
    if (!primary || primary.timestamps.length === 0 || width <= 0) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (localX - padding.left) / plotWidth;
    if (ratio < -0.02 || ratio > 1.02) {
      hoverIndex = null;
      return;
    }
    const clamped = Math.min(1, Math.max(0, ratio));
    const first = primary.timestamps[0] ?? 0;
    const last = primary.timestamps[primary.timestamps.length - 1] ?? 1;
    const span = last - first;
    const target = first + clamped * span;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    primary.timestamps.forEach((timestamp, index) => {
      const delta = Math.abs(timestamp - target);
      if (delta < best) {
        best = delta;
        nearest = index;
      }
    });
    hoverIndex = nearest;
  }

  function clearPointer() {
    hoverIndex = null;
  }

  function handleKey(event: KeyboardEvent) {
    if (!primary || primary.timestamps.length === 0) return;
    const last = primary.timestamps.length - 1;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      hoverIndex = Math.min(last, (hoverIndex ?? -1) + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      hoverIndex = Math.max(0, (hoverIndex ?? last + 1) - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      hoverIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      hoverIndex = last;
    } else if (event.key === 'Escape') {
      clearPointer();
    }
  }

  function formatTick(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1000) return `${Math.round(value / 100) / 10}k`;
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 10) return value.toFixed(1);
    return value.toFixed(1);
  }

  function formatClock(timestamp: number): string {
    if (formatTimestamp) return formatTimestamp(timestamp);
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  $effect(() => {
    if (!host) return;
    const element = host;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      width = entry.contentRect.width;
    });
    observer.observe(element);
    width = element.clientWidth;
    return () => observer.disconnect();
  });
</script>

<div
  bind:this={host}
  class="relative w-full"
  style={`height: ${height}px`}
  data-testid="metric-chart-host"
>
  {#if !hasData}
    <div
      data-testid="metric-chart-empty"
      class="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded border border-slate-border bg-slate-base px-4 text-center"
    >
      <svg
        viewBox="0 0 48 48"
        class="h-8 w-8 text-cw-faint"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        aria-hidden="true"
      >
        <path d="M6 38 18 24l8 9 10-16" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <p class="text-[12px] font-semibold text-cw-text">{emptyTitle}</p>
      <p class="max-w-[260px] text-[11px] leading-relaxed text-cw-muted">{emptyDescription}</p>
    </div>
  {:else}
    <!--
      The SVG is exposed as an image with a descriptive name; the keyboard
      handlers are an optional enhancement on top of that, so the generic
      "non-interactive element" a11y heuristics are intentionally suppressed.
    -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
      data-testid="metric-chart"
      class="block h-full w-full touch-none select-none"
      viewBox={`0 0 ${Math.max(width, 1)} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      tabindex="0"
      onpointermove={handlePointer}
      onpointerdown={handlePointer}
      onpointerleave={clearPointer}
      onpointercancel={clearPointer}
      onblur={clearPointer}
      onkeydown={handleKey}
    >
      <!-- horizontal gridlines -->
      {#each leftTicks as tick, index (index)}
        <line
          data-grid="true"
          x1={padding.left}
          x2={padding.left + plotWidth}
          y1={tick.y}
          y2={tick.y}
          stroke="#1e293b"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      {/each}

      <!-- threshold guides -->
      {#each thresholds as threshold (threshold.label)}
        {@const ty = yAt(threshold.value, primaryDomain)}
        {#if ty >= padding.top && ty <= padding.top + plotHeight}
          <line
            data-threshold={threshold.tone}
            x1={padding.left}
            x2={padding.left + plotWidth}
            y1={ty}
            y2={ty}
            stroke={threshold.tone === 'rose' ? '#ef4444' : threshold.tone === 'amber' ? '#f59e0b' : '#38bdf8'}
            stroke-width="1"
            stroke-dasharray="4 4"
            opacity="0.55"
            vector-effect="non-scaling-stroke"
          />
          <text
            x={padding.left + 3}
            y={ty - 3}
            fill="#64748b"
            font-size="9"
            font-family="var(--font-mono)"
          >
            {threshold.label}
          </text>
        {/if}
      {/each}

      <!-- left Y axis (capped at 32px on mobile per the responsive spec) -->
      {#each leftTicks as tick, index (index)}
        <text
          data-axis="y-left"
          x={padding.left - 6}
          y={tick.y + 3}
          text-anchor="end"
          dominant-baseline="middle"
          fill="#64748b"
          font-size={isCompact ? 10 : 10}
          font-family="var(--font-mono)"
        >
          {formatTick(tick.value)}
        </text>
      {/each}

      <!-- right Y axis for the secondary series -->
      {#each rightTicks as tick, index (index)}
        <text
          data-axis="y-right"
          x={padding.left + plotWidth + 6}
          y={tick.y + 3}
          text-anchor="start"
          dominant-baseline="middle"
          fill="#64748b"
          font-size="10"
          font-family="var(--font-mono)"
        >
          {formatTick(tick.value)}
        </text>
      {/each}

      <!-- X axis -->
      {#each xTicks as tick (tick.timestamp)}
        <text
          data-axis="x"
          x={tick.x}
          y={height - padding.bottom + 14}
          text-anchor="middle"
          fill="#64748b"
          font-size="9"
          font-family="var(--font-mono)"
        >
          {formatClock(tick.timestamp).slice(0, isCompact ? 5 : 8)}
        </text>
      {/each}

      <!-- series areas: the primary series on the left axis, then either the
           secondary series on its own right axis or its stacked ceiling -->
      {#if series[0]}
        <path
          data-area={series[0].metric}
          d={buildArea(series[0], primaryDomain)}
          fill={colors[0 % colors.length]}
          fill-opacity="0.1"
        />
      {/if}
      {#if series[1]}
        {#if stacked}
          <path
            data-area={`${series[1].metric}-stacked`}
            d={buildArea(
              { ...series[1], values: series[1].values.map((value, index) => stackedCeiling(index)) },
              primaryDomain
            )}
            fill={colors[1 % colors.length]}
            fill-opacity="0.1"
          />
        {:else}
          <path
            data-area={series[1].metric}
            d={buildArea(series[1], secondaryDomain)}
            fill={colors[1 % colors.length]}
            fill-opacity="0.1"
          />
        {/if}
      {/if}

      <!-- series lines -->
      {#each series as active, seriesIndex (active.metric)}
        <polyline
          data-series={active.metric}
          points={active.values
            .map((value, index) => {
              const timestamp = active.timestamps[index] ?? 0;
              const domain = seriesIndex === 0 ? primaryDomain : secondaryDomain;
              return `${xAt(timestamp).toFixed(2)},${yAt(value, domain).toFixed(2)}`;
            })
            .join(' ')}
          fill="none"
          stroke={colors[seriesIndex % colors.length]}
          stroke-width="1.6"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      {/each}

      <!-- scrub overlay -->
      {#if scrub && readoutBox}
        <g data-testid="chart-scrubber">
          <line
            x1={scrub.x}
            x2={scrub.x}
            y1={padding.top}
            y2={padding.top + plotHeight}
            stroke="#94a3b8"
            stroke-width="1"
            stroke-dasharray="3 3"
            vector-effect="non-scaling-stroke"
          />
          {#each scrub.entries as entry (entry.series.metric)}
            <circle
              cx={scrub.x}
              cy={entry.y}
              r="3"
              fill="#0b0f17"
              stroke={entry.color}
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
          {/each}

          <g
            data-testid="chart-readout"
            transform={`translate(${readoutBox.left}, ${readoutBox.top})`}
          >
            <rect
              width={readoutBox.width}
              height={readoutBox.height}
              rx="6"
              fill="#111827"
              stroke="#27354a"
              stroke-width="1"
            />
            <text x="8" y="13" fill="#94a3b8" font-size="10" font-family="var(--font-mono)">
              {formatClock(scrub.timestamp)}
            </text>
            {#each scrub.entries as entry, index (entry.series.metric)}
              <text
                x="8"
                y={27 + index * 16}
                fill={entry.color}
                font-size="10"
                font-family="var(--font-mono)"
              >
                {entry.series.metric}: {entry.text}
              </text>
            {/each}
          </g>
        </g>
      {/if}
    </svg>

    <!-- legend -->
    <div
      class="pointer-events-none absolute left-3 top-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"
      data-testid="metric-chart-legend"
    >
      {#each series as active, seriesIndex (active.metric)}
        <span class="flex items-center gap-1.5 font-mono text-[10px] text-cw-muted">
          <span
            class="inline-block h-[3px] w-4 rounded-full"
            style={`background:${colors[seriesIndex % colors.length]}`}
            aria-hidden="true"
          ></span>
          {active.metric}
        </span>
      {/each}
    </div>
  {/if}
</div>
