<script lang="ts">
  import { monitorStore } from '$lib/stores/monitorStore.svelte';
  import { filterStore } from '$lib/stores/filterStore.svelte';
  import Badge from '$lib/components/primitives/Badge.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import Card from '$lib/components/primitives/Card.svelte';
  import Input from '$lib/components/primitives/Input.svelte';
  import ProgressBar from '$lib/components/primitives/ProgressBar.svelte';
  import Select from '$lib/components/primitives/Select.svelte';
  import Table, { type TableColumn } from '$lib/components/primitives/Table.svelte';
  import Tooltip from '$lib/components/primitives/Tooltip.svelte';
  import type { ServerAsset, ServerStatus } from '$lib/types/monitor';

  const summary = $derived(monitorStore.fleetSummary);
  const filteredServers = $derived(
    filterStore.applyFilters(monitorStore.servers, monitorStore.activeTelemetry)
  );

  const STATUS_FILTERS: ReadonlyArray<{ value: ServerStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'healthy', label: 'Healthy' },
    { value: 'warning', label: 'Warning' },
    { value: 'critical', label: 'Critical' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'offline', label: 'Offline' }
  ];

  const columns: TableColumn[] = [
    { key: 'name', label: 'Instance', primary: true },
    { key: 'region', label: 'Region / AZ' },
    { key: 'environment', label: 'Env' },
    { key: 'status', label: 'Status' },
    { key: 'cpu', label: 'CPU', align: 'right', class: 'min-w-[150px]' },
    { key: 'memory', label: 'Memory', align: 'right', class: 'min-w-[150px]' },
    { key: 'latency', label: 'Latency', align: 'right' }
  ];

  const regionOptions = $derived([
    { value: 'all', label: 'All regions' },
    ...filterStore.availableRegions.map((region) => ({ value: region, label: region }))
  ]);

  const activeFilterCount = $derived(
    (filterStore.selectedStatus === 'all' ? 0 : 1) +
      (filterStore.selectedRegion === 'all' ? 0 : 1) +
      (filterStore.searchQuery.trim().length > 0 ? 1 : 0)
  );
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-lg font-semibold tracking-tight text-cw-text md:text-xl">Fleet Overview</h1>
      <p class="mt-0.5 text-[12px] text-cw-muted">
        Live status, utilization telemetry and alarm state across every monitored instance.
      </p>
    </div>
  </div>

  <div class="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-3">
    <Card padding="md" testId="summary-total">
      <div class="flex items-start justify-between gap-1">
        <p class="min-w-0 flex-1 truncate text-[11px] font-medium text-cw-muted">
          Monitored instances
        </p>
        <Tooltip
          content="Every asset in the inventory, including instances that are drained or powered down."
          triggerLabel="About monitored instances"
        />
      </div>
      <p class="tnum mt-1 font-mono text-2xl font-semibold text-cw-text" data-testid="summary-total-value">
        {summary.totalCount}
      </p>
    </Card>

    <Card padding="md" testId="summary-healthy">
      <p class="truncate text-[11px] font-medium text-cw-muted">Healthy</p>
      <p class="tnum mt-1 font-mono text-2xl font-semibold text-cw-emerald" data-testid="summary-healthy-value">
        {summary.healthyCount}
      </p>
    </Card>

    <Card padding="md" testId="summary-degraded">
      <p class="truncate text-[11px] font-medium text-cw-muted">Warning / Critical</p>
      <p class="tnum mt-1 font-mono text-2xl font-semibold text-cw-amber">
        {summary.warningCount}<span class="text-cw-rose">/{summary.criticalCount}</span>
      </p>
    </Card>

    <Card padding="md" testId="summary-cpu">
      <p class="truncate text-[11px] font-medium text-cw-muted">Fleet CPU</p>
      <p class="tnum mt-1 font-mono text-2xl font-semibold text-cw-blue" data-testid="summary-cpu-value">
        {summary.averageCpuUsage.toFixed(1)}%
      </p>
      <div class="mt-2">
        <ProgressBar value={summary.averageCpuUsage} size="sm" hideLabel label="Fleet average CPU" />
      </div>
    </Card>

    <Card padding="md" testId="summary-memory">
      <p class="truncate text-[11px] font-medium text-cw-muted">Fleet memory</p>
      <p class="tnum mt-1 font-mono text-2xl font-semibold text-cw-violet">
        {summary.averageMemoryUsage.toFixed(1)}%
      </p>
      <div class="mt-2">
        <ProgressBar
          value={summary.averageMemoryUsage}
          size="sm"
          hideLabel
          warningThreshold={80}
          label="Fleet average memory"
        />
      </div>
    </Card>

    <Card padding="md" testId="summary-incidents">
      <p class="truncate text-[11px] font-medium text-cw-muted">Alarms / Incidents</p>
      <p class="tnum mt-1 font-mono text-2xl font-semibold text-cw-text">
        {summary.activeAlarmsCount}<span class="text-cw-rose">/{summary.openIncidentsCount}</span>
      </p>
    </Card>
  </div>

  <Card
    title="Monitored instances"
    subtitle="Select a row to open the telemetry deep dive"
    meta={`${filteredServers.length} / ${summary.totalCount}`}
    padding="none"
  >
    {#snippet toolbar()}
      <div class="flex flex-col gap-2.5">
        <div class="flex flex-col gap-2.5 sm:flex-row">
          <div class="min-w-0 flex-1">
            <Input
              label="Search instances"
              name="server-search"
              type="search"
              testId="server-search"
              placeholder="Filter by name, hostname or IP address"
              bind:value={filterStore.searchQuery}
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
          <div class="sm:w-56">
            <Select
              label="Region"
              name="region-filter"
              testId="region-filter"
              options={regionOptions}
              bind:value={filterStore.selectedRegion}
            />
          </div>
        </div>

        <div class="flex items-center gap-2">
          <div class="scroll-strip min-w-0 flex-1" role="group" aria-label="Filter by status">
            {#each STATUS_FILTERS as option (option.value)}
              <button
                type="button"
                data-testid={`status-filter-${option.value}`}
                aria-pressed={filterStore.selectedStatus === option.value}
                class="flex h-11 items-center gap-1.5 rounded border px-3 text-[12px] font-medium transition-colors {filterStore
                  .selectedStatus === option.value
                  ? 'border-cw-accent/45 bg-cw-accent/14 text-cw-accent'
                  : 'border-slate-border-strong text-cw-muted hover:bg-white/5 hover:text-cw-text'}"
                onclick={() => (filterStore.selectedStatus = option.value)}
              >
                {option.value === 'all' ? option.label : option.label}
              </button>
            {/each}
          </div>

          <Button
            variant="ghost"
            size="md"
            testId="filter-reset"
            onclick={() => filterStore.reset()}
            disabled={activeFilterCount === 0}
            title="Clear all filters"
          >
            Reset
          </Button>
        </div>
      </div>
    {/snippet}

    <Table
      {columns}
      rows={filteredServers as ServerAsset[]}
      rowKey={(server: ServerAsset) => server.id}
      caption="Monitored fleet instances with live telemetry"
      loading={monitorStore.isLoading}
      loadingLabel="Loading monitored instances"
      emptyTitle="No instances match the active filters"
      emptyDescription="Clear the search query, widen the region selection or reset the status filter."
      stickyFirstColumn
    >
      {#snippet cell(server: ServerAsset, column: TableColumn)}
        {#if column.key === 'name'}
          <div class="min-w-0">
            <a
              href={`/servers/${server.id}`}
              data-testid="server-row-link"
              class="flex min-h-11 items-center truncate font-medium text-cw-text underline-offset-2 hover:text-cw-accent hover:underline"
              onclick={(event: MouseEvent) => event.stopPropagation()}
            >
              <span data-testid="server-row-name">{server.name}</span>
            </a>
            <span class="block truncate font-mono text-[10px] text-cw-faint">
              {server.hostname} · {server.ipAddress}
            </span>
          </div>
        {:else if column.key === 'region'}
          <div class="min-w-0">
            <span class="block truncate font-mono text-[11px] text-cw-text">{server.region}</span>
            <span class="block truncate font-mono text-[10px] text-cw-faint">
              {server.availabilityZone}
            </span>
          </div>
        {:else if column.key === 'environment'}
          <Badge variant="environment" size="sm" value={server.environment} />
        {:else if column.key === 'status'}
          <span data-testid="server-row-status">
            <Badge
              variant="status"
              size="sm"
              value={server.status}
              dot
              pulse={server.status === 'critical'}
            />
          </span>
        {:else if column.key === 'cpu'}
          {@const cpu = monitorStore.activeTelemetry[server.id]?.cpuUsage ?? 0}
          <div class="flex min-w-[120px] items-center justify-end gap-2">
            <ProgressBar
              value={cpu}
              size="sm"
              hideLabel
              label={`CPU utilization for ${server.name}`}
            />
            <span data-testid="cpu-value" class="tnum w-[52px] shrink-0 text-right font-mono text-[11px] text-cw-text">
              {cpu.toFixed(1)}%
            </span>
          </div>
        {:else if column.key === 'memory'}
          {@const memory = monitorStore.activeTelemetry[server.id]?.memoryUsage ?? 0}
          <div class="flex min-w-[120px] items-center justify-end gap-2">
            <ProgressBar
              value={memory}
              size="sm"
              hideLabel
              warningThreshold={80}
              criticalThreshold={92}
              label={`Memory utilization for ${server.name}`}
            />
            <span class="tnum w-[52px] shrink-0 text-right font-mono text-[11px] text-cw-text">
              {memory.toFixed(1)}%
            </span>
          </div>
        {:else if column.key === 'latency'}
          {@const latency = monitorStore.activeTelemetry[server.id]?.latencyMs ?? 0}
          <span class="tnum font-mono text-[11px] {latency > 250 ? 'text-cw-rose' : 'text-cw-text'}">
            {latency.toFixed(1)} ms
          </span>
        {/if}
      {/snippet}
    </Table>
  </Card>
</div>
