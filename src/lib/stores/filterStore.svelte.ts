import type { Environment, ServerAsset, ServerStatus, MetricDataPoint } from '$lib/types/monitor';
import { monitorStore } from '$lib/stores/monitorStore.svelte';

class FilterState {
  searchQuery = $state<string>('');
  selectedEnvironment = $state<Environment | 'all'>('all');
  selectedStatus = $state<ServerStatus | 'all'>('all');
  selectedRegion = $state<string>('all');
  sortBy = $state<'name' | 'cpu' | 'memory' | 'latency' | 'status'>('name');
  sortDirection = $state<'asc' | 'desc'>('asc');

  availableRegions: string[] = $derived.by(() => {
    return Array.from(new Set(monitorStore.servers.map(s => s.region))).sort();
  });

  applyFilters(
    servers: ServerAsset[],
    telemetry: Record<string, MetricDataPoint | null>
  ): ServerAsset[] {
    return servers
      .filter(server => {
        if (this.selectedEnvironment !== 'all' && server.environment !== this.selectedEnvironment) {
          return false;
        }
        if (this.selectedStatus !== 'all' && server.status !== this.selectedStatus) {
          return false;
        }
        if (this.selectedRegion !== 'all' && server.region !== this.selectedRegion) {
          return false;
        }
        if (this.searchQuery.trim().length > 0) {
          const query = this.searchQuery.toLowerCase();
          const matchName = server.name.toLowerCase().includes(query);
          const matchHost = server.hostname.toLowerCase().includes(query);
          const matchIp = server.ipAddress.toLowerCase().includes(query);
          if (!matchName && !matchHost && !matchIp) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let valA: string | number = 0;
        let valB: string | number = 0;

        switch (this.sortBy) {
          case 'name':
            valA = a.name.toLowerCase();
            valB = b.name.toLowerCase();
            break;
          case 'status':
            valA = a.status;
            valB = b.status;
            break;
          case 'cpu':
            valA = telemetry[a.id]?.cpuUsage ?? 0;
            valB = telemetry[b.id]?.cpuUsage ?? 0;
            break;
          case 'memory':
            valA = telemetry[a.id]?.memoryUsage ?? 0;
            valB = telemetry[b.id]?.memoryUsage ?? 0;
            break;
          case 'latency':
            valA = telemetry[a.id]?.latencyMs ?? 0;
            valB = telemetry[b.id]?.latencyMs ?? 0;
            break;
        }

        if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
  }

  reset() {
    this.searchQuery = '';
    this.selectedEnvironment = 'all';
    this.selectedStatus = 'all';
    this.selectedRegion = 'all';
    this.sortBy = 'name';
    this.sortDirection = 'asc';
  }
}

export const filterStore = new FilterState();
