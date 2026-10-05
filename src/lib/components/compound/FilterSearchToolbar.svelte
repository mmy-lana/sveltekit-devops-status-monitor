<script lang="ts" module>
  import type { ServerAsset, ServerStatus, SortDirection, SortKey } from '$lib/types/monitor';

  export interface FilterSearchToolbarProps {
    /** Two-way bound free-text query. */
    searchQuery?: string;
    /** Two-way bound status filter. */
    status?: ServerStatus | 'all';
    /** Two-way bound region filter. */
    region?: string;
    /** Regions available across the fleet, already sorted. */
    regions: string[];
    /** Two-way bound sort column. */
    sortBy?: SortKey;
    /** Two-way bound sort direction. */
    sortDirection?: SortDirection;
    /** Full fleet, used to render the per-status result counts. */
    servers: ServerAsset[];
    /** Called when the user clears every filter. */
    onreset?: () => void;
    /** Additional controls rendered on the trailing edge of the first row. */
    children?: import('svelte').Snippet;
  }

  export type StatusFilterValue = ServerStatus | 'all';

  export const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilterValue; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'healthy', label: 'Healthy' },
    { value: 'warning', label: 'Warning' },
    { value: 'critical', label: 'Critical' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'offline', label: 'Offline' }
  ];

  export const SORT_OPTIONS: ReadonlyArray<{
    value: SortKey;
    label: string;
    shortLabel: string;
  }> = [
    { value: 'name', label: 'Instance name', shortLabel: 'Name' },
    { value: 'status', label: 'Status', shortLabel: 'Status' },
    { value: 'cpu', label: 'CPU utilization', shortLabel: 'CPU' },
    { value: 'memory', label: 'Memory utilization', shortLabel: 'Memory' },
    { value: 'latency', label: 'Request latency', shortLabel: 'Latency' }
  ];

  const SORT_FIELD: Record<SortKey, 'server-row-name' | 'server-row-status' | 'cpu-value'> = {
    name: 'server-row-name',
    status: 'server-row-status',
    cpu: 'cpu-value',
    memory: 'cpu-value',
    latency: 'cpu-value'
  };

  export function sortTestId(key: SortKey): string {
    return `sort-${key}`;
  }

  export function sortFieldFor(key: SortKey): string {
    return SORT_FIELD[key];
  }
</script>

<script lang="ts">
  import Badge from '$lib/components/primitives/Badge.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import Input from '$lib/components/primitives/Input.svelte';
  import Select from '$lib/components/primitives/Select.svelte';

  let {
    searchQuery = $bindable(''),
    status = $bindable<StatusFilterValue>('all'),
    region = $bindable('all'),
    regions,
    sortBy = $bindable<SortKey>('name'),
    sortDirection = $bindable<SortDirection>('asc'),
    servers,
    onreset,
    children
  }: FilterSearchToolbarProps = $props();

  const regionOptions = $derived([
    { value: 'all', label: 'All regions' },
    ...regions.map((item) => ({ value: item, label: item }))
  ]);

  const sortOptions = $derived(
    SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
  );

  /**
   * Per-status result counts for the pill strip.
   *
   * STATUS_FILTERS itself contains the 'all' sentinel, so zero-filling from that
   * list would overwrite the fleet total. The sentinel is therefore assigned
   * after every per-status counter has been tallied.
   */
  const statusCounts = $derived.by(() => {
    const counts = new Map<StatusFilterValue, number>();
    for (const filter of STATUS_FILTERS) counts.set(filter.value, 0);
    for (const server of servers) counts.set(server.status, (counts.get(server.status) ?? 0) + 1);
    counts.set('all', servers.length);
    return counts;
  });

  /**
   * Selecting the active column again flips the direction; picking a new column
   * starts from the most useful default (names ascending, metrics descending).
   */
  function selectSort(key: SortKey): void {
    if (sortBy === key) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = key;
      sortDirection = key === 'name' ? 'asc' : 'desc';
    }
  }

  const activeFilterCount = $derived(
    (status === 'all' ? 0 : 1) + (region === 'all' ? 0 : 1) + (searchQuery.trim().length > 0 ? 1 : 0)
  );
</script>

<div
  data-testid="filter-toolbar"
  class="flex flex-col gap-3"
>
  <!-- Row 1: search + region + sort -->
  <!--
    Row 1 wraps rather than squeezing: every control here is shrink-0 or has a
    200px floor, so at tablet widths the refresh dropdown has to drop to its own
    line instead of pushing past the viewport edge.
  -->
  <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
    <div class="min-w-[200px] flex-1">
      <Input
        label="Search instances"
        name="server-search"
        type="search"
        testId="server-search"
        placeholder="Filter by name, hostname or IP address"
        bind:value={searchQuery}
      >
        {#snippet icon()}
          <svg
            viewBox="0 0 16 16"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.4" />
            <path d="m10.4 10.4 3 3" stroke-linecap="round" />
          </svg>
        {/snippet}
      </Input>
    </div>

    <div class="w-full shrink-0 sm:w-48">
      <Select label="Region" name="region-filter" testId="region-filter" options={regionOptions} bind:value={region} />
    </div>

    <div class="w-full shrink-0 sm:w-48">
      <Select
        label="Sort by"
        name="sort-by"
        testId="sort-select"
        options={sortOptions}
        value={sortBy}
        onchange={(event) => selectSort(event.currentTarget.value as SortKey)}
      />
    </div>

    {#if children}
      <div class="flex shrink-0 items-end gap-2">{@render children()}</div>
    {/if}
  </div>

  <!-- Row 2: horizontally scrollable status pills + sort direction + reset -->
  <div class="flex items-center gap-2">
    <div class="scroll-strip min-w-0 flex-1" role="group" aria-label="Filter by status" data-testid="status-pills">
      {#each STATUS_FILTERS as option (option.value)}
        {@const count = statusCounts.get(option.value) ?? 0}
        <button
          type="button"
          data-testid={`status-filter-${option.value}`}
          aria-pressed={status === option.value}
          class="flex h-11 items-center gap-1.5 rounded border px-3 text-[12px] font-medium transition-colors {status ===
          option.value
            ? 'border-cw-accent/45 bg-cw-accent/14 text-cw-accent'
            : count === 0
              ? 'border-slate-border text-cw-faint'
              : 'border-slate-border-strong text-cw-muted hover:bg-white/5 hover:text-cw-text'}"
          onclick={() => (status = option.value)}
        >
          {#if option.value !== 'all'}
            <Badge variant="status" size="sm" value={option.value} />
          {/if}
          <span>{option.label}</span>
          <span
            class="tnum font-mono text-[10px] {status === option.value ? 'text-cw-accent' : 'text-cw-faint'}"
            data-testid={`status-count-${option.value}`}
          >
            {count}
          </span>
        </button>
      {/each}
    </div>

    <Button
      variant="icon"
      size="md"
      testId="sort-direction"
      ariaLabel={sortDirection === 'asc' ? 'Sorted ascending, activate to sort descending' : 'Sorted descending, activate to sort ascending'}
      title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
      onclick={() => (sortDirection = sortDirection === 'asc' ? 'desc' : 'asc')}
    >
      <svg
        viewBox="0 0 16 16"
        class="h-4 w-4 transition-transform {sortDirection === 'asc' ? '' : 'rotate-180'}"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 3.2 11.6 8H4.4L8 3.2ZM4.4 9.2h7.2L8 14 4.4 9.2Z" />
      </svg>
    </Button>

    <Button
      variant="ghost"
      size="md"
      testId="filter-reset"
      onclick={() => onreset?.()}
      disabled={activeFilterCount === 0}
      title="Clear all filters"
    >
      Reset
    </Button>
  </div>
</div>
