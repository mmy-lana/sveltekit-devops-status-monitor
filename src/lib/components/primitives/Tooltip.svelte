<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type TooltipPlacement = 'top' | 'bottom';

  export interface TooltipProps {
    /** Contextual text announced when the trigger is activated. */
    content: string;
    /** Optional rich content rendered instead of `content`. */
    children?: Snippet;
    /** Preferred side of the trigger. Auto-flips when there is no room. */
    placement?: TooltipPlacement;
    /** Accessible name for the trigger icon. */
    triggerLabel?: string;
    /** Disables the tooltip and renders a plain inline wrapper. */
    disabled?: boolean;
    /** Maximum rendered width in pixels. */
    maxWidth?: number;
  }

  let tooltipSeq = 0;

  export function nextTooltipId(label: string): string {
    tooltipSeq += 1;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `tooltip-${slug || 'info'}-${tooltipSeq}`;
  }
</script>

<script lang="ts">
  let {
    content,
    children,
    placement = 'top',
    triggerLabel = 'More information',
    disabled = false,
    maxWidth = 280
  }: TooltipProps = $props();

  const id = $derived(nextTooltipId(triggerLabel));
  const triggerId = $derived(`${id}-trigger`);

  let open = $state(false);
  let openedByFocus = false;
  let anchor = $state<HTMLButtonElement | null>(null);
  let position = $state<{ left: number; top: number; placement: TooltipPlacement | null }>({
    left: 0,
    top: 0,
    placement: null
  });

  function show() {
    if (disabled || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const gap = 8;

    const width = Math.min(maxWidth, rect.width);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);

    // Measure the bubble after it renders; approximate with the content length first.
    const estimatedHeight = Math.min(160, 40 + Math.ceil(content.length / 34) * 17);
    const fitsAbove = rect.top - gap - estimatedHeight >= margin;
    const resolvedPlacement: TooltipPlacement = fitsAbove ? 'top' : 'bottom';
    const top = resolvedPlacement === 'top' ? rect.top - gap - estimatedHeight : rect.bottom + gap;

    position = {
      left,
      top: Math.max(margin, Math.min(top, window.innerHeight - estimatedHeight - margin)),
      placement: resolvedPlacement
    };
    open = true;
  }

  function hide() {
    open = false;
    openedByFocus = false;
  }

  /**
   * Pointer activation must not immediately dismiss a bubble that focus just
   * opened, so the focus flag distinguishes "focus opened it" from "the user
   * pressed it again to dismiss".
   */
  function toggle() {
    if (open && !openedByFocus) hide();
    else show();
    openedByFocus = false;
  }

  function onfocus() {
    if (open) return;
    openedByFocus = true;
    show();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      hide();
      anchor?.focus();
    }
  }

  function onpointerdown(event: PointerEvent) {
    if (!open) return;
    const target = event.target as Node | null;
    if (target && anchor && !anchor.contains(target)) hide();
  }
</script>

<svelte:window onpointerdown={onpointerdown} onresize={hide} onscroll={hide} />

<span class="relative inline-flex">
  <button
    bind:this={anchor}
    id={triggerId}
    type="button"
    data-testid="tooltip-trigger"
    aria-describedby={open ? id : undefined}
    aria-expanded={open}
    aria-label={triggerLabel}
    title={disabled ? triggerLabel : undefined}
    disabled={disabled}
    class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cw-faint transition-colors hover:bg-white/6 hover:text-cw-text disabled:cursor-default disabled:opacity-60"
    onclick={toggle}
    onfocus={onfocus}
    onblur={hide}
    onkeydown={onkeydown}
  >
    <svg viewBox="0 0 16 16" class="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path
        d="M8 1.2a6.8 6.8 0 1 0 0 13.6A6.8 6.8 0 0 0 8 1.2Zm0 9.6a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7Zm0-7a2.1 2.1 0 0 1 2.1 2.3c0 1.05-.55 1.35-1.15 1.75-.5.33-.65.52-.65 1a.7.7 0 0 1-1.4.02c0-1.15.45-1.6 1.1-2.05.5-.35.65-.5.65-.9 0-.45-.32-.72-.8-.72-.5 0-.85.32-.9.8a.7.7 0 0 1-1.38-.2A1.85 1.85 0 0 1 8 3.8Z"
      />
    </svg>
  </button>

  {#if open}
    <div
      {id}
      role="tooltip"
      data-testid="tooltip"
      data-placement={position.placement}
      class="fixed z-50 rounded border border-slate-border-strong bg-slate-surface px-3 py-2 font-sans text-[11px] leading-relaxed text-cw-text shadow-overlay"
      style={`left: ${position.left}px; top: ${position.top}px; max-width: ${maxWidth}px;`}
    >
      {#if children}
        {@render children()}
      {:else}
        {content}
      {/if}
    </div>
  {/if}
</span>
