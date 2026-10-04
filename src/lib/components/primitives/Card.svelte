<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
  export type CardTone = 'default' | 'raised' | 'flush';

  export interface CardProps {
    /** Heading rendered in the header row. */
    title?: string;
    /** Secondary line beneath the heading. */
    subtitle?: string;
    /** Small monospaced annotation on the trailing edge of the header. */
    meta?: string;
    /** Visual weight. `raised` lifts the panel, `flush` removes the border. */
    tone?: CardTone;
    /** Internal spacing around the body content. */
    padding?: CardPadding;
    /** Hides the header entirely while keeping actions renderable. */
    hideHeader?: boolean;
    /** Sticks the header above scrolling body content. */
    stickyHeader?: boolean;
    /** Additional classes applied to the outer panel. */
    class?: string;
    /** `data-testid` applied to the outer panel. */
    testId?: string;
    /** Accessible heading level for the card title. */
    headingLevel?: 2 | 3 | 4;
    /** Controls rendered on the trailing edge of the header. */
    actions?: Snippet;
    /** Rendered between the header and the body. */
    toolbar?: Snippet;
    /** Body content. */
    children?: Snippet;
    /** Rendered below the body inside the panel border. */
    footer?: Snippet;
  }

  const PADDING_CLASS: Record<CardPadding, string> = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5 md:p-6'
  };

  const TONE_CLASS: Record<CardTone, string> = {
    default: 'bg-slate-card border-slate-border',
    raised: 'bg-slate-card border-slate-border-strong shadow-panel',
    flush: 'bg-transparent border-transparent'
  };
</script>

<script lang="ts">
  let {
    title,
    subtitle,
    meta,
    tone = 'default',
    padding = 'md',
    hideHeader = false,
    stickyHeader = false,
    class: className = '',
    testId,
    headingLevel = 3,
    actions,
    toolbar,
    children,
    footer
  }: CardProps = $props();

  const hasHeader = $derived(!hideHeader && (Boolean(title) || Boolean(actions)));
  const headingTag = $derived(`h${headingLevel}`);
</script>

<section data-testid={testId ?? 'card'} class="rounded border {TONE_CLASS[tone]} {className}">
  {#if hasHeader}
    <header
      class="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-border px-4 py-2.5 {stickyHeader
        ? 'sticky top-0 z-10 bg-slate-card'
        : ''}"
    >
      <div class="min-w-0 flex-1">
        {#if title}
          <svelte:element
            this={headingTag}
            class="truncate text-[13px] font-semibold tracking-tight text-cw-text"
            data-testid="card-title"
          >
            {title}
          </svelte:element>
        {/if}
        {#if subtitle}
          <p class="mt-0.5 truncate text-[11px] text-cw-muted">{subtitle}</p>
        {/if}
      </div>

      {#if meta}
        <span class="font-mono text-[11px] text-cw-faint" data-testid="card-meta">{meta}</span>
      {/if}

      {#if actions}
        <div class="flex shrink-0 items-center gap-2" data-testid="card-actions">
          {@render actions()}
        </div>
      {/if}
    </header>
  {/if}

  {#if toolbar}
    <div class="border-b border-slate-border px-4 py-2.5">{@render toolbar()}</div>
  {/if}

  <div class={PADDING_CLASS[padding]} data-testid="card-body">
    {@render children?.()}
  </div>

  {#if footer}
    <footer class="border-t border-slate-border px-4 py-2.5">{@render footer()}</footer>
  {/if}
</section>
