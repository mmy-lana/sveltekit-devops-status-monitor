<script lang="ts">
  import { goto } from '$app/navigation';
  import AssetFormModal from '$lib/components/domain/AssetFormModal.svelte';
  import FleetOverviewGrid from '$lib/components/domain/FleetOverviewGrid.svelte';
  import ServerListTable from '$lib/components/domain/ServerListTable.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import { filterStore } from '$lib/stores/filterStore.svelte';
  import { monitorStore } from '$lib/stores/monitorStore.svelte';
  import type { ServerAsset } from '$lib/types/monitor';

  const summary = $derived(monitorStore.fleetSummary);
  const filteredServers = $derived(
    filterStore.applyFilters(monitorStore.servers, monitorStore.activeTelemetry)
  );

  let assetFormOpen = $state(false);
  let editingServer = $state<ServerAsset | null>(null);

  function openCreate() {
    editingServer = null;
    assetFormOpen = true;
  }

  function openEdit(server: ServerAsset) {
    editingServer = server;
    assetFormOpen = true;
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-lg font-semibold tracking-tight text-cw-text md:text-xl">Fleet Overview</h1>
      <p class="mt-0.5 text-[12px] text-cw-muted">
        Live status, utilization telemetry and alarm state across every monitored instance.
      </p>
    </div>
    <Button variant="primary" size="md" testId="asset-create" onclick={openCreate}>
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

  <FleetOverviewGrid {summary} />

  <ServerListTable
    servers={filteredServers}
    totalCount={summary.totalCount}
    loading={monitorStore.isLoading}
    onedit={openEdit}
  />
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
