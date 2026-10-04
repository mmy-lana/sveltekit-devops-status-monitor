<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

  export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';
  export type ButtonSize = 'sm' | 'md' | 'lg';

  export interface ButtonProps {
    /** Visual treatment. `icon` renders a square control with no padding text. */
    variant?: ButtonVariant;
    /** Density. Every size keeps at least a 44px hit area on touch. */
    size?: ButtonSize;
    /** Native button semantics; ignored when `href` is supplied. */
    type?: HTMLButtonAttributes['type'];
    disabled?: boolean;
    /** Shows a spinner and blocks interaction while an action is in flight. */
    loading?: boolean;
    /** Accessible name. Required for `icon` and `ghost` variants. */
    ariaLabel?: string;
    /** Tooltip text; also becomes the `title` attribute. */
    title?: string;
    /** Full-width block button. */
    block?: boolean;
    /** Renders an anchor instead of a button. */
    href?: string;
    /** Anchor behaviour when `href` is set. */
    target?: HTMLAnchorAttributes['target'];
    rel?: HTMLAnchorAttributes['rel'];
    /** Additional classes appended verbatim. */
    class?: string;
    /** `data-testid` applied to the rendered anchor or button. */
    testId?: string;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
    /** Leading adornment, typically an inline SVG icon. */
    icon?: Snippet;
    /** Trailing adornment, typically a chevron or count chip. */
    trailing?: Snippet;
  }

  const BASE =
    'relative inline-flex items-center justify-center gap-2 rounded border font-medium ' +
    'transition-colors select-none whitespace-nowrap ' +
    'disabled:opacity-45 disabled:cursor-not-allowed';

  const VARIANT_CLASS: Record<ButtonVariant, string> = {
    primary:
      'bg-cw-accent border-cw-accent text-white hover:bg-cw-accent-hover hover:border-cw-accent-hover active:bg-cw-accent',
    secondary:
      'bg-slate-card border-slate-border-strong text-cw-text hover:bg-slate-surface hover:border-slate-500 active:bg-slate-base',
    danger: 'bg-cw-rose/15 border-cw-rose/45 text-cw-rose hover:bg-cw-rose/25 hover:border-cw-rose/70',
    ghost: 'bg-transparent border-transparent text-cw-muted hover:bg-white/6 hover:text-cw-text',
    icon:
      'bg-slate-card border-slate-border-strong text-cw-muted hover:bg-slate-surface hover:text-cw-text active:bg-slate-base'
  };

  /**
   * `sm` still clears 44px because the console is touch-first; it only trims
   * the horizontal padding and the type scale.
   */
  const SIZE_CLASS: Record<ButtonVariant, Record<ButtonSize, string>> = {
    primary: {
      sm: 'h-11 px-3 text-xs',
      md: 'h-11 px-4 text-[13px]',
      lg: 'h-12 px-6 text-sm'
    },
    secondary: {
      sm: 'h-11 px-3 text-xs',
      md: 'h-11 px-4 text-[13px]',
      lg: 'h-12 px-6 text-sm'
    },
    danger: {
      sm: 'h-11 px-3 text-xs',
      md: 'h-11 px-4 text-[13px]',
      lg: 'h-12 px-6 text-sm'
    },
    ghost: {
      sm: 'h-11 px-2 text-xs',
      md: 'h-11 px-3 text-[13px]',
      lg: 'h-12 px-4 text-sm'
    },
    icon: {
      sm: 'h-11 w-11 shrink-0',
      md: 'h-11 w-11 shrink-0',
      lg: 'h-12 w-12 shrink-0'
    }
  };

  const TEXT_SIZE: Record<ButtonSize, string> = {
    sm: 'text-xs',
    md: 'text-[13px]',
    lg: 'text-sm'
  };
</script>

<script lang="ts">
  let {
    variant = 'secondary',
    size = 'md',
    type = 'button',
    disabled = false,
    loading = false,
    ariaLabel,
    title,
    block = false,
    href,
    target,
    rel,
    class: className = '',
    testId,
    onclick,
    children,
    icon,
    trailing
  }: ButtonProps = $props();

  const isInactive = $derived(disabled || loading);
  const composed = $derived(
    `${BASE} ${VARIANT_CLASS[variant]} ${SIZE_CLASS[variant][size]} ${block ? 'w-full' : ''} ${className}`
  );
</script>

{#snippet content()}
  {#if loading}
    <span
      data-testid="button-spinner"
      class="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
      aria-hidden="true"
    ></span>
  {:else if icon}
    <span class="inline-flex shrink-0 items-center" aria-hidden="true">{@render icon()}</span>
  {/if}
  {#if children}
    <span class={variant === 'icon' ? 'sr-only' : 'truncate'}>{@render children()}</span>
  {/if}
  {#if trailing && !loading}
    <span class="inline-flex shrink-0 items-center" aria-hidden="true">{@render trailing()}</span>
  {/if}
{/snippet}

{#if href}
  <a
    {href}
    {target}
    {rel}
    {title}
    aria-label={ariaLabel}
    aria-disabled={isInactive ? 'true' : undefined}
    class={composed}
    data-testid={testId ?? 'button'}
    onclick={isInactive ? undefined : onclick}
  >
    {@render content()}
  </a>
{:else}
  <button
    {type}
    {title}
    aria-label={ariaLabel}
    aria-busy={loading ? 'true' : undefined}
    disabled={isInactive}
    class={`${composed} ${TEXT_SIZE[size]}`}
    data-testid={testId ?? 'button'}
    data-variant={variant}
    onclick={onclick}
  >
    {@render content()}
  </button>
{/if}
