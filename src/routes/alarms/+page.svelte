<script lang="ts">
  import { monitorStore } from '$lib/stores/monitorStore.svelte';
  import { filterStore } from '$lib/stores/filterStore.svelte';
  import AlarmListManager from '$lib/components/domain/AlarmListManager.svelte';
  import StatusSummaryCard from '$lib/components/compound/StatusSummaryCard.svelte';
  import RefreshRateDropdown from '$lib/components/compound/RefreshRateDropdown.svelte';
  import { formatRelativeTime } from '$lib/utils/formatting';
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-lg font-semibold tracking-tight text-cw-text md:text-xl">Fleet alarms</h1>
      <p class="mt-0.5 text-[12px] text-cw-muted">
        Threshold rules, breach streaks and manual state overrides for every monitored host.
      </p>
    </div>
    <RefreshRateDropdown
      value={monitorStore.autoRefreshInterval as 0 | 5000 | 15000 | 30000 | 60000}
      onchange={(next) => monitorStore.setRefreshInterval(next)}
    />
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
      label="Breaching now"
      value={String(monitorStore.alarms.filter((a) => a.enabled && a.state === 'ALARM').length)}
      tone="rose"
      testId="alarm-summary-breaching"
    />
    <StatusSummaryCard
      label="Rules evaluating"
      value={String(monitorStore.alarms.filter((a) => a.enabled && a.state === 'OK').length)}
      tone="emerald"
      testId="alarm-summary-ok"
    />
    <StatusSummaryCard
      label="Awaiting data"
      value={String(monitorStore.alarms.filter((a) => a.state === 'INSUFFICIENT_DATA').length)}
      tone="violet"
      detail="No evaluation recorded yet"
      testId="alarm-summary-pending"
    />
    <StatusSummaryCard
      label="Last evaluation"
      value={monitorStore.lastPollAt ? formatRelativeTime(monitorStore.lastPollAt) : 'never'}
      testId="alarm-summary-last-eval"
    />
  </div>

  <AlarmListManager
    alarms={monitorStore.alarms}
    servers={monitorStore.servers}
    loading={monitorStore.isLoading}
    oncreate={(draft) => monitorStore.createAlarm(draft)}
    onupdate={(id, patch) => monitorStore.updateAlarm(id, patch)}
    onenable={(id, enabled) => monitorStore.setAlarmEnabled(id, enabled)}
    onstate={(id, state) => monitorStore.setAlarmState(id, state)}
    ondelete={(id) => monitorStore.deleteAlarm(id)}
  />
</div>
