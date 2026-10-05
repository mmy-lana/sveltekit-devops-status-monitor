<script lang="ts" module>
  import type { FleetSummary } from '#lib/types/monitor';

  export interface FleetOverviewGridProps {
    summary: FleetSummary;
  }
</script>

<script lang="ts">
  import StatusSummaryCard from '#lib/components/compound/StatusSummaryCard.svelte';

  let { summary }: FleetOverviewGridProps = $props();

  const healthyShare = $derived(
    summary.totalCount > 0 ? (summary.healthyCount / summary.totalCount) * 100 : 0
  );
  const openIncidents = $derived(
    summary.openIncidentsCount
  );
</script>

<!--
  Auto-fill grid with a floor of 160px that collapses to 100% on the narrowest
  viewports, so tiles never clip their content at 360px.
-->
<div
  data-testid="fleet-overview-grid"
  class="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-3"
>
  <StatusSummaryCard
    label="Monitored instances"
    value={String(summary.totalCount)}
    detail={`${summary.maintenanceCount} maintenance · ${summary.offlineCount} offline`}
    tooltip="Every asset in the inventory, including instances that are drained or powered down."
    testId="summary-total"
  />
  <StatusSummaryCard
    label="Healthy"
    value={String(summary.healthyCount)}
    tone="emerald"
    progress={healthyShare}
    progressLabel="Share of the fleet reporting healthy"
    detail={`${Math.round(healthyShare)}% of fleet`}
    testId="summary-healthy"
  />
  <StatusSummaryCard
    label="Warning / Critical"
    value={String(summary.warningCount)}
    tone={summary.warningCount > 0 ? 'amber' : 'neutral'}
    trailing={`${summary.criticalCount} crit`}
    detail="Hosts above the warning threshold"
    testId="summary-degraded"
  />
  <StatusSummaryCard
    label="Fleet CPU"
    value={`${summary.averageCpuUsage.toFixed(1)}%`}
    tone="blue"
    progress={summary.averageCpuUsage}
    progressLabel="Fleet average CPU"
    detail="Across reporting hosts"
    testId="summary-cpu"
  />
  <StatusSummaryCard
    label="Fleet memory"
    value={`${summary.averageMemoryUsage.toFixed(1)}%`}
    tone="violet"
    progress={summary.averageMemoryUsage}
    progressLabel="Fleet average memory"
    warningThreshold={80}
    detail="Across reporting hosts"
    testId="summary-memory"
  />
  <StatusSummaryCard
    label="Alarms / Incidents"
    value={String(summary.activeAlarmsCount)}
    tone={summary.activeAlarmsCount > 0 ? 'rose' : 'neutral'}
    trailing={`${openIncidents} open`}
    detail="Breaching rules and open incidents"
    testId="summary-incidents"
  />
</div>
