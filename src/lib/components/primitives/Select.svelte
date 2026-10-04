<script lang="ts" module>
  import type { Snippet } from 'svelte';

  /** One option in a native-backed select. */
  export interface SelectOption<TValue extends string = string> {
    value: TValue;
    label: string;
    /** Disables the option individually. */
    disabled?: boolean;
    /** Optional grouping label rendered as a disabled option group. */
    group?: string;
  }

  export interface SelectProps<TValue extends string = string> {
    /** Visible label. Always rendered so the control has a programmatic name. */
    label: string;
    /** DOM id; generated from the label when omitted. */
    id?: string;
    name?: string;
    /** Two-way bound selected value. */
    value?: TValue;
    /** The option set. Grouped options are rendered as `<optgroup>` blocks. */
    options: SelectOption<TValue>[];
    /** Validation message; switches the control into its error state. */
    error?: string;
    /** Supplementary help text rendered beneath the control. */
    hint?: string;
    disabled?: boolean;
    required?: boolean;
    /** Extra classes applied to the field wrapper. */
    class?: string;
    /** `data-testid` applied to the `<select>` element. */
    testId?: string;
    /** Leading adornment. */
    icon?: Snippet;
    onchange?: (event: Event & { currentTarget: HTMLSelectElement }) => void;
  }

  let fieldSeq = 0;

  export function nextSelectId(label: string): string {
    fieldSeq += 1;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `select-${slug || 'field'}-${fieldSeq}`;
  }
</script>

<script lang="ts" generics="TValue extends string">
  let {
    label,
    id,
    name,
    value = $bindable(),
    options,
    error,
    hint,
    disabled = false,
    required = false,
    class: className = '',
    testId,
    icon,
    onchange
  }: SelectProps<TValue> = $props();

  const generatedId = $derived(id ?? nextSelectId(label));
  const errorId = $derived(`${generatedId}-error`);
  const hintId = $derived(`${generatedId}-hint`);
  const describedBy = $derived(
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
  );

  const groups = $derived.by(() => {
    const buckets = new Map<string, SelectOption<TValue>[]>();
    for (const option of options) {
      const key = option.group ?? '';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(option);
      else buckets.set(key, [option]);
    }
    return [...buckets.entries()].map(([group, items]) => ({ group, items }));
  });

  const hasGroups = $derived(groups.length > 1 || Boolean(groups[0]?.group));
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

    <select
      id={generatedId}
      {name}
      {disabled}
      {required}
      bind:value
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={describedBy}
      data-testid={testId ?? 'select'}
      data-error={error ? 'true' : undefined}
      class="h-11 w-full min-w-0 cursor-pointer appearance-none rounded bg-transparent px-3 pr-9 text-[13px] text-cw-text focus:outline-none disabled:cursor-not-allowed {icon
        ? 'pl-9'
        : ''}"
      onchange={onchange}
    >
      {#each groups as bucket (bucket.group)}
        {#if hasGroups && bucket.group}
          <optgroup label={bucket.group} class="bg-slate-card text-cw-faint">
            {#each bucket.items as option (option.value)}
              <option value={option.value} disabled={option.disabled} class="bg-slate-card text-cw-text">
                {option.label}
              </option>
            {/each}
          </optgroup>
        {:else}
          {#each bucket.items as option (option.value)}
            <option value={option.value} disabled={option.disabled} class="bg-slate-card text-cw-text">
              {option.label}
            </option>
          {/each}
        {/if}
      {/each}
    </select>

    <svg
      viewBox="0 0 16 16"
      class="pointer-events-none absolute right-3 h-3.5 w-3.5 text-cw-faint"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  </div>

  {#if error}
    <p
      id={errorId}
      data-testid="select-error"
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
    <p id={hintId} data-testid="select-hint" class="text-[11px] leading-snug text-cw-faint">
      {hint}
    </p>
  {/if}
</div>
