import type {
  Environment,
  MetricDataPoint,
  ServerAsset,
  ServerStatus,
  SortDirection,
  SortKey
} from '$lib/types/monitor';
import { monitorStore } from '$lib/stores/monitorStore.svelte';

/**
 * Query state for the fleet table.
 *
 * Kept separate from the monitor store so filtering and sorting never mutate
 * the domain state, and so the toolbar can bind straight to these runes.
 */
class FilterState {
  searchQuery = $state<string>('');
  selectedEnvironment = $state<Environment | 'all'>('all');
  selectedStatus = $state<ServerStatus | 'all'>('all');
  selectedRegion = $state<string>('all');
  sortBy = $state<SortKey>('name');
  sortDirection = $state<SortDirection>('asc');

  /** Regions present in the inventory, recomputed as the fleet changes. */
  availableRegions: string[] = $derived.by(() =>
    Array.from(new Set(monitorStore.servers.map((server) => server.region))).sort()
  );

  /** Environments present in the inventory, in console order. */
  availableEnvironments: Environment[] = $derived.by(() => {
    const order: Environment[] = ['production', 'staging', 'development', 'testing'];
    const present = new Set(monitorStore.servers.map((server) => server.environment));
    return order.filter((environment) => present.has(environment));
  });

  /** Number of filters narrowing the result set. */
  activeFilterCount: number = $derived(
    (this.selectedStatus === 'all' ? 0 : 1) +
      (this.selectedRegion === 'all' ? 0 : 1) +
      (this.selectedEnvironment === 'all' ? 0 : 1) +
      (this.searchQuery.trim().length > 0 ? 1 : 0)
  );

  /**
   * Apply the active query to a server list.
   *
   * `sort` operates on a copy so the caller's array order is never disturbed.
   */
  applyFilters(
    servers: ServerAsset[],
    telemetry: Record<string, MetricDataPoint | null>
  ): ServerAsset[] {
    const query = this.searchQuery.trim().toLowerCase();

    const matched = servers.filter((server) => {
      if (this.selectedEnvironment !== 'all' && server.environment !== this.selectedEnvironment) {
        return false;
      }
      if (this.selectedStatus !== 'all' && server.status !== this.selectedStatus) return false;
      if (this.selectedRegion !== 'all' && server.region !== this.selectedRegion) return false;

      if (query.length > 0) {
        const matchesName = server.name.toLowerCase().includes(query);
        const matchesHost = server.hostname.toLowerCase().includes(query);
        const matchesIp = server.ipAddress.toLowerCase().includes(query);
        const matchesOwner = (server.owner ?? '').toLowerCase().includes(query);
        if (!matchesName && !matchesHost && !matchesIp && !matchesOwner) return false;
      }
      return true;
    });

    const direction = this.sortDirection === 'asc' ? 1 : -1;

    return matched.sort((a, b) => {
      let comparison: number;
      switch (this.sortBy) {
        case 'name':
          comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
          break;
        case 'cpu':
          comparison =
            (telemetry[a.id]?.cpuUsage ?? 0) - (telemetry[b.id]?.cpuUsage ?? 0) ||
            a.name.localeCompare(b.name);
          break;
        case 'memory':
          comparison =
            (telemetry[a.id]?.memoryUsage ?? 0) - (telemetry[b.id]?.memoryUsage ?? 0) ||
            a.name.localeCompare(b.name);
          break;
        case 'latency':
          comparison =
            (telemetry[a.id]?.latencyMs ?? 0) - (telemetry[b.id]?.latencyMs ?? 0) ||
            a.name.localeCompare(b.name);
          break;
      }
      return comparison * direction;
    });
  }

  /** Flip the sort direction when the active column is re-selected. */
  toggleSort(key: SortKey): void {
    if (this.sortBy === key) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = key;
      this.sortDirection = key === 'name' ? 'asc' : 'desc';
    }
  }

  /** Return every filter to its default. */
  reset(): void {
    this.searchQuery = '';
    this.selectedEnvironment = 'all';
    this.selectedStatus = 'all';
    this.selectedRegion = 'all';
    this.sortBy = 'name';
    this.sortDirection = 'asc';
  }
}

export const filterStore = new FilterState();
