<script lang="ts" module>
  import type { RefreshRateMs } from '$lib/types/monitor';

  export interface RefreshRateOption {
    value: RefreshRateMs;
    label: string;
    /** Short badge text rendered inside the control. */
    hint: string;
  }

  export interface RefreshRateDropdownProps {
    /** Two-way bound poll interval in milliseconds. `0` means paused. */
    value?: RefreshRateMs;
    /** Options to render. Defaults to 5s, 15s, 30s, 60s and Paused. */
    options?: readonly RefreshRateOption[];
    /** Accessible name for the control. */
    label?: string;
    disabled?: boolean;
    onchange?: (value: RefreshRateMs) => void;
  }

  const DEFAULT_OPTIONS: readonly RefreshRateOption[] = [
    { value: 5000, label: 'Every 5 seconds', hint: '5s' },
    { value: 15000, label: 'Every 15 seconds', hint: '15s' },
    { value: 30000, label: 'Every 30 seconds', hint: '30s' },
    { value: 60000, label: 'Every 60 seconds', hint: '60s' },
    { value: 0, label: 'Paused', hint: 'Paused' }
  ];
</script>

<script lang="ts">
  import Select from '$lib/components/primitives/Select.svelte';

  let {
    value = $bindable<RefreshRateMs>(15000),
    options = DEFAULT_OPTIONS,
    label = 'Auto-refresh interval',
    disabled = false,
    onchange
  }: RefreshRateDropdownProps = $props();

  const selectOptions = $derived(options.map((option) => ({ value: String(option.value), label: option.label })));

  function handleChange(next: string) {
    const parsed = Number(next) as RefreshRateMs;
    value = parsed;
    onchange?.(parsed);
  }
</script>

<div data-testid="refresh-rate-dropdown" class="w-full min-w-[150px] sm:w-auto">
  <Select
    {label}
    name="refresh-rate"
    testId="refresh-rate-select"
    options={selectOptions}
    value={String(value)}
    {disabled}
    onchange={(event) => handleChange(event.currentTarget.value)}
  >
    {#snippet icon()}
      <svg
        viewBox="0 0 16 16"
        class="h-4 w-4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="5.6" />
        <path d="M8 5v3.2l2.1 1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    {/snippet}
  </Select>
</div>
