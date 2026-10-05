<script lang="ts" module>
  import type {
    AlarmRule,
    AlarmRuleDraft,
    AlarmState,
    ServerAsset,
    ValidationErrors
  } from '#lib/types/monitor';

  export interface AlarmListManagerProps {
    /** Alarm rules across the fleet. */
    alarms: AlarmRule[];
    /** Server inventory, used to resolve rule scope names. */
    servers: ServerAsset[];
    loading?: boolean;
    oncreate?: (draft: AlarmRuleDraft) => unknown;
    onupdate?: (id: string, patch: Partial<AlarmRuleDraft>) => unknown;
    onenable?: (id: string, enabled: boolean) => unknown;
    onstate?: (id: string, state: AlarmRule['state']) => unknown;
    ondelete?: (id: string) => unknown;
  }

  export type AlarmField =
    | 'name'
    | 'serverId'
    | 'metric'
    | 'operator'
    | 'threshold'
    | 'evaluationPeriods'
    | 'periodSeconds';

  /** Validate an alarm rule draft. */
  export function validateAlarmDraft(
    draft: AlarmRuleDraft,
    scopeIds: readonly string[]
  ): ValidationErrors<AlarmField> {
    const errors: ValidationErrors<AlarmField> = {};

    const name = draft.name.trim();
    if (name.length < 3 || name.length > 64) {
      errors.name = 'Rule name must be 3-64 characters';
    }
    if (!scopeIds.includes(draft.serverId)) {
      errors.serverId = 'Choose an instance or the whole fleet';
    }
    if (!Number.isFinite(draft.threshold) || draft.threshold <= 0) {
      errors.threshold = 'Threshold must be a positive number';
    } else if (draft.metric !== 'latency' && draft.metric !== 'networkIn' && draft.metric !== 'networkOut' && draft.threshold > 100) {
      errors.threshold = 'Percentage metrics cannot exceed 100';
    }
    if (!Number.isInteger(draft.evaluationPeriods) || draft.evaluationPeriods < 1 || draft.evaluationPeriods > 20) {
      errors.evaluationPeriods = 'Use between 1 and 20 evaluation periods';
    }
    if (!Number.isInteger(draft.periodSeconds) || draft.periodSeconds < 5 || draft.periodSeconds > 3600) {
      errors.periodSeconds = 'Period must be between 5 and 3600 seconds';
    }

    return errors;
  }

  /** Blank draft for the rule editor. */
  export function emptyAlarmDraft(): AlarmRuleDraft {
    return {
      name: '',
      serverId: 'all',
      metric: 'cpu',
      operator: 'GT',
      threshold: 85,
      evaluationPeriods: 2,
      periodSeconds: 10,
      enabled: true
    };
  }

  /** Draft seeded from an existing rule so the editor opens populated. */
  export function alarmDraftFromRule(rule: AlarmRule): AlarmRuleDraft {
    return {
      name: rule.name,
      serverId: rule.serverId,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      evaluationPeriods: rule.evaluationPeriods,
      periodSeconds: rule.periodSeconds,
      enabled: rule.enabled
    };
  }
</script>

<script lang="ts">
  import { FLEET_SCOPE, describeRule, thresholdSummary, validateThreshold } from '#lib/engine/alarmEvaluator';
  import Badge from '#lib/components/primitives/Badge.svelte';
  import Button from '#lib/components/primitives/Button.svelte';
  import Card from '#lib/components/primitives/Card.svelte';
  import Input from '#lib/components/primitives/Input.svelte';
  import Select from '#lib/components/primitives/Select.svelte';
  import Table, { type TableColumn } from '#lib/components/primitives/Table.svelte';
  import { METRIC_LABELS, METRIC_ORDER, METRIC_UNITS, OPERATOR_ORDER, OPERATOR_SYMBOLS } from '#lib/utils/alarmUtils';
  import { formatRelativeTime } from '#lib/utils/formatting';

  let {
    alarms,
    servers,
    loading = false,
    oncreate,
    onupdate,
    onenable,
    onstate,
    ondelete
  }: AlarmListManagerProps = $props();

  let editorOpen = $state(false);
  let editingId = $state<string | null>(null);
  let draft = $state<AlarmRuleDraft>(emptyAlarmDraft());
  let errors = $state<ValidationErrors<AlarmField>>({});
  let formError = $state<string | null>(null);
  let busy = $state(false);

  const scopeIds = $derived([FLEET_SCOPE, ...servers.map((server) => server.id)]);
  const scopeLabel = $derived.by(() => {
    const labels = new Map<string, string>([[FLEET_SCOPE, 'Entire fleet']]);
    for (const server of servers) labels.set(server.id, server.name);
    return labels;
  });

  const counts = $derived({
    total: alarms.length,
    // Disabled rules are not being evaluated, so they must not be reported as
    // healthy; otherwise this toolbar disagrees with the summary card above it.
    ok: alarms.filter((a) => a.enabled && a.state === 'OK').length,
    alarm: alarms.filter((a) => a.state === 'ALARM' && a.enabled).length,
    pending: alarms.filter((a) => a.state === 'INSUFFICIENT_DATA').length,
    disabled: alarms.filter((a) => !a.enabled).length
  });

  const columns: TableColumn[] = [
    { key: 'name', label: 'Alarm rule', primary: true },
    { key: 'scope', label: 'Scope' },
    { key: 'condition', label: 'Condition' },
    { key: 'state', label: 'State' },
    { key: 'streak', label: 'Streak', align: 'right' },
    { key: 'changed', label: 'Last change', align: 'right' },
    { key: 'actions', label: 'Manage', align: 'right' }
  ];

  function openCreate() {
    editingId = null;
    draft = emptyAlarmDraft();
    errors = {};
    formError = null;
    editorOpen = true;
  }

  function openEdit(alarm: AlarmRule) {
    editingId = alarm.id;
    draft = alarmDraftFromRule(alarm);
    errors = {};
    formError = null;
    editorOpen = true;
  }

  function field<K extends keyof AlarmRuleDraft>(key: K, value: AlarmRuleDraft[K]) {
    draft = { ...draft, [key]: value };
    if (errors[key as AlarmField]) {
      const next = { ...errors };
      delete next[key as AlarmField];
      errors = next;
    }
  }

  async function submit() {
    const found = validateAlarmDraft(draft, scopeIds);
    const thresholdError = validateThreshold(draft.metric, draft.threshold);
    if (thresholdError) found.threshold = thresholdError;
    errors = found;
    if (Object.keys(found).length > 0) return;

    busy = true;
    formError = null;
    try {
      if (editingId) await onupdate?.(editingId, draft);
      else await oncreate?.(draft);
      editorOpen = false;
    } catch (error) {
      formError = error instanceof Error ? error.message : 'The alarm rule could not be saved';
    } finally {
      busy = false;
    }
  }

  const scopeOptions = $derived([
    { value: FLEET_SCOPE, label: 'Entire fleet' },
    ...servers.map((server) => ({ value: server.id, label: server.name, group: server.region }))
  ]);

  const metricOptions = $derived(
    METRIC_ORDER.map((metric) => ({ value: metric, label: `${METRIC_LABELS[metric]} (${METRIC_UNITS[metric]})` }))
  );

  const operatorOptions = $derived(
    OPERATOR_ORDER.map((operator) => ({ value: operator, label: `${operator} (${OPERATOR_SYMBOLS[operator]})` }))
  );
</script>

<Card
  title="Alarm rules"
  subtitle="Thresholds, breach streaks and operator overrides across the fleet"
  meta={`${counts.total} rules`}
  padding="none"
  testId="alarm-manager"
>
  {#snippet actions()}
    <Button variant="primary" size="sm" testId="alarm-create" onclick={openCreate}>
      New rule
    </Button>
  {/snippet}

  {#snippet toolbar()}
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {#each [
        { label: 'Breaching', value: counts.alarm, tone: 'text-cw-rose' },
        { label: 'OK', value: counts.ok, tone: 'text-cw-emerald' },
        { label: 'Awaiting data', value: counts.pending, tone: 'text-cw-violet' },
        { label: 'Disabled', value: counts.disabled, tone: 'text-cw-faint' }
      ] as stat (stat.label)}
        <span class="flex items-center gap-1.5">
          <span class="text-[10px] uppercase tracking-wider text-cw-faint">{stat.label}</span>
          <span class="tnum font-mono text-[12px] font-semibold {stat.tone}" data-testid={`alarm-stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
            {stat.value}
          </span>
        </span>
      {/each}
    </div>
  {/snippet}

  <Table
    {columns}
    rows={alarms}
    rowKey={(alarm: AlarmRule) => alarm.id}
    caption="Alarm rules and their live evaluation state"
    {loading}
    emptyTitle="No alarm rules configured"
    emptyDescription="Create a rule to start evaluating a metric against a threshold."
  >
    {#snippet cell(alarm: AlarmRule, column: TableColumn)}
      {#if column.key === 'name'}
        <div class="min-w-0" data-testid="alarm-row">
          <span data-field="name" class="block truncate font-medium text-cw-text">
            {alarm.name}
          </span>
          <span class="block truncate font-mono text-[10px] text-cw-faint">
            {describeRule(alarm)}
          </span>
        </div>
      {:else if column.key === 'scope'}
        <span class="block truncate text-[11px] text-cw-muted">
          {scopeLabel.get(alarm.serverId) ?? alarm.serverId}
        </span>
      {:else if column.key === 'condition'}
        <span class="font-mono text-[11px] text-cw-text">{thresholdSummary(alarm)}</span>
      {:else if column.key === 'state'}
        <span data-field="state">
          <Badge variant="alarm" size="sm" value={alarm.state} dot pulse={alarm.state === 'ALARM'} />
        </span>
      {:else if column.key === 'streak'}
        <span class="tnum font-mono text-[11px] text-cw-muted">
          {alarm.consecutiveBreaches}/{alarm.evaluationPeriods}
        </span>
      {:else if column.key === 'changed'}
        <span class="font-mono text-[11px] text-cw-faint">
          {formatRelativeTime(alarm.lastStateChangeAt)}
        </span>
      {:else if column.key === 'actions'}
        <div class="flex flex-wrap justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            class="h-11 px-3"
            testId={`alarm-toggle-${alarm.id}`}
            onclick={() => void onenable?.(alarm.id, !alarm.enabled)}
          >
            {alarm.enabled ? 'Disable' : 'Enable'}
          </Button>
          {#if alarm.state === 'ALARM'}
            <Button
              variant="secondary"
              size="sm"
              class="h-11 px-3"
              testId={`alarm-ack-${alarm.id}`}
              onclick={() => void onstate?.(alarm.id, 'OK' as AlarmState)}
            >
              Ack
            </Button>
          {/if}
          <Button
            variant="ghost"
            size="sm"
            class="h-11 px-3"
            testId={`alarm-edit-${alarm.id}`}
            onclick={() => openEdit(alarm)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-11 px-3 text-cw-rose"
            testId={`alarm-delete-${alarm.id}`}
            onclick={() => void ondelete?.(alarm.id)}
          >
            Delete
          </Button>
        </div>
      {/if}
    {/snippet}
  </Table>
</Card>

{#if editorOpen}
  <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
    <button
      type="button"
      aria-label="Close the alarm editor"
      tabindex={-1}
      class="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
      onclick={() => {
        if (!busy) editorOpen = false;
      }}
    ></button>

    <form
      data-testid="alarm-form"
      aria-labelledby="alarm-form-title"
      class="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-xl border border-slate-border-strong bg-slate-card shadow-overlay sm:max-w-[560px] sm:rounded-xl"
      novalidate
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <header class="flex items-center justify-between gap-3 border-b border-slate-border px-4 py-3">
        <h2 id="alarm-form-title" class="text-[13px] font-semibold text-cw-text">
          {editingId ? 'Edit alarm rule' : 'New alarm rule'}
        </h2>
        <Button
          variant="icon"
          size="sm"
          testId="alarm-cancel"
          ariaLabel="Close the alarm editor"
          onclick={() => {
            if (!busy) editorOpen = false;
          }}
        >
          <svg
            viewBox="0 0 16 16"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path d="m4 4 8 8M12 4l-8 8" stroke-linecap="round" />
          </svg>
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {#if formError}
          <p
            class="mb-3 rounded border border-cw-rose/40 bg-cw-rose/10 px-3 py-2 text-[11px] text-cw-rose"
            role="alert"
            data-testid="alarm-form-error"
          >
            {formError}
          </p>
        {/if}

        <div class="flex flex-col gap-3">
          <Input
            label="Rule name"
            name="alarm-name"
            testId="alarm-name"
            required
            placeholder="Gateway Egress Spike"
            value={draft.name}
            error={errors.name}
            oninput={(event) => field('name', event.currentTarget.value)}
          />

          <Select
            label="Scope"
            name="alarm-scope"
            testId="alarm-scope"
            options={scopeOptions}
            value={draft.serverId}
            error={errors.serverId}
            onchange={(event) => field('serverId', event.currentTarget.value)}
          />

          <div class="grid gap-3 sm:grid-cols-3">
            <Select
              label="Metric"
              name="alarm-metric"
              testId="alarm-metric"
              options={metricOptions}
              value={draft.metric}
              onchange={(event) => field('metric', event.currentTarget.value as AlarmRuleDraft['metric'])}
            />
            <Select
              label="Operator"
              name="alarm-operator"
              testId="alarm-operator"
              options={operatorOptions}
              value={draft.operator}
              onchange={(event) =>
                field('operator', event.currentTarget.value as AlarmRuleDraft['operator'])}
            />
            <Input
              label={`Threshold (${METRIC_UNITS[draft.metric]})`}
              name="alarm-threshold"
              testId="alarm-threshold"
              type="number"
              inputmode="decimal"
              min={0}
              step="any"
              value={Number.isFinite(draft.threshold) ? String(draft.threshold) : ''}
              error={errors.threshold}
              oninput={(event) => {
                const parsed = Number(event.currentTarget.value);
                field('threshold', Number.isFinite(parsed) ? parsed : Number.NaN);
              }}
            />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <Input
              label="Evaluation periods"
              name="alarm-periods"
              testId="alarm-periods"
              type="number"
              inputmode="numeric"
              min={1}
              max={20}
              step={1}
              value={String(draft.evaluationPeriods)}
              error={errors.evaluationPeriods}
              hint="Breaches needed before the rule latches into ALARM."
              oninput={(event) => {
                const parsed = Number(event.currentTarget.value);
                field('evaluationPeriods', Number.isFinite(parsed) ? parsed : Number.NaN);
              }}
            />
            <Input
              label="Period (seconds)"
              name="alarm-period"
              testId="alarm-period"
              type="number"
              inputmode="numeric"
              min={5}
              max={3600}
              step={1}
              value={String(draft.periodSeconds)}
              error={errors.periodSeconds}
              oninput={(event) => {
                const parsed = Number(event.currentTarget.value);
                field('periodSeconds', Number.isFinite(parsed) ? parsed : Number.NaN);
              }}
            />
          </div>
        </div>
      </div>

      <footer class="flex items-center justify-end gap-2 border-t border-slate-border px-4 py-3">
        <Button variant="ghost" size="md" testId="alarm-cancel-footer" disabled={busy} onclick={() => (editorOpen = false)}>
          Cancel
        </Button>
        <Button variant="primary" size="md" testId="alarm-submit" loading={busy} onclick={submit}>
          {editingId ? 'Save rule' : 'Create rule'}
        </Button>
      </footer>
    </form>
  </div>
{/if}
