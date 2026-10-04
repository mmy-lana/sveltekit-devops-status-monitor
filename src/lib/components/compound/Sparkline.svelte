<script lang="ts" module>
  export interface SparklineProps {
    /** Series to plot, oldest first. */
    values: number[];
    /** Rendered width in CSS pixels. The console spec is 80x24. */
    width?: number;
    /** Rendered height in CSS pixels. The console spec is 24. */
    height?: number;
    /** Optional stroke colour. Defaults to the CloudWatch metric blue. */
    color?: string;
    /** Fills the area under the curve with a low-opacity wash. */
    filled?: boolean;
    /** Draws a dashed guide at this value, typically an alarm threshold. */
    threshold?: number;
    /** Accessible description of the trend. */
    label?: string;
    /** Colours the stroke by the final value's severity. */
    toneByValue?: boolean;
    /** Value considered the top of the healthy band when `toneByValue` is set. */
    warningThreshold?: number;
    /** Value considered critical when `toneByValue` is set. */
    criticalThreshold?: number;
  }

  export const SPARKLINE_TONE_COLORS = {
    healthy: '#38bdf8',
    warning: '#f59e0b',
    critical: '#ef4444',
    idle: '#334155'
  } as const;
</script>

<script lang="ts">
  let {
    values,
    width = 80,
    height = 24,
    color,
    filled = true,
    threshold,
    label = 'Metric trend',
    toneByValue = false,
    warningThreshold = 75,
    criticalThreshold = 90
  }: SparklineProps = $props();

  const hasData = $derived(values.length > 0 && Number.isFinite(values[0]));
  const pad = 1.5;

  const last = $derived(hasData ? values[values.length - 1] : 0);
  const tone = $derived(
    toneByValue
      ? last >= criticalThreshold
        ? 'critical'
        : last >= warningThreshold
          ? 'warning'
          : 'healthy'
      : 'healthy'
  );
  const stroke = $derived(color ?? (hasData ? SPARKLINE_TONE_COLORS[tone] : SPARKLINE_TONE_COLORS.idle));

  const domain = $derived.by(() => {
    if (!hasData) return { min: 0, max: 1 };
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    if (rawMax === rawMin) return { min: rawMin - 1, max: rawMax + 1 };
    const padValue = (rawMax - rawMin) * 0.15;
    return { min: rawMin - padValue, max: rawMax + padValue };
  });

  const points = $derived.by(() => {
    if (!hasData) return [];
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    const span = domain.max - domain.min || 1;
    const step = values.length > 1 ? innerW / (values.length - 1) : 0;
    return values.map((value, index) => {
      const x = pad + (values.length > 1 ? index * step : innerW / 2);
      const y = pad + innerH - ((value - domain.min) / span) * innerH;
      return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
    });
  });

  const linePath = $derived(
    points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
  );

  const areaPath = $derived(
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x},${height} L${points[0].x},${height} Z`
      : ''
  );

  const thresholdY = $derived.by(() => {
    if (threshold === undefined) return null;
    const span = domain.max - domain.min || 1;
    const y = pad + (height - pad * 2) - ((threshold - domain.min) / span) * (height - pad * 2);
    return y >= 0 && y <= height ? Number(y.toFixed(2)) : null;
  });

  const trendLabel = $derived(
    !hasData
      ? `${label}: no data`
      : values.length < 2
        ? `${label}: single sample at ${last.toFixed(1)}`
        : `${label}: ${values.length} samples, latest ${last.toFixed(1)}, trend ${
            last > values[0] ? 'rising' : last < values[0] ? 'falling' : 'flat'
          }`
  );
</script>

<svg
  data-testid="sparkline"
  class="inline-block shrink-0 overflow-visible"
  width={width}
  height={height}
  viewBox={`0 0 ${width} ${height}`}
  preserveAspectRatio="none"
  role="img"
  aria-label={trendLabel}
>
  {#if hasData}
    {#if filled}
      <path d={areaPath} fill={stroke} fill-opacity="0.14" />
    {/if}
    {#if thresholdY !== null}
      <line
        x1="0"
        x2={width}
        y1={thresholdY}
        y2={thresholdY}
        stroke="#f59e0b"
        stroke-width="1"
        stroke-dasharray="2 2"
        opacity="0.7"
        vector-effect="non-scaling-stroke"
      />
    {/if}
    <path
      d={linePath}
      fill="none"
      stroke={stroke}
      stroke-width="1.4"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
    <circle
      cx={points[points.length - 1].x}
      cy={points[points.length - 1].y}
      r="1.6"
      fill={stroke}
    />
  {:else}
    <line
      x1="0"
      x2={width}
      y1={height / 2}
      y2={height / 2}
      stroke="#334155"
      stroke-width="1"
      stroke-dasharray="3 3"
      vector-effect="non-scaling-stroke"
    />
  {/if}
</svg>
