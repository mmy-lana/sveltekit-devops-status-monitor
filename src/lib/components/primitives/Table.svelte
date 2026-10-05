<script lang="ts" module>
  import type { Snippet } from 'svelte';

  /**
   * Column metadata. Rendering is delegated to the table-level `cell` snippet so
   * column content can be authored in markup rather than in script.
   */
  export interface TableColumn {
    /** Stable identifier, also used as the mobile label-value key. */
    key: string;
    /** Column header text. */
    label: string;
    /** Horizontal alignment within the grid. */
    align?: 'left' | 'center' | 'right';
    /** Extra classes applied to both the header cell and the grid cell. */
    class?: string;
    /**
     * When set to `false`, the column is dropped from the tablet-and-up grid
     * but still renders in the stacked mobile card layout.
     */
    inGrid?: boolean;
    /**
     * Hides the label above the value in the stacked mobile card. Use for the
     * leading cell of a row (the instance name, for example).
     */
    primary?: boolean;
  }

  export interface TableProps<TRow> {
    /** Column definitions, rendered left to right. */
    columns: TableColumn[];
    /** Rows to render. */
    rows: TRow[];
    /** Renders one cell. Receives the row and its column descriptor. */
    cell: Snippet<[TRow, TableColumn]>;
    /** Stable key for each row; must be unique across `rows`. */
    rowKey: (row: TRow) => string;
    /** DOM id applied to the root container. */
    testId?: string;
    /** Accessible caption, visually hidden unless `showCaption` is set. */
    caption?: string;
    showCaption?: boolean;
    /** Replaces the default empty state. */
    empty?: Snippet;
    emptyTitle?: string;
    emptyDescription?: string;
    /** Renders the loading skeleton instead of the grid. */
    loading?: boolean;
    loadingLabel?: string;
    /** Number of skeleton rows drawn while `loading` is true. */
    skeletonRows?: number;
    /** Turns a row into a link. Return a href per row. */
    rowHref?: (row: TRow) => string | undefined;
    /** Fired when a row without an `href` is activated. */
    onrowactivate?: (row: TRow) => void;
    /** Pins the first grid column while the table scrolls horizontally. */
    stickyFirstColumn?: boolean;
    /** Compact grid row height. */
    dense?: boolean;
    /** Additional classes applied to the outer container. */
    class?: string;
  }

  const ALIGN_CLASS: Record<'left' | 'center' | 'right', string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right'
  };
</script>

<script lang="ts" generics="TRow">
  let {
    columns,
    rows,
    cell,
    rowKey,
    testId,
    caption,
    showCaption = false,
    empty,
    emptyTitle = 'No records found',
    emptyDescription = 'Adjust the active filters to widen the result set.',
    loading = false,
    loadingLabel = 'Loading records',
    skeletonRows = 6,
    rowHref,
    onrowactivate,
    stickyFirstColumn = false,
    dense = false,
    class: className = ''
  }: TableProps<TRow> = $props();

  const gridColumns = $derived(columns.filter((column) => column.inGrid !== false));
  const isEmpty = $derived(!loading && rows.length === 0);
  const rowPad = $derived(dense ? 'px-3 py-2' : 'px-3 py-2.5 md:px-4 md:py-3');
</script>

{#snippet loadingSkeleton()}
  <div class="w-full" data-testid="table-skeleton">
    <div class="flex items-center gap-4 border-b border-slate-border bg-slate-base/70 px-3 py-2.5">
      {#each gridColumns as column (column.key)}
        <span class="h-2.5 flex-1 rounded bg-slate-border/80"></span>
      {/each}
    </div>
    {#each Array.from({ length: skeletonRows }, (_, i) => i) as rowIndex (rowIndex)}
      <div class="flex items-center gap-4 border-b border-slate-border/60 {rowPad}">
        {#each gridColumns as column, columnIndex (column.key)}
          <span
            class="h-2.5 rounded bg-slate-border/60"
            style={`width: ${columnIndex === 0 ? 62 : Math.max(22, 100 - columnIndex * 9)}%`}
          ></span>
        {/each}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet emptyState()}
  <div
    data-testid="table-empty"
    class="flex w-full flex-col items-center justify-center gap-2 px-6 py-12 text-center"
  >
    <svg
      viewBox="0 0 48 48"
      class="h-10 w-10 text-cw-faint"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <rect x="7" y="11" width="34" height="26" rx="3" />
      <path d="M7 19h34M16 11v26" stroke-linecap="round" />
      <path d="M24 26h9M24 31h6" stroke-linecap="round" opacity="0.5" />
    </svg>
    <p class="text-[13px] font-semibold text-cw-text">{emptyTitle}</p>
    <p class="max-w-xs text-[11px] leading-relaxed text-cw-muted">{emptyDescription}</p>
  </div>
{/snippet}

<!--
  Mobile card row.

  The card is a plain container, never an anchor. Cell content routinely renders
  its own links and buttons (a drill-down link plus an "Edit metadata" action),
  and wrapping those in an <a> produces nested interactive elements: invalid
  HTML, duplicated tab stops, and touch gestures that resolve to the wrong
  target. Navigation is therefore exposed through the primary cell's own link,
  and row-level activation is a sibling button rather than a wrapper.
-->
{#snippet cardCells(row: TRow)}
  {#each columns as column (column.key)}
    {#if column.primary || column.key === gridColumns[0]?.key}
      <div class="mb-1.5 text-[13px] font-semibold text-cw-text">{@render cell(row, column)}</div>
    {:else}
      <div class="flex items-baseline justify-between gap-3 py-0.5">
        <span class="shrink-0 text-[10px] uppercase tracking-wider text-cw-faint">
          {column.label}
        </span>
        <span class="min-w-0 text-right text-[12px] text-cw-text">
          {@render cell(row, column)}
        </span>
      </div>
    {/if}
  {/each}
{/snippet}

{#snippet cardRow(row: TRow, href: string | undefined, interactive: boolean)}
  <div
    class="relative px-4 py-3 transition-colors hover:bg-slate-surface/70"
    data-testid="table-card-body"
  >
    <div class="stretched-content">
      {@render cardCells(row)}
    </div>

    {#if href}
      <!--
        Stretched link: the overlay anchor keeps the whole card tappable while
        staying a sibling of the cell content, never an ancestor of it. It is
        hidden from assistive technology and removed from the tab order because
        the primary cell already exposes a properly labelled link to the same
        destination, which would otherwise be announced twice.
      -->
      <a
        href={href}
        data-testid="table-card-overlay-link"
        aria-hidden="true"
        tabindex="-1"
        class="absolute inset-0 z-0"
        onclick={(event: MouseEvent) => event.stopPropagation()}
      ></a>
    {:else if interactive}
      <button
        type="button"
        data-testid="table-card-button"
        class="mt-1 inline-flex min-h-11 items-center rounded border border-slate-border-strong px-3 text-[12px] text-cw-muted transition-colors hover:bg-white/5 hover:text-cw-text"
        onclick={() => onrowactivate?.(row)}
      >
        Open details
      </button>
    {/if}
  </div>
{/snippet}

<div class="@container w-full {className}" data-testid={testId}>
  {#if loading}
    <div data-testid="table-loading" class="w-full" role="status" aria-busy="true">
      <span class="sr-only">{loadingLabel}</span>
      {@render loadingSkeleton()}
    </div>
  {:else if isEmpty}
    {#if empty}
      <div data-testid="table-empty" class="w-full">
        {@render empty()}
      </div>
    {:else}
      {@render emptyState()}
    {/if}
  {:else}
    <!-- Tablet and up: multi-column data grid -->
    <div class="hidden @min-[48rem]:block" data-testid="table-grid-wrapper">
      <div class="w-full overflow-x-auto">
        <table data-testid="table-grid" class="w-full border-collapse text-[12px]" aria-label={caption}>
          {#if caption}
            <caption class:sr-only={!showCaption} class="px-4 py-2 text-left text-[11px] text-cw-muted">
              {caption}
            </caption>
          {/if}
          <thead>
            <tr class="border-b border-slate-border bg-slate-base/70">
              {#each gridColumns as column, columnIndex (column.key)}
                <th
                  scope="col"
                  class="whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-cw-muted {ALIGN_CLASS[
                    column.align ?? 'left'
                  ]} {column.class ?? ''} {stickyFirstColumn && columnIndex === 0
                    ? 'sticky left-0 z-20 bg-slate-card'
                    : ''}"
                >
                  {column.label}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-border/70">
            {#each rows as row (rowKey(row))}
              {@const href = rowHref?.(row)}
              {@const interactive = Boolean(href) || Boolean(onrowactivate)}
              <tr
                data-testid="table-row"
                class="transition-colors {interactive
                  ? 'cursor-pointer hover:bg-slate-surface/70'
                  : ''}"
                onclick={(event) => {
                  if (!interactive || href) return;
                  const target = event.target as HTMLElement | null;
                  if (target?.closest('a, button, input, select, textarea')) return;
                  onrowactivate?.(row);
                }}
                onkeydown={(event) => {
                  if (!interactive || href) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  const target = event.target as HTMLElement | null;
                  if (target?.closest('a, button, input, select, textarea')) return;
                  event.preventDefault();
                  onrowactivate?.(row);
                }}
                role={interactive && !href ? 'button' : undefined}
                tabindex={interactive && !href ? 0 : undefined}
              >
                {#each gridColumns as column, columnIndex (column.key)}
                  <td
                    class="align-middle {rowPad} {ALIGN_CLASS[column.align ?? 'left']} {column.class ??
                      ''} {stickyFirstColumn && columnIndex === 0
                      ? 'sticky left-0 z-10 bg-slate-card'
                      : ''}"
                  >
                    {@render cell(row, column)}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Below 768px the same rows stack into touch-sized cards -->
    <ul data-testid="table-cards" class="flex @min-[48rem]:hidden flex-col divide-y divide-slate-border/70">
      {#each rows as row (rowKey(row))}
        {@const href = rowHref?.(row)}
        {@const interactive = Boolean(href) || Boolean(onrowactivate)}
        <li data-testid="table-card">{@render cardRow(row, href, interactive)}</li>
      {/each}
    </ul>
  {/if}
</div>
