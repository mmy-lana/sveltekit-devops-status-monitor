<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { monitorStore } from '$lib/stores/monitorStore.svelte';
  import Badge from '$lib/components/primitives/Badge.svelte';
  import Button from '$lib/components/primitives/Button.svelte';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  const NAV_ITEMS = [
    { href: '/', label: 'Fleet Dashboard', match: (path: string) => path === '/' },
    { href: '/alarms', label: 'Alarms', match: (path: string) => path.startsWith('/alarms') },
    { href: '/incidents', label: 'Incidents', match: (path: string) => path.startsWith('/incidents') }
  ] as const;

  const pathname = $derived(page.url.pathname);

  /** Trail derived from the route, with the instance name resolved when known. */
  const breadcrumb = $derived.by(() => {
    if (pathname === '/') return [{ label: 'Fleet Dashboard', href: '/' }];
    if (pathname === '/alarms') {
      return [
        { label: 'Fleet Dashboard', href: '/' },
        { label: 'Alarms', href: '/alarms' }
      ];
    }
    if (pathname === '/incidents') {
      return [
        { label: 'Fleet Dashboard', href: '/' },
        { label: 'Incidents', href: '/incidents' }
      ];
    }
    if (pathname.startsWith('/servers/')) {
      const id = decodeURIComponent(pathname.slice('/servers/'.length));
      const server = monitorStore.servers.find((item) => item.id === id);
      return [
        { label: 'Fleet Dashboard', href: '/' },
        { label: server?.name ?? id, href: pathname }
      ];
    }
    return [{ label: 'Fleet Dashboard', href: '/' }];
  });
  const summary = $derived(monitorStore.fleetSummary);
  const fleetTone = $derived(
    summary.criticalCount > 0 ? 'critical' : summary.warningCount > 0 ? 'warning' : 'healthy'
  );

  onMount(() => {
    void monitorStore.initialize();
  });
</script>

<div class="flex min-h-screen flex-col bg-slate-base font-sans text-cw-text">
  <header
    class="sticky top-0 z-40 border-b border-slate-border bg-slate-surface/95 backdrop-blur supports-[backdrop-filter]:bg-slate-surface/80"
  >
    <div class="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <a
        href="/"
        class="flex min-h-11 items-center gap-2.5 rounded pr-2 transition-colors hover:bg-white/5"
      >
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cw-accent/45 bg-cw-accent/12 font-mono text-[11px] font-bold text-cw-accent"
          aria-hidden="true"
          >CW</span
        >
        <span class="flex flex-col leading-tight">
          <span class="text-[13px] font-semibold tracking-tight text-cw-text">Status Monitor</span>
          <span class="font-mono text-[10px] text-cw-faint">CloudWatch Telemetry</span>
        </span>
      </a>

      <nav
        aria-label="Primary"
        class="order-3 -mx-1 w-full overflow-x-auto md:order-none md:mx-0 md:w-auto md:flex-1"
      >
        <ul class="scroll-strip md:justify-center">
          {#each NAV_ITEMS as item (item.href)}
            <li>
              <a
                href={item.href}
                aria-current={item.match(pathname) ? 'page' : undefined}
                class="flex h-11 items-center rounded px-3 text-[13px] font-medium transition-colors {item.match(
                  pathname
                )
                  ? 'bg-cw-accent/14 text-cw-accent ring-1 ring-inset ring-cw-accent/35'
                  : 'text-cw-muted hover:bg-white/5 hover:text-cw-text'}"
              >
                {item.label}
              </a>
            </li>
          {/each}
        </ul>
      </nav>

      <div class="ml-auto flex shrink-0 items-center gap-2">
        <div
          data-testid="fleet-status-pill"
          class="flex h-11 items-center gap-2 rounded border border-slate-border-strong bg-slate-base px-2.5"
        >
          <span
            class="inline-block h-2 w-2 shrink-0 rounded-full {fleetTone === 'critical'
              ? 'bg-cw-rose animate-pulse'
              : fleetTone === 'warning'
                ? 'bg-cw-amber'
                : 'bg-cw-emerald'}"
            aria-hidden="true"
          ></span>
          <span class="tnum font-mono text-[11px] text-cw-muted">
            {summary.healthyCount}/{summary.totalCount} Healthy
          </span>
        </div>

        {#if summary.activeAlarmsCount > 0}
          <a
            href="/alarms"
            data-testid="alarm-bell"
            class="flex h-11 shrink-0 items-center gap-1.5 rounded border border-cw-rose/45 bg-cw-rose/12 px-3 font-mono text-[11px] text-cw-rose transition-colors hover:bg-cw-rose/20"
          >
            <span class="sr-only">Active alarms:</span>
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path
                d="M8 1.4a4.1 4.1 0 0 0-4.1 4.1v2.3L2.6 9.8a.5.5 0 0 0 .44.75h9.92a.5.5 0 0 0 .44-.75L12.1 7.8V5.5A4.1 4.1 0 0 0 8 1.4Zm-1.8 10.2a1.9 1.9 0 0 0 3.6 0H6.2Z"
              />
            </svg>
            <span class="tnum font-semibold" data-testid="alarm-count">{summary.activeAlarmsCount}</span>
          </a>
        {/if}

        <Button
          variant="icon"
          size="sm"
          ariaLabel="Refresh telemetry now"
          title="Refresh telemetry now"
          onclick={() => void monitorStore.pollCycle()}
        >
          <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M14 8a6 6 0 1 1-1.76-4.24" stroke-linecap="round" />
            <path d="M14 1.5V5h-3.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </Button>
      </div>
    </div>
  </header>

  <nav aria-label="Breadcrumb" data-testid="breadcrumb" class="border-b border-slate-border bg-slate-base/60">
    <ol class="mx-auto flex w-full max-w-[1600px] items-center gap-1.5 overflow-x-auto px-4 py-2 md:px-6">
      {#each breadcrumb as crumb, index (crumb.href + crumb.label)}
        <li class="flex shrink-0 items-center gap-1.5">
          {#if index > 0}
            <svg
              viewBox="0 0 16 16"
              class="h-3 w-3 shrink-0 text-cw-faint"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m6 3 5 5-5 5" />
            </svg>
          {/if}
          {#if index === breadcrumb.length - 1}
            <span
              class="flex h-11 shrink-0 items-center px-1.5 text-[12px] font-medium text-cw-text"
              aria-current="page"
              data-testid="breadcrumb-current"
            >
              {crumb.label}
            </span>
          {:else}
            <a
              href={crumb.href}
              class="flex h-11 shrink-0 items-center rounded px-1.5 text-[12px] text-cw-muted transition-colors hover:bg-white/5 hover:text-cw-text"
            >
              {crumb.label}
            </a>
          {/if}
        </li>
      {/each}
    </ol>
  </nav>

  {#if monitorStore.isLoading}
    <div
      class="flex min-h-[50vh] items-center justify-center px-4"
      role="status"
      aria-live="polite"
      data-testid="boot-loading"
    >
      <div class="flex flex-col items-center gap-3">
        <span
          class="h-6 w-6 animate-spin rounded-full border-2 border-cw-accent border-r-transparent"
          aria-hidden="true"
        ></span>
        <p class="font-mono text-[11px] text-cw-muted">Hydrating IndexedDB telemetry store…</p>
      </div>
    </div>
  {:else}
    <main class="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 md:px-6 md:py-6">
      {@render children?.()}
    </main>
  {/if}

  <footer class="border-t border-slate-border bg-slate-surface/60 px-4 py-3">
    <div
      class="mx-auto flex w-full max-w-[1600px] flex-col items-start justify-between gap-1.5 font-mono text-[10px] text-cw-faint sm:flex-row sm:items-center"
    >
      <span>AWS CloudWatch infrastructure telemetry simulator</span>
      <span class="flex items-center gap-3">
        <Badge variant="neutral" size="sm" value="IndexedDB" label="IndexedDB engine active" dot />
        <span data-testid="footer-refresh">
          {monitorStore.isPaused
            ? 'Auto-refresh paused'
            : `Auto-refresh ${Math.round(monitorStore.autoRefreshInterval / 1000)}s`}
        </span>
      </span>
    </div>
  </footer>
</div>
