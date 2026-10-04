<script lang="ts">
  import { monitorStore } from '$lib/stores/monitorStore.svelte';
  import { filterStore } from '$lib/stores/filterStore.svelte';

  const filteredServers = $derived.by(() => {
    return filterStore.applyFilters(monitorStore.servers, monitorStore.activeTelemetry);
  });
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-xl font-semibold text-slate-100 tracking-tight">Fleet Overview</h1>
    <p class="text-xs text-slate-400 mt-0.5">Real-time status metrics and compute instance health checks</p>
  </div>

  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded">
      <div class="text-xs text-slate-400 font-medium">Healthy Servers</div>
      <div class="text-2xl font-mono font-semibold text-emerald-400 mt-1">
        {monitorStore.fleetSummary.healthyCount}
        <span class="text-xs text-slate-500 font-normal">/ {monitorStore.fleetSummary.totalCount}</span>
      </div>
    </div>

    <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded">
      <div class="text-xs text-slate-400 font-medium">Degraded / Warning</div>
      <div class="text-2xl font-mono font-semibold text-amber-400 mt-1">
        {monitorStore.fleetSummary.warningCount}
      </div>
    </div>

    <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded">
      <div class="text-xs text-slate-400 font-medium">Critical Breaches</div>
      <div class="text-2xl font-mono font-semibold text-rose-400 mt-1">
        {monitorStore.fleetSummary.criticalCount}
      </div>
    </div>

    <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded">
      <div class="text-xs text-slate-400 font-medium">Avg Fleet CPU</div>
      <div class="text-2xl font-mono font-semibold text-sky-400 mt-1">
        {monitorStore.fleetSummary.averageCpuUsage}%
      </div>
    </div>
  </div>

  <div class="bg-slate-900 border border-slate-800 rounded overflow-hidden">
    <div class="px-4 py-3 border-b border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
      <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Monitored Instances ({filteredServers.length})</span>
      <input
        type="text"
        placeholder="Filter instances by name or IP..."
        bind:value={filterStore.searchQuery}
        class="w-full sm:w-64 bg-slate-950 border border-slate-700 px-2.5 py-1 text-xs rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
      />
    </div>

    {#if monitorStore.isLoading}
      <div class="p-8 text-center text-xs text-slate-500 font-mono">
        Loading fleet database records...
      </div>
    {:else if filteredServers.length === 0}
      <div class="p-8 text-center text-xs text-slate-500 font-mono">
        No server instances found matching criteria.
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs font-mono">
          <thead class="bg-slate-950/60 text-slate-400 border-b border-slate-800">
            <tr>
              <th class="px-4 py-2.5">Name</th>
              <th class="px-4 py-2.5">Region</th>
              <th class="px-4 py-2.5">Status</th>
              <th class="px-4 py-2.5">CPU</th>
              <th class="px-4 py-2.5">Memory</th>
              <th class="px-4 py-2.5">Latency</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            {#each filteredServers as server (server.id)}
              {@const telemetry = monitorStore.activeTelemetry[server.id]}
              <tr class="hover:bg-slate-800/40 transition-colors">
                <td class="px-4 py-3">
                  <div class="font-medium text-slate-200">{server.name}</div>
                  <div class="text-[11px] text-slate-500">{server.ipAddress}</div>
                </td>
                <td class="px-4 py-3 text-slate-400">{server.region}</td>
                <td class="px-4 py-3">
                  <span class="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase border
                    {server.status === 'healthy' ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' :
                     server.status === 'warning' ? 'bg-amber-950/40 border-amber-800/60 text-amber-400' :
                     server.status === 'critical' ? 'bg-rose-950/40 border-rose-800/60 text-rose-400' :
                     'bg-slate-800/60 border-slate-700 text-slate-400'}">
                    {server.status}
                  </span>
                </td>
                <td class="px-4 py-3 text-slate-300">
                  {telemetry ? `${telemetry.cpuUsage}%` : '--'}
                </td>
                <td class="px-4 py-3 text-slate-300">
                  {telemetry ? `${telemetry.memoryUsage}%` : '--'}
                </td>
                <td class="px-4 py-3 text-slate-300">
                  {telemetry ? `${telemetry.latencyMs} ms` : '--'}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
