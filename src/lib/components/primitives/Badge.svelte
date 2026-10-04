<script lang="ts" module>
  import type { AlarmState, IncidentSeverity, ServerStatus } from '$lib/types/monitor';

  /** Supported badge vocabularies. */
  export type BadgeVariant = 'status' | 'severity' | 'alarm' | 'log' | 'environment' | 'neutral';

  /** Density of the pill. */
  export type BadgeSize = 'sm' | 'md';

  export interface BadgeProps {
    /**
     * Which vocabulary the `value` belongs to. Controls the colour mapping and
     * the accessible prefix announced to screen readers.
     */
    variant?: BadgeVariant;
    /** Semantic value; one of the union members the variant accepts. */
    value: string;
    /** Overrides the rendered text (defaults to a prettified `value`). */
    label?: string;
    size?: BadgeSize;
    /** Renders a leading state dot; useful for live status indicators. */
    dot?: boolean;
    /** Pulse the dot to signal a live, actively changing state. */
    pulse?: boolean;
    /** Fully qualified accessible name for the pill. */
    ariaLabel?: string;
  }

  type Tone = 'emerald' | 'amber' | 'rose' | 'blue' | 'violet' | 'slate';

  const TONE_CLASS: Record<Tone, string> = {
    emerald: 'bg-cw-emerald/12 text-cw-emerald border-cw-emerald/35',
    amber: 'bg-cw-amber/12 text-cw-amber border-cw-amber/35',
    rose: 'bg-cw-rose/12 text-cw-rose border-cw-rose/35',
    blue: 'bg-cw-blue/12 text-cw-blue border-cw-blue/35',
    violet: 'bg-cw-violet/12 text-cw-violet border-cw-violet/35',
    slate: 'bg-white/5 text-cw-muted border-slate-border-strong'
  };

  const DOT_CLASS: Record<Tone, string> = {
    emerald: 'bg-cw-emerald',
    amber: 'bg-cw-amber',
    rose: 'bg-cw-rose',
    blue: 'bg-cw-blue',
    violet: 'bg-cw-violet',
    slate: 'bg-slate-500'
  };

  const STATUS_TONE: Record<ServerStatus, Tone> = {
    healthy: 'emerald',
    warning: 'amber',
    critical: 'rose',
    maintenance: 'blue',
    offline: 'slate'
  };

  const SEVERITY_TONE: Record<IncidentSeverity, Tone> = {
    'SEV-1': 'rose',
    'SEV-2': 'amber',
    'SEV-3': 'blue',
    'SEV-4': 'slate'
  };

  const ALARM_TONE: Record<AlarmState, Tone> = {
    OK: 'emerald',
    ALARM: 'rose',
    INSUFFICIENT_DATA: 'violet'
  };

  const LOG_TONE: Record<string, Tone> = {
    DEBUG: 'slate',
    INFO: 'blue',
    WARN: 'amber',
    ERROR: 'rose',
    FATAL: 'violet'
  };

  const ENVIRONMENT_TONE: Record<string, Tone> = {
    production: 'rose',
    staging: 'amber',
    development: 'blue',
    testing: 'violet'
  };

  const VARIANT_PREFIX: Record<BadgeVariant, string> = {
    status: 'Status',
    severity: 'Severity',
    alarm: 'Alarm state',
    log: 'Log level',
    environment: 'Environment',
    neutral: ''
  };

  function resolveTone(variant: BadgeVariant, value: string): Tone {
    switch (variant) {
      case 'status':
        return STATUS_TONE[value as ServerStatus] ?? 'slate';
      case 'severity':
        return SEVERITY_TONE[value as IncidentSeverity] ?? 'slate';
      case 'alarm':
        return ALARM_TONE[value as AlarmState] ?? 'slate';
      case 'log':
        return LOG_TONE[value] ?? 'slate';
      case 'environment':
        return ENVIRONMENT_TONE[value] ?? 'slate';
      case 'neutral':
        return 'slate';
    }
  }

  /** `SEV-1` -> `Sev-1`, `networkIn` -> `Network In`. */
  function prettify(value: string): string {
    const spaced = value.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  }

  const SIZE_CLASS: Record<BadgeSize, string> = {
    sm: 'h-6 px-2 text-[10px] gap-1',
    md: 'h-7 px-2.5 text-[11px] gap-1.5'
  };
</script>

<script lang="ts">
  let {
    variant = 'status',
    value,
    label,
    size = 'md',
    dot = false,
    pulse = false,
    ariaLabel
  }: BadgeProps = $props();

  const tone = $derived(resolveTone(variant, value));
  const text = $derived(label ?? prettify(value));
  const accessibleName = $derived(
    ariaLabel ?? (VARIANT_PREFIX[variant] ? `${VARIANT_PREFIX[variant]}: ${text}` : text)
  );
</script>

<span
  data-testid="badge"
  data-variant={variant}
  data-value={value}
  data-tone={tone}
  class="inline-flex items-center rounded border font-mono font-semibold uppercase tracking-wide {SIZE_CLASS[
    size
  ]} {TONE_CLASS[tone]}"
  title={accessibleName}
  aria-label={accessibleName}
  role="status"
>
  {#if dot}
    <span
      data-testid="badge-dot"
      class="inline-block h-1.5 w-1.5 shrink-0 rounded-full {DOT_CLASS[tone]} {pulse
        ? 'animate-pulse'
        : ''}"
      aria-hidden="true"
    ></span>
  {/if}
  <span class="truncate">{text}</span>
</span>
