<script lang="ts">
  import { monitorStore } from '$lib/stores/monitorStore.svelte';
  import { filterStore } from '$lib/stores/filterStore.svelte';
  import Badge from '$lib/components/primitives/Badge.svelte';
  import Card from '$lib/components/primitives/Card.svelte';
  import ProgressBar from '$lib/components/primitives/ProgressBar.svelte';
  import Table, { type TableColumn } from '$lib/components/primitives/Table.svelte';
  import Sparkline from '$lib/components/compound/Sparkline.svelte';
  import StatusSummaryCard from '$lib/components/compound/StatusSummaryCard.svelte';
  import RefreshRateDropdown from '$lib/components/compound/RefreshRateDropdown.svelte';
  import FilterSearchToolbar from '$lib/components/compound/FilterSearchToolbar.svelte';
  import AssetFormModal from '$lib/components/domain/AssetFormModal.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import { goto } from '$app/navigation';
  import type { ServerAsset } from '$lib/types/monitor';

  let assetFormOpen = $state(false);
  let editingServer = $state<ServerAsset | null>(null);

  const summary = $derived(monitorStore.fleetSummary);
  const filteredServers = $derived(
    filterStore.applyFilters(monitorStore.servers, monitorStore.activeTelemetry)
  );

  const columns: TableColumn[] = [
    { key: 'name', label: 'Instance', primary: true },
    { key: 'region', label: 'Region / AZ' },
    { key: 'environment', label: 'Env' },
    { key: 'status', label: 'Status' },
    { key: 'trend', label: '1h trend' },
    { key: 'cpu', label: 'CPU', align: 'right', class: 'min-w-[150px]' },
    { key: 'memory', label: 'Memory', align: 'right', class: 'min-w-[150px]' },
    { key: 'latency', label: 'Latency', align: 'right' }
  ];
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-lg font-semibold tracking-tight text-cw-text md:text-xl">Fleet Overview</h1>
      <p class="mt-0.5 text-[12px] text-cw-muted">
        Live status, utilization telemetry and alarm state across every monitored instance.
      </p>
    </div>
    <Button
      variant="primary"
      size="md"
      testId="asset-create"
      onclick={() => {
        editingServer = null;
        assetFormOpen = true;
      }}
    >
      Register instance
    </Button>
  </div>

  {#if monitorStore.error}
    <p
      class="rounded border border-cw-rose/40 bg-cw-rose/10 px-3 py-2 text-[11px] text-cw-rose"
      role="alert"
      data-testid="store-error"
    >
      {monitorStore.error}
    </p>
  {/if}

  <div class="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-3">
    <StatusSummaryCard
      label="Monitored instances"
      value={String(summary.totalCount)}
      detail={`${summary.maintenanceCount} in maintenance · ${summary.offlineCount} offline`}
      trailing={`${summary.totalCount}`}
      tooltip="Every asset in the inventory, including instances that are drained or powered down."
      testId="summary-total"
    />
    <StatusSummaryCard
      label="Healthy"
      value={String(summary.healthyCount)}
      tone="emerald"
      progress={summary.totalCount > 0 ? (summary.healthyCount / summary.totalCount) * 100 : 0}
      progressLabel="Share of the fleet reporting healthy"
      detail={`${summary.totalCount > 0 ? Math.round((summary.healthyCount / summary.totalCount) * 100) : 0}% of fleet`}
      testId="summary-healthy"
    />
    <StatusSummaryCard
      label="Warning / Critical"
      value={String(summary.warningCount)}
      tone={summary.warningCount > 0 ? 'amber' : 'neutral'}
      trailing={`${summary.criticalCount} critical`}
      detail="Hosts reporting elevated load"
      testId="summary-degraded"
    />
    <StatusSummaryCard
      label="Fleet CPU"
      value={`${summary.averageCpuUsage.toFixed(1)}%`}
      tone="blue"
      progress={summary.averageCpuUsage}
      progressLabel="Fleet average CPU"
      detail={`P95 tracked per instance`}
      testId="summary-cpu"
    />
    <StatusSummaryCard
      label="Fleet memory"
      value={`${summary.averageMemoryUsage.toFixed(1)}%`}
      tone="violet"
      progress={summary.averageMemoryUsage}
      progressLabel="Fleet average memory"
      warningThreshold={80}
      detail="Averaged across reporting hosts"
      testId="summary-memory"
    />
    <StatusSummaryCard
      label="Alarms / Incidents"
      value={String(summary.activeAlarmsCount)}
      tone={summary.activeAlarmsCount > 0 ? 'rose' : 'neutral'}
      trailing={`${summary.openIncidentsCount} open`}
      detail="Breaching rules and tracked incidents"
      testId="summary-incidents"
    />
  </div>

  <Card
    title="Monitored instances"
    subtitle="Select a row to open the telemetry deep dive"
    meta={`${filteredServers.length} / ${summary.totalCount}`}
    padding="none"
  >
    {#snippet toolbar()}
      <FilterSearchToolbar
        bind:searchQuery={filterStore.searchQuery}
        bind:status={filterStore.selectedStatus}
        bind:region={filterStore.selectedRegion}
        bind:sortBy={filterStore.sortBy}
        bind:sortDirection={filterStore.sortDirection}
        regions={filterStore.availableRegions}
        servers={monitorStore.servers as ServerAsset[]}
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
          <div class="mt-1 flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              testId={`asset-edit-${server.id}`}
              class="h-9 px-2"
              onclick={(event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                editingServer = server;
                assetFormOpen = true;
              }}
            >
              Edit
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
          <div class="flex min-w-0 justify-center @min-[48rem]:justify-start">
            <Sparkline
              values={monitorStore.sparklineFor(server.id)}
              width={80}
              height={24}
              toneByValue
              label={`CPU trend for ${server.name}`}
            />
          </div>
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

<AssetFormModal
  open={assetFormOpen}
  server={editingServer}
  regions={[...new Set(monitorStore.servers.map((item) => item.region))].sort()}
  existingNames={monitorStore.servers.map((item) => item.name)}
  onclose={() => {
    assetFormOpen = false;
    editingServer = null;
  }}
  oncreate={async (draft) => {
    const created = await monitorStore.createServer(draft);
    assetFormOpen = false;
    editingServer = null;
    await goto(`/servers/${created.id}`);
  }}
  onupdate={async (draft) => {
    if (!editingServer) return;
    await monitorStore.updateServer(editingServer.id, draft);
    assetFormOpen = false;
    editingServer = null;
  }}
  ondelete={async () => {
    if (!editingServer) return;
    await monitorStore.deleteServer(editingServer.id);
    assetFormOpen = false;
    editingServer = null;
  }}
/>
