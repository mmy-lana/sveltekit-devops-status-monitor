<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  export interface InputProps {
    /** Visible label. Always rendered so the control has a programmatic name. */
    label: string;
    /** DOM id; generated from `name` when omitted. */
    id?: string;
    name?: string;
    type?: 'text' | 'search' | 'email' | 'url' | 'tel' | 'password' | 'number';
    /** Two-way bound value. */
    value?: string | number;
    placeholder?: string;
    /** Validation message; switches the control into its error state. */
    error?: string;
    /** Supplementary help text rendered beneath the control. */
    hint?: string;
    disabled?: boolean;
    readonly?: boolean;
    required?: boolean;
    autocomplete?: HTMLInputAttributes['autocomplete'];
    inputmode?: 'none' | 'text' | 'numeric' | 'decimal' | 'tel' | 'search' | 'email' | 'url';
    /** `min` attribute for number inputs. */
    min?: number;
    /** `max` attribute for number inputs. */
    max?: number;
    /** `step` attribute for number inputs. */
    step?: number | 'any';
    /** Leading adornment, typically a search glyph. */
    icon?: Snippet;
    /** Trailing control, typically a clear button. */
    trailing?: Snippet;
    /** Extra classes applied to the field wrapper. */
    class?: string;
    /** `data-testid` applied to the `<input>` element. */
    testId?: string;
    /** Emitted on every keystroke, in addition to the bound `value`. */
    oninput?: (event: Event & { currentTarget: HTMLInputElement }) => void;
    onkeydown?: (event: KeyboardEvent) => void;
    onblur?: (event: FocusEvent) => void;
  }

  let fieldSeq = 0;

  export function nextInputId(label: string): string {
    fieldSeq += 1;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `input-${slug || 'field'}-${fieldSeq}`;
  }
</script>

<script lang="ts">
  let {
    label,
    id,
    name,
    type = 'text',
    value = $bindable(''),
    placeholder,
    error,
    hint,
    disabled = false,
    readonly = false,
    required = false,
    autocomplete,
    inputmode,
    min,
    max,
    step,
    icon,
    trailing,
    class: className = '',
    testId,
    oninput,
    onkeydown,
    onblur
  }: InputProps = $props();

  const generatedId = $derived(id ?? nextInputId(label));
  const errorId = $derived(`${generatedId}-error`);
  const hintId = $derived(`${generatedId}-hint`);
  const describedBy = $derived(
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
  );
  const isNumeric = $derived(type === 'number');
</script>

<div class={`flex w-full flex-col gap-1.5 ${className}`}>
  <label for={generatedId} class="text-[11px] font-medium text-cw-muted">
    {label}
    {#if required}
      <span class="ml-0.5 text-cw-rose" aria-hidden="true">*</span>
      <span class="sr-only">(required)</span>
    {/if}
  </label>

  <div
    class="relative flex items-center rounded border bg-slate-base transition-colors focus-within:border-cw-accent {error
      ? 'border-cw-rose/60'
      : 'border-slate-border-strong'} {disabled ? 'opacity-50' : ''}"
  >
    {#if icon}
      <span class="pointer-events-none absolute left-3 flex items-center text-cw-faint" aria-hidden="true">
        {@render icon()}
      </span>
    {/if}

    <input
      id={generatedId}
      {name}
      {type}
      bind:value
      {placeholder}
      {disabled}
      {readonly}
      {required}
      {autocomplete}
      {inputmode}
      {min}
      {max}
      {step}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={describedBy}
      data-testid={testId ?? 'input'}
      data-error={error ? 'true' : undefined}
      class="h-11 w-full min-w-0 rounded bg-transparent px-3 text-[13px] text-cw-text placeholder:text-cw-faint focus:outline-none disabled:cursor-not-allowed {icon
        ? 'pl-9'
        : ''} {trailing ? 'pr-11' : ''} {isNumeric ? 'tnum font-mono' : ''}"
      oninput={oninput}
      onkeydown={onkeydown}
      onblur={onblur}
    />

    {#if trailing}
      <span class="absolute right-1 flex items-center">{@render trailing()}</span>
    {/if}
  </div>

  {#if error}
    <p
      id={errorId}
      data-testid="input-error"
      class="flex items-start gap-1 text-[11px] leading-snug text-cw-rose"
      role="alert"
    >
      <svg viewBox="0 0 16 16" class="mt-px h-3 w-3 shrink-0" fill="currentColor" aria-hidden="true">
        <path
          d="M8 1.5 15 14H1L8 1.5Zm0 4.2a.8.8 0 0 0-.8.85l.2 3.1a.6.6 0 0 0 1.2 0l.2-3.1A.8.8 0 0 0 8 5.7Zm0 5.6a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7Z"
        />
      </svg>
      <span>{error}</span>
    </p>
  {:else if hint}
    <p id={hintId} data-testid="input-hint" class="text-[11px] leading-snug text-cw-faint">
      {hint}
    </p>
  {/if}
</div>
