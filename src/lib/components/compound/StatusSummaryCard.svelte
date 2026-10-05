<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type SummaryTone = 'neutral' | 'emerald' | 'amber' | 'rose' | 'blue' | 'violet';

  export interface StatusSummaryCardProps {
    /** Short metric label, e.g. "Fleet CPU". */
    label: string;
    /** Primary readout. Pre-formatted by the caller. */
    value: string;
    /** Secondary context line beneath the readout. */
    detail?: string;
    tone?: SummaryTone;
    /** Trailing count rendered beside the label, e.g. "3 / 12". */
    trailing?: string;
    /** Renders a utilisation bar under the readout. */
    progress?: number;
    progressLabel?: string;
    warningThreshold?: number;
    criticalThreshold?: number;
    /** Contextual explanation surfaced by the Tooltip primitive. */
    tooltip?: string;
    /** Leading glyph. */
    icon?: Snippet;
    /** Extra adornment pinned to the bottom-right of the card. */
    footer?: Snippet;
    /** DOM id for the card root. */
    testId?: string;
    /** Clickable card. */
    href?: string;
  }

  const VALUE_TONE: Record<SummaryTone, string> = {
    neutral: 'text-cw-text',
    emerald: 'text-cw-emerald',
    amber: 'text-cw-amber',
    rose: 'text-cw-rose',
    blue: 'text-cw-blue',
    violet: 'text-cw-violet'
  };
</script>

<script lang="ts">
  import Card from '#lib/components/primitives/Card.svelte';
  import ProgressBar from '#lib/components/primitives/ProgressBar.svelte';
  import Tooltip from '#lib/components/primitives/Tooltip.svelte';

  let {
    label,
    value,
    detail,
    tone = 'neutral',
    trailing,
    progress,
    progressLabel,
    warningThreshold = 75,
    criticalThreshold = 90,
    tooltip,
    icon,
    footer,
    testId,
    href
  }: StatusSummaryCardProps = $props();
</script>

{#snippet body()}
  <div class="flex items-start gap-2">
    {#if icon}
      <span class="mt-0.5 shrink-0 text-cw-faint" aria-hidden="true">{@render icon()}</span>
    {/if}

    <div class="min-w-0 flex-1">
      <div class="flex items-start justify-between gap-1">
        <p class="min-w-0 flex-1 text-[11px] font-medium leading-snug text-cw-muted">{label}</p>
        {#if trailing}
          <span class="tnum shrink-0 font-mono text-[11px] text-cw-faint">{trailing}</span>
        {/if}
        {#if tooltip}
          <Tooltip content={tooltip} triggerLabel={`About ${label}`} />
        {/if}
      </div>

      <p class="tnum mt-1 font-mono text-2xl font-semibold {VALUE_TONE[tone]}">{value}</p>

      {#if detail}
        <p class="mt-0.5 text-[11px] leading-snug text-cw-muted">{detail}</p>
      {/if}

      {#if progress !== undefined}
        <div class="mt-2">
          <ProgressBar
            value={progress}
            size="sm"
            hideLabel
            {warningThreshold}
            label={progressLabel ?? label}
          />
        </div>
      {/if}

      {#if footer}
        <div class="mt-2">{@render footer()}</div>
      {/if}
    </div>
  </div>
{/snippet}

{#if href}
  <a
    {href}
    data-testid={testId}
    class="block rounded transition-colors hover:bg-slate-surface/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cw-accent"
  >
    <Card padding="md" class="pointer-events-none">
      {@render body()}
    </Card>
  </a>
{:else}
  <Card padding="md" {testId}>
    {@render body()}
  </Card>
{/if}
