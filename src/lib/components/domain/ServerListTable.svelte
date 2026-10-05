<script lang="ts" module>
  import type { ServerAsset } from '#lib/types/monitor';

  export interface ServerListTableProps {
    /** Rows to render, already filtered and sorted by the caller. */
    servers: ServerAsset[];
    /** Number of assets in the whole inventory, for the header ratio. */
    totalCount: number;
    loading?: boolean;
    /** Requests the metadata editor for a row. */
    onedit?: (server: ServerAsset) => void;
  }
</script>

<script lang="ts">
  import Badge from '#lib/components/primitives/Badge.svelte';
  import Button from '#lib/components/primitives/Button.svelte';
  import Card from '#lib/components/primitives/Card.svelte';
  import ProgressBar from '#lib/components/primitives/ProgressBar.svelte';
  import Table, { type TableColumn } from '#lib/components/primitives/Table.svelte';
  import FilterSearchToolbar from '#lib/components/compound/FilterSearchToolbar.svelte';
  import RefreshRateDropdown from '#lib/components/compound/RefreshRateDropdown.svelte';
  import Sparkline from '#lib/components/compound/Sparkline.svelte';
  import { filterStore } from '#lib/stores/filterStore.svelte';
  import { monitorStore } from '#lib/stores/monitorStore.svelte';

  let { servers, totalCount, loading = false, onedit }: ServerListTableProps = $props();

  /**
   * Hosts that are drained or powered down are excluded from the collector loop,
   * so any reading shown for them is a stale leftover. Presenting a frozen bar
   * next to a live "healthy" readout invites a false conclusion, so these cells
   * render an explicit no-data marker instead.
   */
  function isReporting(server: ServerAsset): boolean {
    return server.status !== 'offline' && server.status !== 'maintenance';
  }

  const columns: TableColumn[] = [
    { key: 'name', label: 'Instance', primary: true },
    { key: 'region', label: 'Region / AZ' },
    { key: 'environment', label: 'Env' },
    { key: 'status', label: 'Status' },
    { key: 'trend', label: '1h CPU Trend' },
    { key: 'cpu', label: 'CPU', align: 'right', class: 'min-w-[150px]' },
    { key: 'memory', label: 'Memory', align: 'right', class: 'min-w-[150px]' },
    { key: 'latency', label: 'Latency', align: 'right' }
  ];
</script>

<Card
  title="Monitored instances"
  subtitle="Select a row to open the telemetry deep dive"
  meta={`${servers.length} / ${totalCount}`}
  padding="none"
  testId="server-list-card"
>
  {#snippet toolbar()}
    <FilterSearchToolbar
      bind:searchQuery={filterStore.searchQuery}
      bind:status={filterStore.selectedStatus}
      bind:region={filterStore.selectedRegion}
      bind:sortBy={filterStore.sortBy}
      bind:sortDirection={filterStore.sortDirection}
      regions={filterStore.availableRegions}
      servers={monitorStore.servers}
      onreset={() => filterStore.reset()}
    >
      <RefreshRateDropdown
        value={monitorStore.autoRefreshInterval as 0 | 5000 | 15000 | 30000 | 60000}
        onchange={(next) => monitorStore.setRefreshInterval(next)}
      />
    </FilterSearchToolbar>
  {/snippet}

  <Table
    {columns}
    rows={servers}
    rowKey={(server: ServerAsset) => server.id}
    rowHref={(server: ServerAsset) => `/servers/${server.id}`}
    caption="Monitored fleet instances with live telemetry"
    {loading}
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
          <Button
            variant="ghost"
            size="sm"
            class="mt-1 h-11 px-3"
            testId={`asset-edit-${server.id}`}
            onclick={(event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              onedit?.(server);
            }}
          >
            Edit metadata
          </Button>
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
      {:else if column.key === 'trend'}
        <div class="flex min-w-0 items-center justify-center gap-2 @min-[48rem]:justify-start">
          {#if isReporting(server)}
            <Sparkline
              values={monitorStore.sparklineFor(server.id)}
              width={80}
              height={24}
              toneByValue
              label={`CPU trend for ${server.name}`}
            />
          {:else}
            <svg
              viewBox="0 0 80 24"
              width="80"
              height="24"
              aria-hidden="true"
              data-testid="sparkline-absent"
            >
              <line
                x1="0"
                x2="80"
                y1="12"
                y2="12"
                stroke="#334155"
                stroke-width="1"
                stroke-dasharray="3 3"
                vector-effect="non-scaling-stroke"
              />
            </svg>
            <span class="font-mono text-[11px] text-cw-faint" data-testid="trend-absent">n/a</span>
          {/if}
        </div>
      {:else if column.key === 'cpu'}
        {@const cpu = monitorStore.activeTelemetry[server.id]?.cpuUsage ?? 0}
        {#if isReporting(server)}
          <div class="flex min-w-[120px] items-center justify-end gap-2">
            <ProgressBar value={cpu} size="sm" hideLabel label={`CPU utilization for ${server.name}`} />
            <span
              data-testid="cpu-value"
              class="tnum w-[52px] shrink-0 text-right font-mono text-[11px] text-cw-text"
            >
              {cpu.toFixed(1)}%
            </span>
          </div>
        {:else}
          <div
            class="flex min-w-[120px] items-center justify-end gap-2"
            data-testid="cpu-inactive"
            aria-label={`CPU utilization is not reported for ${server.name}`}
          >
            <span
              class="h-1.5 flex-1 rounded-full bg-slate-border/70 ring-1 ring-inset ring-slate-border/40 ring-dashed"
              aria-hidden="true"
            ></span>
            <span
              data-testid="cpu-value"
              class="tnum w-[52px] shrink-0 text-right font-mono text-[11px] text-cw-faint"
              >--</span
            >
          </div>
        {/if}
      {:else if column.key === 'memory'}
        {@const memory = monitorStore.activeTelemetry[server.id]?.memoryUsage ?? 0}
        {#if isReporting(server)}
          <div class="flex min-w-[120px] items-center justify-end gap-2">
            <ProgressBar
              value={memory}
              size="sm"
              hideLabel
              warningThreshold={80}
              criticalThreshold={92}
              label={`Memory utilization for ${server.name}`}
            />
            <span
              data-testid="memory-value"
              class="tnum w-[52px] shrink-0 text-right font-mono text-[11px] text-cw-text"
            >
              {memory.toFixed(1)}%
            </span>
          </div>
        {:else}
          <div
            class="flex min-w-[120px] items-center justify-end gap-2"
            data-testid="memory-inactive"
            aria-label={`Memory utilization is not reported for ${server.name}`}
          >
            <span
              class="h-1.5 flex-1 rounded-full bg-slate-border/70 ring-1 ring-inset ring-slate-border/40 ring-dashed"
              aria-hidden="true"
            ></span>
            <span
              data-testid="memory-value"
              class="tnum w-[52px] shrink-0 text-right font-mono text-[11px] text-cw-faint"
              >--</span
            >
          </div>
        {/if}
      {:else if column.key === 'latency'}
        {@const latency = monitorStore.activeTelemetry[server.id]?.latencyMs ?? 0}
        {#if isReporting(server)}
          <span
            data-testid="latency-value"
            class="tnum font-mono text-[11px] {latency > 250 ? 'text-cw-rose' : 'text-cw-text'}"
          >
            {latency.toFixed(1)} ms
          </span>
        {:else}
          <span data-testid="latency-inactive" class="font-mono text-[11px] text-cw-faint">--</span>
        {/if}
      {/if}
    {/snippet}
  </Table>
</Card>
