<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { monitorStore } from '$lib/stores/monitorStore.svelte';

  let { children } = $props();

  onMount(() => {
    monitorStore.initialize();
  });
</script>

<div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
  <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-4 py-2.5">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex items-center space-x-6">
        <a href="/" class="flex items-center space-x-2.5 group">
          <div class="w-6 h-6 rounded bg-amber-500/10 border border-amber-500/40 flex items-center justify-center text-amber-500 font-mono font-bold text-xs">
            CW
          </div>
          <span class="font-semibold text-sm tracking-tight text-slate-100 group-hover:text-amber-400 transition-colors">
            CloudWatch Status Monitor
          </span>
        </a>

        <nav class="hidden md:flex items-center space-x-1 text-xs font-medium text-slate-400">
          <a href="/" class="px-3 py-1.5 rounded hover:bg-slate-800 hover:text-slate-200 transition-colors">Fleet Dashboard</a>
          <a href="/alarms" class="px-3 py-1.5 rounded hover:bg-slate-800 hover:text-slate-200 transition-colors">Alarms</a>
          <a href="/incidents" class="px-3 py-1.5 rounded hover:bg-slate-800 hover:text-slate-200 transition-colors">Incidents</a>
        </nav>
      </div>

      <div class="flex items-center space-x-3 text-xs">
        <div class="flex items-center space-x-1.5 bg-slate-950/60 border border-slate-800 px-2.5 py-1 rounded">
          <span class="w-2 h-2 rounded-full {monitorStore.fleetSummary.criticalCount > 0 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}"></span>
          <span class="font-mono text-slate-300">
            {monitorStore.fleetSummary.healthyCount}/{monitorStore.fleetSummary.totalCount} Healthy
          </span>
        </div>

        {#if monitorStore.fleetSummary.activeAlarmsCount > 0}
          <div class="bg-rose-950/40 border border-rose-800/60 text-rose-300 font-mono px-2 py-0.5 rounded flex items-center space-x-1">
            <span>[ALARM]</span>
            <span>{monitorStore.fleetSummary.activeAlarmsCount}</span>
          </div>
        {/if}
      </div>
    </div>
  </header>

  <main class="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
    {@render children()}
  </main>

  <footer class="border-t border-slate-900 bg-slate-950/80 px-4 py-3 text-xs text-slate-500 font-mono">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
      <div>AWS CloudWatch Infrastructure Telemetry Simulator</div>
      <div>IndexedDB Engine: Active</div>
    </div>
  </footer>
</div>
