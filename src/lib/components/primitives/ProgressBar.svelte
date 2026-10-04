<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type ProgressTone = 'emerald' | 'amber' | 'rose' | 'blue' | 'slate';
  export type ProgressSize = 'sm' | 'md' | 'lg';

  export interface ProgressBarProps {
    /** Current value. Clamped into `[0, max]`. */
    value: number;
    /** Upper bound of the scale. Defaults to 100. */
    max?: number;
    /** Accessible label; also used as the visible label when `showLabel` is set. */
    label?: string;
    /** Hides the visible label but keeps it for assistive technology. */
    hideLabel?: boolean;
    /** Percentage at which the bar shifts to the warning colour. */
    warningThreshold?: number;
    /** Percentage at which the bar shifts to the critical colour. */
    criticalThreshold?: number;
    /** Forces a tone, bypassing the threshold calculation. */
    tone?: ProgressTone;
    size?: ProgressSize;
    /** Renders the numeric readout on the trailing edge. */
    showValue?: boolean;
    /** Unit suffix appended to the numeric readout. */
    unit?: string;
    /** Draws tick marks at the warning and critical thresholds. */
    showThresholds?: boolean;
    /** Renders a hatched fill once the value is at or above the critical mark. */
    criticalStriped?: boolean;
    /** Extra adornment on the trailing edge, e.g. a Badge. */
    trailing?: Snippet;
    /** `data-testid` applied to the root wrapper. */
    testId?: string;
  }

  const FILL_CLASS: Record<ProgressTone, string> = {
    emerald: 'bg-cw-emerald',
    amber: 'bg-cw-amber',
    rose: 'bg-cw-rose',
    blue: 'bg-cw-blue',
    slate: 'bg-slate-500'
  };

  const TRACK_HEIGHT: Record<ProgressSize, string> = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-2.5'
  };

  function resolveTone(
    percent: number,
    warningThreshold: number,
    criticalThreshold: number,
    forced: ProgressTone | undefined
  ): ProgressTone {
    if (forced) return forced;
    if (percent >= criticalThreshold) return 'rose';
    if (percent >= warningThreshold) return 'amber';
    return 'emerald';
  }
</script>

<script lang="ts">
  let {
    value,
    max = 100,
    label,
    hideLabel = false,
    warningThreshold = 75,
    criticalThreshold = 90,
    tone,
    size = 'md',
    showValue = false,
    unit = '%',
    showThresholds = false,
    criticalStriped = true,
    trailing,
    testId
  }: ProgressBarProps = $props();

  const safeMax = $derived(max > 0 ? max : 100);
  const clamped = $derived(Math.min(safeMax, Math.max(0, Number.isFinite(value) ? value : 0)));
  const percent = $derived((clamped / safeMax) * 100);
  const resolvedTone = $derived(
    resolveTone(percent, warningThreshold, criticalThreshold, tone)
  );
  const isCritical = $derived(resolvedTone === 'rose');
  const readout = $derived(`${clamped.toFixed(1)}${unit}`);
  const accessibleValue = $derived(
    `${label ? `${label}: ` : ''}${readout} of ${safeMax}${unit}`
  );
</script>

<div data-testid={testId ?? 'progress-bar'} class="w-full" data-tone={resolvedTone}>
  {#if (label && !hideLabel) || showValue || trailing}
    <div class="mb-1.5 flex items-baseline justify-between gap-2">
      {#if label && !hideLabel}
        <span
          class="min-w-0 truncate text-[11px] font-medium text-cw-muted"
          data-testid="progress-label"
        >
          {label}
        </span>
      {:else}
        <span class="min-w-0"></span>
      {/if}

      <span class="flex shrink-0 items-center gap-2">
        {#if showValue}
          <span
            class="tnum font-mono text-[11px] font-semibold"
            data-testid="progress-value"
            class:text-cw-emerald={resolvedTone === 'emerald'}
            class:text-cw-amber={resolvedTone === 'amber'}
            class:text-cw-rose={resolvedTone === 'rose'}
            class:text-cw-blue={resolvedTone === 'blue'}
            class:text-cw-muted={resolvedTone === 'slate'}
          >
            {readout}
          </span>
        {/if}
        {#if trailing}
          <span class="inline-flex items-center">{@render trailing()}</span>
        {/if}
      </span>
    </div>
  {/if}

  <div
    data-testid="progress-track"
    role="progressbar"
    aria-valuenow={Number(clamped.toFixed(2))}
    aria-valuemin={0}
    aria-valuemax={safeMax}
    aria-label={label ?? 'Utilization'}
    aria-valuetext={accessibleValue}
    class="relative w-full overflow-hidden rounded-full bg-slate-base ring-1 ring-inset ring-slate-border {TRACK_HEIGHT[
      size
    ]}"
  >
    <div
      data-testid="progress-fill"
      class="h-full rounded-full transition-[width] duration-300 ease-out {FILL_CLASS[resolvedTone]} {isCritical &&
      criticalStriped
        ? 'bg-[repeating-linear-gradient(45deg,currentColor_0px,currentColor_4px,transparent_4px,transparent_9px)]'
        : ''}"
      style={`width: ${percent.toFixed(2)}%`}
    ></div>
  </div>

  {#if showThresholds}
    <div
      class="relative mt-1 h-2.5 w-full font-mono text-[9px] leading-none text-cw-faint"
      aria-hidden="true"
    >
      <span
        class="absolute -translate-x-1/2"
        style={`left: ${Math.min(100, Math.max(0, warningThreshold))}%`}
      >
        ▲{warningThreshold}
      </span>
      <span
        class="absolute -translate-x-1/2"
        style={`left: ${Math.min(100, Math.max(0, criticalThreshold))}%`}
      >
        ▲{criticalThreshold}
      </span>
    </div>
  {/if}
</div>
