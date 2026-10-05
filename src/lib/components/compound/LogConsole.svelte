<script lang="ts" module>
  import type { LogEntry, LogLevel } from '$lib/types/monitor';

  export interface LogConsoleProps {
    /** Entries to render, any order. Sorted newest first internally. */
    entries: LogEntry[];
    /** Two-way bound free-text / regular expression filter. */
    query?: string;
    /** Two-way bound set of active log levels. */
    activeLevels?: LogLevel[];
    /** Two-way bound auto-scroll preference. */
    autoScroll?: boolean;
    /** Maximum rows rendered at once. */
    limit?: number;
    /** Shows the loading skeleton instead of the stream. */
    loading?: boolean;
    loadingLabel?: string;
    emptyTitle?: string;
    emptyDescription?: string;
    /** Accessible name for the scroll region. */
    label?: string;
    /** Number of entries currently in the store, for the header meta. */
    totalCount?: number;
  }

  const LEVEL_TEXT_CLASS: Record<LogLevel, string> = {
    DEBUG: 'text-cw-muted',
    INFO: 'text-cw-blue',
    WARN: 'text-cw-amber',
    ERROR: 'text-cw-rose',
    FATAL: 'text-cw-violet'
  };

  const LEVEL_CHIP_ACTIVE: Record<LogLevel, string> = {
    DEBUG: 'border-cw-muted/50 bg-white/8 text-cw-text',
    INFO: 'border-cw-blue/50 bg-cw-blue/14 text-cw-blue',
    WARN: 'border-cw-amber/50 bg-cw-amber/14 text-cw-amber',
    ERROR: 'border-cw-rose/50 bg-cw-rose/14 text-cw-rose',
    FATAL: 'border-cw-violet/50 bg-cw-violet/14 text-cw-violet'
  };

  const LEVEL_CHIP_IDLE: Record<LogLevel, string> = {
    DEBUG: 'border-slate-border-strong text-cw-faint',
    INFO: 'border-slate-border-strong text-cw-faint',
    WARN: 'border-slate-border-strong text-cw-faint',
    ERROR: 'border-slate-border-strong text-cw-faint',
    FATAL: 'border-slate-border-strong text-cw-faint'
  };

  /** Hard ceiling on query length; longer input is rejected outright. */
  export const MAX_QUERY_LENGTH = 64;

  /** Budget for one full match pass across every record, in milliseconds. */
  export const MATCH_BUDGET_MS = 10;

  /** A quantified group whose body can itself repeat, e.g. `(a+)+` or `(.*)*`. */
  const NESTED_REPEAT = /\([^()]*[*+][^()]*\)\s*[*+]/;

  /** A quantified group followed by an outer quantifier, e.g. `(a+)+?`-style nesting. */
  const NESTED_QUANTIFIER = /(\([^()]*\)|\[[^\]]*\]|\\[dDwWsSbB])[*+]/;

  /** Stacked quantifiers on one target, e.g. `a**` or `a++`. */
  const AMBIGUOUS_RUN = /([*+])\s*\1/;

  /**
   * Static analysis for catastrophic-backtracking shapes.
   *
   * `RegExp.test` cannot be interrupted once it starts, so an operator supplied
   * pattern must never reach the engine unfiltered. Rejection is deliberately
   * layered: each rule catches a class the others can miss.
   */
  export function findUnsafePattern(source: string): string | null {
    if (source.length > MAX_QUERY_LENGTH) {
      return `Query is limited to ${MAX_QUERY_LENGTH} characters`;
    }
    if (NESTED_REPEAT.test(source)) {
      return 'Nested quantifiers such as (a+)+ backtrack exponentially and are rejected';
    }
    if (NESTED_QUANTIFIER.test(source)) {
      return 'Nested quantifiers such as (a+)+ backtrack exponentially and are rejected';
    }
    if (AMBIGUOUS_RUN.test(source)) {
      return 'Stacked quantifiers such as a** backtrack exponentially and are rejected';
    }
    return null;
  }

  /** How a compiled query is actually being applied. */
  export type QueryStrategy = 'all' | 'regexp' | 'literal';

  export interface CompiledQuery {
    /** Compiled pattern, or null when matching by literal substring only. */
    pattern: RegExp | null;
    /** Trimmed raw query, retained for substring fallback. */
    literal: string;
    /** Why the pattern was rejected or failed to compile, shown to the operator. */
    error: string | null;
    /** Matching mode selected at compile time. */
    strategy: QueryStrategy;
    /** True when a safety rule forced a fallback away from the operator intent. */
    degraded: boolean;
  }

  export interface QueryResult {
    /** Records that matched. */
    matches: LogEntry[];
    /** Strategy actually used for this pass. */
    strategy: QueryStrategy;
    /** True when the pass fell back to substring matching. */
    degraded: boolean;
    /** Wall-clock duration of the whole pass. */
    durationMs: number;
    /** Compile-time error carried through for display. */
    error: string | null;
  }

  const ALL_LEVELS_TEXT = 'every level';

  /** The text a record is matched against. */
  function haystack(entry: LogEntry): string {
    return `${entry.level} ${entry.service} ${entry.message} ${entry.serverId}`;
  }

  /**
   * Compile the operator query.
   *
   * Rejection is never fatal: the console degrades to linear substring matching
   * so a hostile or malformed pattern cannot leave the operator with a dead
   * filter or a stalled main thread.
   */
  export function compileQuery(raw: string): CompiledQuery {
    const literal = raw.trim();
    if (literal.length === 0) {
      return { pattern: null, literal, error: null, strategy: 'all', degraded: false };
    }

    const unsafe = findUnsafePattern(literal);
    if (unsafe) {
      return { pattern: null, literal, error: unsafe, strategy: 'literal', degraded: true };
    }

    try {
      return {
        pattern: new RegExp(literal, 'i'),
        literal,
        error: null,
        strategy: 'regexp',
        degraded: false
      };
    } catch (error) {
      return {
        pattern: null,
        literal,
        error: error instanceof Error ? error.message : 'Invalid regular expression',
        strategy: 'literal',
        degraded: false
      };
    }
  }

  /**
   * Apply a compiled query across a record set under a wall-clock budget.
   *
   * The budget is enforced cooperatively between records: once the pass has run
   * long enough to threaten the frame budget, the remainder is matched by
   * substring and the result is flagged as degraded. This bounds the worst case
   * even if a pattern slips past static analysis.
   */
  export function runQuery(
    query: CompiledQuery,
    entries: readonly LogEntry[],
    budgetMs: number = MATCH_BUDGET_MS
  ): QueryResult {
    const startedAt = performance.now();
    const matches: LogEntry[] = [];

    if (query.strategy === 'all') {
      for (const entry of entries) matches.push(entry);
      return { matches, strategy: 'all', degraded: false, durationMs: 0, error: null };
    }

    const needle = query.literal.toLowerCase();
    let degraded = query.degraded;
    let strategy: QueryStrategy = query.strategy;
    const pattern = query.pattern;

    for (const entry of entries) {
      const text = haystack(entry);
      const hit = pattern && !degraded ? pattern.test(text) : text.toLowerCase().includes(needle);
      if (hit) matches.push(entry);

      if (!degraded && performance.now() - startedAt > budgetMs) {
        degraded = true;
        strategy = 'literal';
      }
    }

    return {
      matches,
      strategy,
      degraded,
      durationMs: performance.now() - startedAt,
      error: query.error
    };
  }
</script>

<script lang="ts">
  import { LOG_LEVEL_ORDER, formatLogTimestamp } from '$lib/utils/formatting';

  let {
    entries,
    query = $bindable(''),
    activeLevels = $bindable<LogLevel[]>(['INFO', 'WARN', 'ERROR', 'FATAL']),
    autoScroll = $bindable(true),
    limit = 400,
    loading = false,
    loadingLabel = 'Loading log stream',
    emptyTitle = 'No log entries',
    emptyDescription = 'Log lines appear here once the telemetry agent emits a heartbeat for this instance.',
    label = 'Server log console',
    totalCount
  }: LogConsoleProps = $props();

  let stream = $state<HTMLDivElement | null>(null);
  let lastEntryId = $state<string | null>(null);

  const compiled = $derived(compileQuery(query));

  const sorted = $derived([...entries].sort((a, b) => b.timestamp - a.timestamp));

  const queryResult = $derived(runQuery(compiled, sorted));

  const filtered = $derived.by(() => {
    const levels = new Set(activeLevels);
    return queryResult.matches.filter((entry) => levels.has(entry.level)).slice(0, limit);
  });

  const hiddenByLevel = $derived(sorted.length - sorted.filter((e) => activeLevels.includes(e.level)).length);
  const matchesAll = $derived(activeLevels.length === LOG_LEVEL_ORDER.length);

  const headerMeta = $derived(
    totalCount === undefined
      ? `${filtered.length} shown`
      : `${filtered.length} / ${totalCount} entries`
  );

  function toggleLevel(level: LogLevel) {
    activeLevels = activeLevels.includes(level)
      ? activeLevels.filter((item) => item !== level)
      : LOG_LEVEL_ORDER.filter((item) => item === level || activeLevels.includes(item));
  }

  function clearFilters() {
    query = '';
    activeLevels = [...LOG_LEVEL_ORDER];
  }

  function scrollToLatest() {
    if (!stream) return;
    stream.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onScroll() {
    if (!stream || !autoScroll) return;
    if (stream.scrollTop > 24) autoScroll = false;
  }

  // Follow new lines only while the operator has not scrolled away.
  $effect(() => {
    const newest = filtered[0]?.id ?? null;
    if (!stream || !autoScroll || newest === null) return;
    if (newest === lastEntryId) return;
    lastEntryId = newest;
    stream.scrollTop = 0;
  });
</script>

<div
  data-testid="log-console"
  class="flex min-h-0 flex-col overflow-hidden rounded border border-slate-border bg-slate-base"
>
  <!-- toolbar -->
  <div class="flex flex-col gap-2 border-b border-slate-border bg-slate-card px-3 py-2.5">
    <div class="flex flex-wrap items-center gap-2">
      <label for="log-search-input" class="sr-only">Search log entries</label>
      <div class="relative min-w-0 flex-1">
        <svg
          viewBox="0 0 16 16"
          class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cw-faint"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.4" />
          <path d="m10.4 10.4 3 3" stroke-linecap="round" />
        </svg>
        <input
          id="log-search-input"
          data-testid="log-search"
          type="search"
          bind:value={query}
          spellcheck="false"
          autocomplete="off"
          placeholder="Filter with text or a regular expression…"
          aria-invalid={compiled.error ? 'true' : undefined}
          aria-describedby={compiled.error ? 'log-search-error' : 'log-search-hint'}
          class="h-11 w-full min-w-0 rounded border bg-slate-base pl-9 pr-3 font-mono text-[12px] text-cw-text placeholder:text-cw-faint focus:outline-none {compiled.error
            ? 'border-cw-rose/60'
            : 'border-slate-border-strong focus:border-cw-accent'}"
        />
      </div>

      <button
        type="button"
        data-testid="log-autoscroll"
        aria-pressed={autoScroll}
        class="flex h-11 shrink-0 items-center gap-1.5 rounded border px-3 text-[12px] font-medium transition-colors {autoScroll
          ? 'border-cw-accent/45 bg-cw-accent/14 text-cw-accent'
          : 'border-slate-border-strong text-cw-muted hover:bg-white/5 hover:text-cw-text'}"
        onclick={() => (autoScroll = !autoScroll)}
      >
        <svg viewBox="0 0 16 16" class="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M8 1.6 12.8 6 11.4 7.5 9 5v6.4h2.2L8 14.4 4.8 11.4H7V5L4.6 7.5 3.2 6 8 1.6Z" />
        </svg>
        Follow
      </button>
    </div>

    <div class="flex items-center gap-2">
      <div class="scroll-strip min-w-0 flex-1" role="group" aria-label="Filter by log level">
        {#each LOG_LEVEL_ORDER as level (level)}
          <button
            type="button"
            data-testid={`log-level-${level}`}
            aria-pressed={activeLevels.includes(level)}
            class="flex h-11 shrink-0 items-center gap-1.5 rounded border px-3 font-mono text-[10px] font-semibold transition-colors {activeLevels.includes(
              level
            )
              ? LEVEL_CHIP_ACTIVE[level]
              : LEVEL_CHIP_IDLE[level]}"
            onclick={() => toggleLevel(level)}
          >
            {level}
          </button>
        {/each}
      </div>

      <span class="tnum shrink-0 font-mono text-[10px] text-cw-faint" data-testid="log-meta">
        {headerMeta}
      </span>

      <button
        type="button"
        data-testid="log-clear"
        class="h-11 shrink-0 rounded border border-slate-border-strong px-3 font-mono text-[10px] text-cw-muted transition-colors hover:bg-white/5 hover:text-cw-text"
        onclick={clearFilters}
        disabled={compiled.pattern === null && matchesAll}
        title="Clear the query and level filters"
      >
        Clear
      </button>
    </div>

    {#if compiled.error}
      <p
        id="log-search-error"
        data-testid="log-search-error"
        data-degraded={compiled.degraded ? 'true' : 'false'}
        class="flex items-start gap-1 text-[11px] leading-snug {compiled.degraded
          ? 'text-cw-amber'
          : 'text-cw-rose'}"
        role="alert"
      >
        <svg viewBox="0 0 16 16" class="mt-px h-3 w-3 shrink-0" fill="currentColor" aria-hidden="true">
          <path d="M8 1.5 15 14H1L8 1.5Zm0 4.2a.8.8 0 0 0-.8.85l.2 3.1a.6.6 0 0 0 1.2 0l.2-3.1A.8.8 0 0 0 8 5.7Zm0 5.6a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7Z" />
        </svg>
        <span>{compiled.error}</span>
      </p>
      {#if compiled.degraded}
        <p class="mt-1 text-[10px] text-cw-faint" data-testid="log-query-degraded">
          Matching fell back to plain substring search; no regular expression is running against
          your records.
        </p>
      {/if}
    {:else if queryResult.degraded}
      <p class="text-[10px] text-cw-amber" data-testid="log-query-degraded">
        Match budget of {MATCH_BUDGET_MS}ms exceeded; remaining records matched by substring.
      </p>
    {:else}
      <p id="log-search-hint" class="text-[10px] text-cw-faint">
        Plain text or a regular expression, matched against level, service and message.
      </p>
    {/if}
  </div>

  <!-- stream -->
  {#if loading}
    <div
      class="flex flex-col gap-2 p-3"
      role="status"
      aria-busy="true"
      data-testid="log-loading"
    >
      <span class="sr-only">{loadingLabel}</span>
      {#each Array.from({ length: 8 }, (_, i) => i) as row (row)}
        <span
          class="h-2.5 rounded bg-slate-border/60"
          style={`width: ${45 + ((row * 13) % 50)}%`}
        ></span>
      {/each}
    </div>
  {:else if filtered.length === 0}
    <div
      data-testid="log-empty"
      class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center"
    >
      <svg
        viewBox="0 0 48 48"
        class="h-10 w-10 text-cw-faint"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <rect x="8" y="10" width="32" height="28" rx="3" />
        <path d="M15 19h13M15 25h18M15 31h9" stroke-linecap="round" opacity="0.55" />
      </svg>
      <p class="text-[13px] font-semibold text-cw-text">{emptyTitle}</p>
      <p class="max-w-xs text-[11px] leading-relaxed text-cw-muted">
        {query.trim().length > 0 || !matchesAll
          ? 'No entries match the active query and level filters.'
          : emptyDescription}
      </p>
      {#if query.trim().length > 0 || !matchesAll}
        <button
          type="button"
          data-testid="log-empty-reset"
          class="mt-1 h-11 rounded border border-slate-border-strong px-3 text-[12px] text-cw-muted transition-colors hover:bg-white/5 hover:text-cw-text"
          onclick={clearFilters}
        >
          Clear filters
        </button>
      {/if}
    </div>
  {:else}
    <!-- A focusable scrollable log region is required for keyboard-only operators. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={stream}
      class="min-h-[220px] flex-1 overflow-y-auto px-2 py-1.5 font-mono text-[11px] leading-relaxed"
      role="log"
      aria-label={label}
      tabindex="0"
      onscroll={onScroll}
    >
      {#each filtered as entry (entry.id)}
        <div
          data-testid="log-line"
          data-level={entry.level}
          class="flex gap-2 rounded px-2 py-[3px] transition-colors hover:bg-white/4"
        >
          <span class="tnum shrink-0 text-cw-faint">{formatLogTimestamp(entry.timestamp)}</span>
          <span class="w-12 shrink-0 font-semibold {LEVEL_TEXT_CLASS[entry.level]}">{entry.level}</span>
          <span class="hidden w-32 shrink-0 truncate text-cw-muted sm:inline">{entry.service}</span>
          <span class="min-w-0 flex-1 break-words text-cw-text">{entry.message}</span>
        </div>
      {/each}
    </div>

    {#if hiddenByLevel > 0}
      <div class="border-t border-slate-border px-3 py-1.5 font-mono text-[10px] text-cw-faint">
        {hiddenByLevel} {hiddenByLevel === 1 ? 'entry is' : 'entries are'} hidden by the active level filter
      </div>
    {/if}

    {#if !autoScroll}
      <div class="border-t border-slate-border px-3 py-2">
        <button
          type="button"
          data-testid="log-resume-follow"
          class="h-11 w-full rounded border border-cw-accent/45 bg-cw-accent/12 font-mono text-[11px] text-cw-accent transition-colors hover:bg-cw-accent/20"
          onclick={scrollToLatest}
        >
          Auto-follow paused — jump to latest
        </button>
      </div>
    {/if}
  {/if}
</div>
