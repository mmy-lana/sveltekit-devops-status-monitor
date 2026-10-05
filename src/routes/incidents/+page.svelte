<script lang="ts">
  import { monitorStore } from '#lib/stores/monitorStore.svelte';
  import { meanTimeToResolve, isTerminalStatus } from '#lib/engine/alarmEvaluator';
  import Badge from '#lib/components/primitives/Badge.svelte';
  import Card from '#lib/components/primitives/Card.svelte';
  import Table, { type TableColumn } from '#lib/components/primitives/Table.svelte';
  import IncidentTimelineDrawer from '#lib/components/domain/IncidentTimelineDrawer.svelte';
  import StatusSummaryCard from '#lib/components/compound/StatusSummaryCard.svelte';
  import Input from '#lib/components/primitives/Input.svelte';
  import { formatDateTime, formatDuration, formatRelativeTime } from '#lib/utils/formatting';
  import type { Incident, IncidentStatus } from '#lib/types/monitor';

  type IncidentFilter = IncidentStatus | 'all';

  let statusFilter = $state<IncidentFilter>('all');
  let searchQuery = $state('');
  let selectedId = $state<string | null>(null);
  let drawerOpen = $state(false);

  const incidents = $derived(monitorStore.incidents);
  const selected = $derived(
    selectedId ? (incidents.find((incident) => incident.id === selectedId) ?? null) : null
  );

  const mttr = $derived(meanTimeToResolve(incidents));

  const counts = $derived({
    open: incidents.filter((i) => i.status === 'open').length,
    investigating: incidents.filter((i) => i.status === 'investigating').length,
    mitigated: incidents.filter((i) => i.status === 'mitigated').length,
    resolved: incidents.filter((i) => isTerminalStatus(i.status)).length,
    sev1: incidents.filter((i) => i.severity === 'SEV-1').length
  });

  const visible = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    return incidents.filter((incident) => {
      if (statusFilter !== 'all' && incident.status !== statusFilter) return false;
      if (query.length === 0) return true;
      return (
        incident.title.toLowerCase().includes(query) ||
        incident.serverName.toLowerCase().includes(query)
      );
    });
  });

  const columns: TableColumn[] = [
    { key: 'title', label: 'Incident', primary: true },
    { key: 'severity', label: 'Severity' },
    { key: 'status', label: 'Status' },
    { key: 'server', label: 'Instance' },
    { key: 'started', label: 'Started', align: 'right' },
    { key: 'elapsed', label: 'Elapsed', align: 'right' },
    { key: 'events', label: 'Events', align: 'right' }
  ];

  const statusFilters: ReadonlyArray<{ value: IncidentFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'investigating', label: 'Investigating' },
    { value: 'mitigated', label: 'Mitigated' },
    { value: 'resolved', label: 'Resolved' }
  ];

  function openDrawer(incident: Incident) {
    selectedId = incident.id;
    drawerOpen = true;
  }

  /**
   * Per-status counts for the filter pills.
   *
   * `statusFilters` itself carries the 'all' sentinel, so zero-filling from that
   * list would immediately overwrite the register total. The sentinel is
   * therefore assigned once every per-status counter has been tallied.
   */
  const statusCounts = $derived.by(() => {
    const map = new Map<IncidentFilter, number>();
    for (const filter of statusFilters) map.set(filter.value, 0);
    for (const incident of incidents) map.set(incident.status, (map.get(incident.status) ?? 0) + 1);
    map.set('all', incidents.length);
    return map;
  });
</script>

<div class="flex flex-col gap-4">
  <div>
    <h1 class="text-lg font-semibold tracking-tight text-cw-text md:text-xl">Incident command</h1>
    <p class="mt-0.5 text-[12px] text-cw-muted">
      Lifecycle tracking, append-only timelines and mean time to resolve across the fleet.
    </p>
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
      label="Open incidents"
      value={String(counts.open + counts.investigating + counts.mitigated)}
      tone={counts.open > 0 ? 'rose' : 'neutral'}
      detail={`${counts.open} awaiting triage`}
      testId="incident-summary-open"
    />
    <StatusSummaryCard
      label="SEV-1 active"
      value={String(incidents.filter((i) => i.severity === 'SEV-1' && !isTerminalStatus(i.status)).length)}
      tone="rose"
      testId="incident-summary-sev1"
    />
    <StatusSummaryCard
      label="Mean time to resolve"
      value={mttr === null ? 'n/a' : formatDuration(mttr)}
      tone={mttr === null ? 'neutral' : mttr > 3_600_000 ? 'amber' : 'emerald'}
      detail={mttr === null ? 'No incidents resolved yet' : 'Across resolved incidents'}
      testId="incident-summary-mttr"
    />
    <StatusSummaryCard
      label="Resolved"
      value={String(counts.resolved)}
      tone="emerald"
      testId="incident-summary-resolved"
    />
  </div>

  <Card
    title="Incident register"
    subtitle="Select a row to open the lifecycle timeline"
    meta={`${visible.length} / ${incidents.length}`}
    padding="none"
    testId="incident-register"
  >
    {#snippet toolbar()}
      <div class="flex flex-col gap-2.5">
        <div class="min-w-0 flex-1">
          <Input
            label="Search incidents"
            name="incident-search"
            testId="incident-search"
            type="search"
            placeholder="Filter by title or instance name"
            bind:value={searchQuery}
          />
        </div>
        <div class="scroll-strip" role="group" aria-label="Filter by incident status">
          {#each statusFilters as filter (filter.value)}
            <button
              type="button"
              data-testid={`incident-filter-${filter.value}`}
              aria-pressed={statusFilter === filter.value}
              class="flex h-11 shrink-0 items-center gap-1.5 rounded border px-3 text-[12px] font-medium transition-colors {statusFilter ===
              filter.value
                ? 'border-cw-accent/45 bg-cw-accent/14 text-cw-accent'
                : 'border-slate-border-strong text-cw-muted hover:bg-white/5 hover:text-cw-text'}"
              onclick={() => (statusFilter = filter.value)}
            >
              {filter.label}
              <span class="tnum font-mono text-[10px] text-cw-faint">
                {statusCounts.get(filter.value) ?? 0}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/snippet}

    <Table
      {columns}
      rows={visible}
      rowKey={(incident: Incident) => incident.id}
      caption="Incidents raised across the fleet"
      loading={monitorStore.isLoading}
      emptyTitle="No incidents in this view"
      emptyDescription="Change the status filter or clear the search to see the full register."
      onrowactivate={openDrawer}
    >
      {#snippet cell(incident: Incident, column: TableColumn)}
        {#if column.key === 'title'}
          <div class="min-w-0">
            <button
              type="button"
              data-testid="incident-open"
              class="flex min-h-11 w-full items-center text-left"
              onclick={(event: MouseEvent) => {
                event.stopPropagation();
                openDrawer(incident);
              }}
            >
              <span class="line-clamp-2 text-[12px] font-medium text-cw-text">{incident.title}</span>
            </button>
            <span class="block truncate font-mono text-[10px] text-cw-faint">
              {incident.id} · {formatDateTime(incident.startedAt)}
            </span>
          </div>
        {:else if column.key === 'severity'}
          <Badge variant="severity" size="sm" value={incident.severity} />
        {:else if column.key === 'status'}
          <Badge variant="alarm" size="sm" value={incident.status} dot pulse={incident.status === 'open'} />
        {:else if column.key === 'server'}
          <span class="block truncate text-[11px] text-cw-muted">{incident.serverName}</span>
        {:else if column.key === 'started'}
          <span class="font-mono text-[11px] text-cw-muted">{formatRelativeTime(incident.startedAt)}</span>
        {:else if column.key === 'elapsed'}
          <span class="tnum font-mono text-[11px] text-cw-text">
            {formatDuration((incident.resolvedAt ?? Date.now()) - incident.startedAt)}
          </span>
        {:else if column.key === 'events'}
          <span class="tnum font-mono text-[11px] text-cw-muted">{incident.timeline.length}</span>
        {/if}
      {/snippet}
    </Table>
  </Card>
</div>

<IncidentTimelineDrawer
  incident={selected}
  open={drawerOpen}
  onclose={() => (drawerOpen = false)}
  ontransition={(status) =>
    selected ? monitorStore.transitionIncident(selected.id, status, 'operator') : Promise.resolve()}
  onnote={(message) =>
    selected ? monitorStore.appendIncidentNote(selected.id, message, 'operator') : Promise.resolve()}
  onseverity={(severity) =>
    selected ? monitorStore.setIncidentSeverity(selected.id, severity, 'operator') : Promise.resolve()}
/>
