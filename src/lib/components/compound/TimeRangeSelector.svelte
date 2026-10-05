<script lang="ts" module>
  import type { TimeRangeFilter, TimeRangeValue } from '#lib/types/monitor';

  export interface TimeRangeSelectorProps {
    /** Two-way bound range selection. */
    value?: TimeRangeValue;
    /** Options to render. Defaults to the six console ranges. */
    options?: readonly TimeRangeFilter[];
    /** Accessible group label. */
    label?: string;
    /** Disables the whole control. */
    disabled?: boolean;
    /** Announced after a selection changes. */
    onchange?: (value: TimeRangeValue) => void;
  }
</script>

<script lang="ts">
  import { TIME_RANGE_OPTIONS } from '#lib/utils/formatting';

  let {
    value = $bindable('1h'),
    options = TIME_RANGE_OPTIONS,
    label = 'Telemetry time range',
    disabled = false,
    onchange
  }: TimeRangeSelectorProps = $props();

  function select(next: TimeRangeValue) {
    if (disabled || next === value) return;
    value = next;
    onchange?.(next);
  }

  function onkeydown(event: KeyboardEvent) {
    if (disabled) return;
    const index = options.findIndex((option) => option.value === value);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = Math.min(options.length - 1, index + 1);
    if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = options[nextIndex];
    if (!next) return;
    select(next.value);
    const buttons = (event.currentTarget as HTMLElement).querySelectorAll('button');
    buttons[nextIndex]?.focus();
  }
</script>

<div
  data-testid="time-range-selector"
  role="group"
  aria-label={label}
  class="inline-flex min-w-0 items-center rounded border border-slate-border-strong bg-slate-base p-0.5"
>
  {#each options as option (option.value)}
    <button
      type="button"
      data-testid={`time-range-${option.value}`}
      data-active={option.value === value}
      aria-pressed={option.value === value}
      tabindex={option.value === value ? 0 : -1}
      disabled={disabled}
      title={`Show the last ${option.label} of telemetry`}
      class="h-11 min-w-[44px] shrink-0 rounded px-2.5 font-mono text-[11px] font-medium transition-colors disabled:cursor-not-allowed {option.value ===
      value
        ? 'bg-cw-accent text-white'
        : 'text-cw-muted hover:bg-white/6 hover:text-cw-text'}"
      onclick={() => select(option.value)}
      onkeydown={onkeydown}
    >
      {option.label}
    </button>
  {/each}
</div>
