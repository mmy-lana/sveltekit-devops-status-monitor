<script lang="ts" module>
  import type { Incident, IncidentSeverity, IncidentStatus } from '$lib/types/monitor';

  export interface IncidentTimelineDrawerProps {
    /** Incident under inspection. The drawer stays mounted but inert when null. */
    incident: Incident | null;
    /** Controls visibility. */
    open: boolean;
    /** Author recorded on timeline notes and transitions. */
    author?: string;
    /** Requests the drawer be dismissed. */
    onclose?: () => void;
    /** Persists a status transition. */
    ontransition?: (status: IncidentStatus) => unknown;
    /** Persists an operator note. */
    onnote?: (message: string) => unknown;
    /** Persists a severity change. */
    onseverity?: (severity: IncidentSeverity) => unknown;
    /** Called while a mutation is in flight so the UI can disable controls. */
    onbusychange?: (busy: boolean) => void;
  }

  export const STATUS_TONE: Record<IncidentStatus, 'rose' | 'amber' | 'blue' | 'emerald'> = {
    open: 'rose',
    investigating: 'amber',
    mitigated: 'blue',
    resolved: 'emerald'
  };

  export const SEVERITIES: readonly IncidentSeverity[] = ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'] as const;
</script>

<script lang="ts">
  import { nextIncidentStatuses, isTerminalStatus } from '$lib/engine/alarmEvaluator';
  import Badge from '$lib/components/primitives/Badge.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import { formatDateTime, formatDuration, formatRelativeTime } from '$lib/utils/formatting';

  let {
    incident,
    open,
    author = 'operator',
    onclose,
    ontransition,
    onnote,
    onseverity,
    onbusychange
  }: IncidentTimelineDrawerProps = $props();

  let note = $state('');
  let noteError = $state<string | null>(null);
  let mutationError = $state<string | null>(null);
  let busy = $state(false);

  const transitions = $derived(incident ? nextIncidentStatuses(incident.status) : []);
  const elapsedMs = $derived(
    incident ? (incident.resolvedAt ?? Date.now()) - incident.startedAt : 0
  );
  const terminal = $derived(incident ? isTerminalStatus(incident.status) : false);

  // Reset transient form state whenever a different incident is opened.
  $effect(() => {
    if (incident?.id) {
      note = '';
      noteError = null;
      mutationError = null;
    }
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) onclose?.();
  }

  async function run(action: () => unknown) {
    busy = true;
    mutationError = null;
    onbusychange?.(true);
    try {
      await Promise.resolve(action());
    } catch (error) {
      mutationError = error instanceof Error ? error.message : 'The update could not be saved';
    } finally {
      busy = false;
      onbusychange?.(false);
    }
  }

  function submitNote() {
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      noteError = 'Write a note before adding it to the timeline';
      return;
    }
    if (trimmed.length > 400) {
      noteError = 'Notes are limited to 400 characters';
      return;
    }
    noteError = null;
    void run(async () => {
      await onnote?.(trimmed);
      note = '';
    });
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#if open && incident}
  <div class="fixed inset-0 z-50" data-testid="incident-drawer">
    <!-- scrim: only on tablet and up, where the drawer is a sidebar -->
    <button
      type="button"
      aria-label="Close incident timeline"
      tabindex={-1}
      class="absolute inset-0 hidden bg-black/55 backdrop-blur-[1px] @min-[40rem]:block"
      onclick={() => onclose?.()}
    ></button>

    <!-- A non-modal complementary panel: it never traps focus, so the dialog
         role is set explicitly and the heuristic suppressed. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="incident-drawer-title"
      class="absolute inset-x-0 bottom-0 flex max-h-[85vh] w-full flex-col rounded-t-xl border-t border-slate-border-strong bg-slate-card shadow-overlay @min-[40rem]:inset-y-0 @min-[40rem]:left-auto @min-[40rem]:right-0 @min-[40rem]:max-h-none @min-[40rem]:w-[480px] @min-[40rem]:rounded-none @min-[40rem]:border-l @min-[40rem]:border-t-0"
      data-testid="incident-drawer-panel"
    >
      <!-- drag pull-bar, mobile only -->
      <div class="flex justify-center pt-2 @min-[40rem]:hidden" aria-hidden="true">
        <span class="h-1 w-10 rounded-full bg-slate-border-strong"></span>
      </div>

      <header class="flex items-start justify-between gap-3 border-b border-slate-border px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="severity" size="sm" value={incident.severity} />
            <Badge variant="alarm" size="sm" value={incident.status} />
          </div>
          <h2
            id="incident-drawer-title"
            class="mt-1.5 text-[13px] font-semibold leading-snug text-cw-text"
          >
            {incident.title}
          </h2>
          <p class="mt-0.5 font-mono text-[10px] text-cw-faint">
            {incident.serverName} · started {formatRelativeTime(incident.startedAt)} ·{' '}
            {formatDuration(elapsedMs)} {incident.resolvedAt ? 'elapsed' : 'open'}
          </p>
        </div>

        <Button
          variant="icon"
          size="sm"
          testId="incident-close"
          ariaLabel="Close incident timeline"
          onclick={() => onclose?.()}
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

      <!-- lifecycle controls -->
      <div class="border-b border-slate-border px-4 py-3">
        {#if mutationError}
          <p
            class="mb-2 rounded border border-cw-rose/40 bg-cw-rose/10 px-3 py-2 text-[11px] text-cw-rose"
            role="alert"
            data-testid="incident-mutation-error"
          >
            {mutationError}
          </p>
        {/if}

        <p class="text-[10px] uppercase tracking-wider text-cw-faint">Advance incident</p>
        <div class="mt-1.5 flex flex-wrap gap-2">
          {#each transitions as status (status)}
            <Button
              variant={status === 'resolved' ? 'primary' : 'secondary'}
              size="sm"
              testId={`incident-transition-${status}`}
              disabled={busy}
              onclick={() => void run(() => ontransition?.(status))}
            >
              Mark {status}
            </Button>
          {/each}
          {#if terminal}
            <p class="flex items-center text-[11px] text-cw-emerald" data-testid="incident-terminal">
              Resolved — the timeline is now read-only for status changes.
            </p>
          {/if}
        </div>

        <p class="mt-3 text-[10px] uppercase tracking-wider text-cw-faint">Severity</p>
        <div class="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Incident severity">
          {#each SEVERITIES as severity (severity)}
            <button
              type="button"
              data-testid={`incident-severity-${severity}`}
              aria-pressed={incident.severity === severity}
              disabled={busy}
              class="h-9 rounded border px-2.5 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 {incident.severity ===
              severity
                ? 'border-cw-accent/50 bg-cw-accent/14 text-cw-accent'
                : 'border-slate-border-strong text-cw-muted hover:bg-white/5 hover:text-cw-text'}"
              onclick={() => void run(() => onseverity?.(severity))}
            >
              {severity}
            </button>
          {/each}
        </div>
      </div>

      <!-- timeline -->
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ol class="flex flex-col gap-3" data-testid="incident-timeline">
          {#each incident.timeline as event (event.id)}
            <li class="relative pl-5" data-testid="timeline-event">
              <span
                class="absolute left-0 top-1.5 h-2 w-2 rounded-full ring-4 ring-slate-card {event.statusTransition
                  ? 'bg-cw-accent'
                  : 'bg-slate-border-strong'}"
                aria-hidden="true"
              ></span>
              <p class="text-[11px] leading-relaxed text-cw-text">{event.message}</p>
              <p class="mt-0.5 font-mono text-[10px] text-cw-faint">
                {formatDateTime(event.timestamp)} · {event.author}
                {#if event.statusTransition}
                  · <span class="text-cw-accent">{event.statusTransition}</span>
                {/if}
              </p>
            </li>
          {/each}
        </ol>
      </div>

      <!-- note composer -->
      <div class="border-t border-slate-border px-4 py-3">
        <label for="incident-note" class="text-[10px] uppercase tracking-wider text-cw-faint">
          Add timeline note
        </label>
        <textarea
          id="incident-note"
          data-testid="incident-note"
          bind:value={note}
          rows="2"
          maxlength="400"
          disabled={busy}
          aria-invalid={noteError ? 'true' : undefined}
          aria-describedby={noteError ? 'incident-note-error' : undefined}
          placeholder={`Recorded as ${author}`}
          class="mt-1.5 w-full resize-y rounded border bg-slate-base px-3 py-2 text-[12px] text-cw-text placeholder:text-cw-faint focus:outline-none disabled:opacity-60 {noteError
            ? 'border-cw-rose/60'
            : 'border-slate-border-strong focus:border-cw-accent'}"
        ></textarea>
        {#if noteError}
          <p id="incident-note-error" class="mt-1 text-[11px] text-cw-rose" role="alert">
            {noteError}
          </p>
        {/if}
        <div class="mt-2 flex items-center justify-between gap-2">
          <span class="tnum font-mono text-[10px] text-cw-faint">{note.trim().length} / 400</span>
          <Button
            variant="primary"
            size="sm"
            testId="incident-note-submit"
            loading={busy}
            onclick={submitNote}
          >
            Append note
          </Button>
        </div>
      </div>
    </aside>
  </div>
{/if}
