/**
 * Headless Chrome verification harness.
 *
 * Usage:
 *   node scripts/verify.mjs            # run every check up to the highest implemented phase
 *   node scripts/verify.mjs 3          # run checks for phases 1..3
 *   VERIFY_BASE_URL=http://127.0.0.1:5199 node scripts/verify.mjs
 *
 * The harness drives a real Chromium instance with Playwright. It never
 * interacts with, profiles, or attaches to any already-running browser.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:5199';
const maxPhase = Number.parseInt(process.argv[2] ?? '5', 10);
const SHOT_DIR = new URL('../.verify-artifacts/', import.meta.url).pathname;

/* ------------------------------------------------------------------ */
/* Tiny assertion runner                                               */
/* ------------------------------------------------------------------ */

const results = [];
let currentCheck = 'general';

function record(ok, message, detail) {
  results.push({ check: currentCheck, ok, message, detail });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${tag} ${message}${ok || detail === undefined ? '' : `\n       ${detail}`}`);
}

function assert(condition, message, detail) {
  record(Boolean(condition), message, condition ? undefined : detail);
}

function assertEqual(actual, expected, message) {
  assert(
    Object.is(actual, expected),
    message,
    Object.is(actual, expected) ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

/** Count elements that actually render, ignoring container-query hidden branches. */
async function countVisible(page, selector) {
  return page.evaluate((sel) => {
    let count = 0;
    for (const el of document.querySelectorAll(sel)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden') count += 1;
    }
    return count;
  }, selector);
}

/** Read the trimmed text of every visible match. */
async function textsOfVisible(page, selector) {
  return page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) out.push((el.textContent ?? '').trim());
    }
    return out;
  }, selector);
}

function section(title) {
  currentCheck = title;
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/* ------------------------------------------------------------------ */
/* Browser helpers                                                     */
/* ------------------------------------------------------------------ */

const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 780, isMobile: true, hasTouch: true },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'mobile-430', width: 430, height: 932, isMobile: true, hasTouch: true },
  { name: 'tablet-768', width: 768, height: 1024, isMobile: false, hasTouch: true },
  { name: 'desktop-1280', width: 1280, height: 900, isMobile: false, hasTouch: false },
  { name: 'desktop-1600', width: 1600, height: 1000, isMobile: false, hasTouch: false }
];

function attachDiagnostics(page, sink) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      sink.push(`[console.${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => sink.push(`[pageerror] ${error.message}`));
  page.on('requestfailed', (request) =>
    sink.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`)
  );

  // Vite surfaces compile/runtime failures in a shadow-DOM overlay that would
  // otherwise silently swallow later interactions.
  const poll = setInterval(async () => {
    try {
      const message = await page.evaluate(() => {
        const overlay = document.querySelector('vite-error-overlay');
        if (!overlay) return null;
        const root = overlay.shadowRoot;
        return (
          root?.querySelector('.message-body, .message')?.textContent?.replace(/\s+/g, ' ').trim() ??
          'vite error overlay present'
        );
      });
      if (message) sink.push(`[vite-overlay] ${message}`);
    } catch {
      /* page closed mid-poll */
    }
  }, 700);
  page.on('close', () => clearInterval(poll));
}

/**
 * Wait until the monitor store has finished its IndexedDB hydration: the shell
 * status pill must report a non-empty "healthy / total" ratio.
 */
async function waitForFleetReady(page) {
  await page.waitForFunction(
    () => {
      const pill = document.querySelector('[data-testid="fleet-status-pill"]');
      if (!pill) return false;
      const match = pill.textContent?.match(/(\d+)\s*\/\s*(\d+)\s*Healthy/);
      if (!match) return false;
      const healthy = Number(match[1]);
      const total = Number(match[2]);
      return total > 0 && healthy <= total;
    },
    undefined,
    { timeout: 30_000 }
  );
}

/** Detect elements whose content spills outside their own box. */
const OVERFLOW_PROBE = `() => {
  const offenders = [];
  const documentWidth = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right > documentWidth + 1.5 || rect.left < -1.5) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') ?? '').slice(0, 90),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        docWidth: documentWidth
      });
    }
  }
  return offenders.slice(0, 8);
}`;

/** Detect interactive targets smaller than the 44px minimum tap target. */
const TAP_TARGET_PROBE = `() => {
  const small = [];
  const selector = 'a[href], button, input, select, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(selector)) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.height < 44 || rect.width < 44) {
      small.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') ?? '').slice(0, 80),
        text: (el.textContent ?? '').trim().slice(0, 40),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      });
    }
  }
  return small.slice(0, 12);
}`;

/** Check that no text node is visually truncated by an ellipsis or clipping rule. */
const CLIPPING_PROBE = `() => {
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0) continue;
    const text = (el.textContent ?? '').trim();
    if (!text) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const overflowsHorizontally = el.scrollWidth > el.clientWidth + 1;
    const overflowsVertically = el.scrollHeight > el.clientHeight + 1;
    if (overflowsHorizontally || overflowsVertically) {
      clipped.push({
        text: text.slice(0, 50),
        cls: (el.getAttribute('class') ?? '').slice(0, 80),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight
      });
    }
  }
  return clipped.slice(0, 12);
}`;

/* ------------------------------------------------------------------ */
/* Phase 1 — types, storage, utilities                                 */
/* ------------------------------------------------------------------ */

async function checkPhase1(page) {
  section('Phase 1 · Storage & Utilities');

  const dbStats = await page.evaluate(async () => {
    const request = indexedDB.open('StatusMonitorDB');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = (store) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const all = (store) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    const names = Array.from(db.objectStoreNames);
    const [servers, telemetry, alarms, incidents, logs] = await Promise.all([
      count('servers'),
      count('telemetry'),
      count('alarms'),
      count('incidents'),
      count('logs')
    ]);

    const serverRows = await all('servers');
    const telemetryRows = await all('telemetry');
    const logRows = await all('logs');

    return {
      names,
      counts: { servers, telemetry, alarms, incidents, logs },
      serverRows,
      regions: [...new Set(serverRows.map((s) => s.region))].sort(),
      environments: [...new Set(serverRows.map((s) => s.environment))].sort(),
      statuses: [...new Set(serverRows.map((s) => s.status))].sort(),
      invalidNames: serverRows.filter((s) => !/^[a-zA-Z0-9-_]{3,64}$/.test(s.name)).map((s) => s.name),
      ipv4: /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
      invalidIps: serverRows.filter((s) => !/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(s.ipAddress))
        .map((s) => s.ipAddress),
      telemetryServerIds: [...new Set(telemetryRows.map((t) => t.serverId))].length,
      outOfRange: telemetryRows.filter(
        (t) =>
          t.metrics.cpuUsage < 0 ||
          t.metrics.cpuUsage > 100 ||
          t.metrics.memoryUsage < 0 ||
          t.metrics.memoryUsage > 100 ||
          t.metrics.diskUsage < 0 ||
          t.metrics.diskUsage > 100
      ).length,
      unsortedTimestamps: telemetryRows
        .filter((t) => !Number.isFinite(t.timestamp) || t.metrics.timestamp !== t.timestamp)
        .length,
      logLevels: [...new Set(logRows.map((l) => l.level))].sort()
    };
  });

  assertEqual(dbStats.names.length, 5, 'Dexie created all five object stores');
  assertEqual(dbStats.counts.servers, 12, 'Seed routine provisioned 12 server assets');
  assertEqual(dbStats.telemetryServerIds, 12, 'Telemetry backfill covers every server');
  assert(dbStats.counts.telemetry >= 3600, `Telemetry backfill populated ${dbStats.counts.telemetry} records (>= 3600)`);
  assert(dbStats.counts.alarms >= 6, `Alarm rules seeded (${dbStats.counts.alarms})`);
  assertEqual(dbStats.counts.incidents, 3, 'Incident seeds created with populated timelines');
  assert(dbStats.counts.logs >= 400, `Log history seeded (${dbStats.counts.logs} entries)`);
  assert(dbStats.regions.length >= 8, `Fleet spans ${dbStats.regions.length} AWS regions: ${dbStats.regions.join(', ')}`);
  assertEqual(dbStats.invalidNames.length, 0, 'Every asset name satisfies ^[a-zA-Z0-9-_]{3,64}$');
  assertEqual(dbStats.invalidIps.length, 0, 'Every asset IP address is a valid IPv4 literal');
  assertEqual(dbStats.outOfRange, 0, 'All utilisation samples are bounded to 0.00-100.00');
  assertEqual(dbStats.unsortedTimestamps, 0, 'Telemetry timestamps agree with the row index');
  assert(dbStats.environments.includes('production') && dbStats.environments.includes('staging'), `Environments seeded: ${dbStats.environments.join(', ')}`);
  assert(dbStats.statuses.includes('maintenance') && dbStats.statuses.includes('offline'), `Status variety seeded: ${dbStats.statuses.join(', ')}`);
  assert(dbStats.logLevels.includes('WARN') && dbStats.logLevels.includes('ERROR'), `Log levels seeded: ${dbStats.logLevels.join(', ')}`);

  const utils = await page.evaluate(async () => {
    const stats = await import('/src/lib/utils/statistics.ts');
    const alarms = await import('/src/lib/utils/alarmUtils.ts');
    const ids = await import('/src/lib/utils/id.ts');
    const fmt = await import('/src/lib/utils/formatting.ts');

    return {
      movingAverage: stats.calculateMovingAverage([1, 2, 3, 4, 5], 3),
      movingAverageEmpty: stats.calculateMovingAverage([], 5),
      movingAverageSingle: stats.calculateMovingAverage([7, 7], 1),
      percentile: stats.calculatePercentile([10, 20, 30, 40, 50], 95),
      percentileEmpty: stats.calculatePercentile([], 95),
      p95: stats.calculateP95([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]),
      stdDev: stats.calculateStdDev([2, 4, 4, 4, 5, 5, 7, 9]),
      stdDevSingle: stats.calculateStdDev([42]),
      stdDevKnown: stats.calculateStdDev([10, 10, 10, 10]),
      clamp: [stats.clamp(15, 0, 10), stats.clamp(-5, 0, 10), stats.clamp(Number.NaN, 3, 9)],
      gt: alarms.evaluateThreshold(90, 'GT', 85),
      gte: alarms.evaluateThreshold(85, 'GTE', 85),
      lt: alarms.evaluateThreshold(10, 'LT', 15),
      lte: alarms.evaluateThreshold(15, 'LTE', 15),
      eq: alarms.evaluateThreshold(85.00001, 'EQ', 85),
      neq: alarms.evaluateThreshold(85.5, 'EQ', 85),
      extract: alarms.extractMetricValue(
        { timestamp: 0, cpuUsage: 1, memoryUsage: 2, diskUsage: 3, networkInKbps: 4, networkOutKbps: 5, latencyMs: 6 },
        'networkOut'
      ),
      describe: alarms.describeThreshold({ metric: 'cpu', operator: 'GT', threshold: 85 }),
      severityHigh: alarms.deriveIncidentSeverity(120, 85, 'GT'),
      severityLow: alarms.deriveIncidentSeverity(90, 85, 'GT'),
      severityInverted: alarms.deriveIncidentSeverity(2, 85, 'LT'),
      idA: ids.generateEntityId('srv'),
      idB: ids.generateEntityId('srv'),
      slug: ids.slugifyAssetName(' Prod App #1 / Edge '),
      kbps: [fmt.formatBytes(450), fmt.formatBytes(4500), fmt.formatBytes(4_500_000)],
      duration: [fmt.formatDuration(45_000), fmt.formatDuration(720_000), fmt.formatDuration(9_000_000)],
      metricValue: [fmt.formatMetricValue(42.55, '%'), fmt.formatMetricValue(4500, 'Kbps'), fmt.formatMetricValue(12.5, 'ms')],
      ranges: fmt.TIME_RANGE_OPTIONS.map((r) => `${r.label}:${r.durationMs}`),
      relative: fmt.formatRelativeTime(Date.now() - 120_000),
      retention: fmt.RETENTION_MS
    };
  });

  assertEqual(
    JSON.stringify(utils.movingAverage),
    JSON.stringify([1, 1.5, 2, 3, 4]),
    'calculateMovingAverage applies a trailing 3-sample window'
  );
  assertEqual(JSON.stringify(utils.movingAverageEmpty), '[]', 'calculateMovingAverage([]) returns []');
  assertEqual(JSON.stringify(utils.movingAverageSingle), '[7,7]', 'calculateMovingAverage window <= 1 passes through');
  assertEqual(utils.percentile, 48, 'calculatePercentile interpolates linearly (P95 of 10..50 = 48)');
  assertEqual(utils.percentileEmpty, 0, 'calculatePercentile([]) returns 0');
  assertEqual(utils.p95, 59.05, 'calculateP95 interpolates between the two bracketing samples (9*0.45 + 100*0.55)');
  assertEqual(utils.stdDev, 2.14, 'calculateStdDev uses the n-1 denominator: sqrt(32/7) = 2.14 for 2,4,4,4,5,5,7,9');
  assertEqual(utils.stdDevSingle, 0, 'calculateStdDev of a single sample is 0');
  assertEqual(utils.stdDevKnown, 0, 'calculateStdDev applies Bessel correction (constant series -> 0)');
  assertEqual(JSON.stringify(utils.clamp), '[10,0,3]', 'clamp bounds and maps NaN to min');
  assert(utils.gt && utils.gte && utils.lt && utils.lte && utils.eq && !utils.neq, 'evaluateThreshold honours all five comparison operators');
  assertEqual(utils.extract, 5, 'extractMetricValue reads the requested channel');
  assertEqual(utils.describe, 'CPU > 85.00%', 'describeThreshold renders a readable condition');
  assertEqual(utils.severityHigh, 'SEV-1', 'deriveIncidentSeverity escalates breaches beyond 125%');
  assertEqual(utils.severityLow, 'SEV-2', 'deriveIncidentSeverity maps moderate breaches to SEV-2');
  assertEqual(utils.severityInverted, 'SEV-3', 'deriveIncidentSeverity handles inverted operators');
  assert(utils.idA.startsWith('srv-') && utils.idA !== utils.idB, 'generateEntityId is prefixed and unique');
  assertEqual(utils.slug, 'Prod-App-1-Edge', 'slugifyAssetName strips unsafe characters');
  assertEqual(JSON.stringify(utils.kbps), '["450 Kbps","4.5 Mbps","4.50 Gbps"]', 'formatBytes scales Kbps/Mbps/Gbps');
  assertEqual(JSON.stringify(utils.duration), '["45s","12m","2h 30m"]', 'formatDuration compacts elapsed time');
  assertEqual(JSON.stringify(utils.metricValue), '["42.5%","4.5 Mbps","12.5ms"]', 'formatMetricValue respects metric units');
  assertEqual(utils.ranges.length, 6, 'TIME_RANGE_OPTIONS exposes all six ranges');
  assertEqual(utils.ranges[0], '1h:3600000', 'TIME_RANGE_OPTIONS maps 1h to 3_600_000ms');
  assertEqual(utils.ranges[5], '7d:604800000', 'TIME_RANGE_OPTIONS maps 7d to 7 days');
  assertEqual(utils.relative, '2m ago', 'formatRelativeTime renders coarse relative labels');
  assertEqual(utils.retention, 604800000, 'RETENTION_MS pins the 7 day telemetry window');
}

/* ------------------------------------------------------------------ */
/* Phase 2 — design tokens & primitives                                */
/* ------------------------------------------------------------------ */

async function checkPhase2(page) {
  section('Phase 2 · Design Foundation & Primitives');

  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const readToken = (token) => styles.getPropertyValue(token).trim();

    /** Resolve a single utility class in isolation so nothing else can win. */
    const probeOne = (utility, property) => {
      const probe = document.createElement('div');
      probe.className = utility;
      document.body.appendChild(probe);
      const computed = getComputedStyle(probe);
      const value =
        property === 'backgroundColor'
          ? computed.backgroundColor
          : property === 'color'
            ? computed.color
            : property === 'fontFamily'
              ? computed.fontFamily
              : computed.borderTopColor;
      probe.remove();
      return value;
    };

    return {
      base: readToken('--color-slate-base'),
      surface: readToken('--color-slate-surface'),
      card: readToken('--color-slate-card'),
      accent: readToken('--color-cw-accent'),
      blue: readToken('--color-cw-blue'),
      amber: readToken('--color-cw-amber'),
      emerald: readToken('--color-cw-emerald'),
      rose: readToken('--color-cw-rose'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      accentBg: probeOne('bg-cw-accent', 'backgroundColor'),
      blueFg: probeOne('text-cw-blue', 'color'),
      amberFg: probeOne('text-cw-amber', 'color'),
      roseBorder: probeOne('border-cw-rose', 'borderColor'),
      emeraldBg: probeOne('bg-cw-emerald', 'backgroundColor'),
      cardBg: probeOne('bg-slate-card', 'backgroundColor'),
      monoFamily: probeOne('font-mono', 'fontFamily')
    };
  });

  assertEqual(tokens.base, '#0b0f17', 'Theme token --color-slate-base is #0b0f17');
  assertEqual(tokens.surface, '#111827', 'Theme token --color-slate-surface is #111827');
  assertEqual(tokens.card, '#161f30', 'Theme token --color-slate-card is #161f30');
  assertEqual(tokens.accent, '#ec7211', 'Theme token --color-cw-accent is the CloudWatch orange #ec7211');
  assertEqual(tokens.blue, '#38bdf8', 'Theme token --color-cw-blue is #38bdf8');
  assertEqual(tokens.amber, '#f59e0b', 'Theme token --color-cw-amber is #f59e0b');
  assertEqual(tokens.emerald, '#10b981', 'Theme token --color-cw-emerald is #10b981');
  assertEqual(tokens.rose, '#ef4444', 'Theme token --color-cw-rose is #ef4444');
  assertEqual(tokens.accentBg, 'rgb(236, 114, 17)', `bg-cw-accent utility compiles (${tokens.accentBg})`);
  assertEqual(tokens.blueFg, 'rgb(56, 189, 248)', `text-cw-blue utility compiles (${tokens.blueFg})`);
  assertEqual(tokens.amberFg, 'rgb(245, 158, 11)', `text-cw-amber utility compiles (${tokens.amberFg})`);
  assertEqual(tokens.roseBorder, 'rgb(239, 68, 68)', `border-cw-rose utility compiles (${tokens.roseBorder})`);
  assertEqual(tokens.emeraldBg, 'rgb(16, 185, 129)', `bg-cw-emerald utility compiles (${tokens.emeraldBg})`);
  assertEqual(tokens.cardBg, 'rgb(22, 31, 48)', `bg-slate-card utility compiles (${tokens.cardBg})`);
  assert(tokens.monoFamily.includes('monospace'), `font-mono utility compiles (${tokens.monoFamily})`);
  assertEqual(tokens.bodyBg, 'rgb(11, 15, 23)', `Body paints the Clean Slate base colour (${tokens.bodyBg})`);

  // ---- Badge tone mapping -----------------------------------------------
  const badgeMap = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="table-row"]'));
    const byName = new Map();
    for (const row of rows) {
      const name = row.querySelector('[data-testid="server-row-link"]')?.textContent?.trim() ?? '';
      const badge = row.querySelector('[data-testid="badge"][data-variant="status"]');
      byName.set(name, badge?.getAttribute('data-tone') ?? null);
    }
    return Object.fromEntries(byName);
  });
  assertEqual(badgeMap['prod-use1-api-gw-01'], 'emerald', 'Badge maps a healthy server to the emerald tone');
  assertEqual(badgeMap['prod-usw2-k8s-worker-01'], 'amber', 'Badge maps a warning server to the amber tone');
  assertEqual(badgeMap['dev-sae1-edge-sim-01'], 'slate', 'Badge maps an offline server to the slate tone');

  const badgeLabel = await page.evaluate(() => {
    const badge = document.querySelector('[data-testid="badge"][data-variant="environment"]');
    return { label: badge?.getAttribute('aria-label') ?? null, text: badge?.textContent?.trim() ?? null };
  });
  assert(
    badgeLabel.label?.startsWith('Environment:'),
    `Badge prefixes the accessible name with its vocabulary (${badgeLabel.label})`
  );

  // ---- Button tap targets -----------------------------------------------
  const buttons = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-testid="button"], [data-testid="filter-reset"]')
    ).map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-testid'),
        variant: el.getAttribute('data-variant') ?? 'ghost',
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      };
    })
  );
  assert(buttons.length >= 2, `Dashboard renders ${buttons.length} Button primitives across the shell and toolbar`);
  assert(
    buttons.every((b) => b.w >= 44 && b.h >= 44),
    'Every Button clears the 44x44 minimum tap target',
    JSON.stringify(buttons)
  );

  // ---- Card slots ---------------------------------------------------------
  const card = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="card"]');
    return {
      hasTitle: Boolean(section?.querySelector('[data-testid="card-title"]')),
      hasToolbar: Boolean(section?.querySelector('[data-testid="card-body"]')),
      border: getComputedStyle(section).borderTopWidth
    };
  });
  assert(card.hasTitle, 'Card renders its header title slot');
  assert(card.border === '1px', `Card paints the 1px CloudWatch panel border (${card.border})`);

  // ---- ProgressBar threshold colour shift ---------------------------------
  const bars = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="progress-bar"]')).map((el) => ({
      tone: el.getAttribute('data-tone'),
      value: Number(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')),
      role: el.querySelector('[role="progressbar"]')?.getAttribute('role'),
      max: el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')
    }))
  );
  assert(bars.length >= 2, `ProgressBar rendered ${bars.length} instances`);
  assert(bars.every((b) => b.role === 'progressbar' && b.max === '100'), 'ProgressBar exposes an ARIA progressbar role with a 0-100 range');
  assert(
    bars.every((b) => {
      const expected = b.value >= 90 ? 'rose' : b.value >= 75 ? 'amber' : 'emerald';
      return b.tone === expected;
    }),
    'ProgressBar shifts emerald -> amber -> rose at the 75% and 90% thresholds',
    JSON.stringify(bars)
  );

  // ---- Container-query table ---------------------------------------------
  const atDesktop = await page.evaluate(() => ({
    grid: getComputedStyle(document.querySelector('[data-testid="table-grid-wrapper"]')).display,
    cards: getComputedStyle(document.querySelector('[data-testid="table-cards"]')).display,
    rows: document.querySelectorAll('[data-testid="table-row"]').length
  }));
  assertEqual(atDesktop.grid, 'block', 'Above 768px the Table renders the multi-column grid');
  assertEqual(atDesktop.cards, 'none', 'Above 768px the Table hides the stacked card view');
  assertEqual(atDesktop.rows, 12, 'The grid renders all 12 fleet rows');

  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(300);
  const atMobile = await page.evaluate(() => ({
    grid: getComputedStyle(document.querySelector('[data-testid="table-grid-wrapper"]')).display,
    cards: getComputedStyle(document.querySelector('[data-testid="table-cards"]')).display,
    cards_: document.querySelectorAll('[data-testid="table-card"]').length
  }));
  assertEqual(atMobile.grid, 'none', 'Below 768px the Table hides the multi-column grid');
  assertEqual(atMobile.cards, 'flex', 'Below 768px the Table renders the stacked card view');
  assertEqual(atMobile.cards_, 12, 'The stacked view renders one card per fleet row');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);

  // ---- Input accessibility -----------------------------------------------
  const input = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="server-search"]');
    if (!el) return null;
    const label = document.querySelector(`label[for="${el.id}"]`);
    return { type: el.getAttribute('type'), label: label?.textContent?.trim() ?? null, describedBy: el.getAttribute('aria-describedby') };
  });
  assertEqual(input?.type, 'search', 'Input renders a native search field');
  assertEqual(input?.label, 'Search instances', 'Input is programmatically associated with its visible label');

  // ---- Select -------------------------------------------------------------
  const select = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="region-filter"]');
    if (!el) return null;
    const label = document.querySelector(`label[for="${el.id}"]`);
    return {
      options: Array.from(el.options).map((o) => o.value),
      label: label?.textContent?.trim() ?? null
    };
  });
  assertEqual(select?.label, 'Region', 'Select is programmatically associated with its visible label');
  assertEqual(select?.options[0], 'all', 'Select exposes the "all regions" sentinel option first');
  assertEqual(select?.options.length, 10, `Select lists all 9 regions plus the sentinel (${select?.options.length})`);

  // ---- Tooltip ------------------------------------------------------------
  const trigger = page.locator('[data-testid="tooltip-trigger"]').first();
  assert((await trigger.count()) > 0, 'Tooltip trigger is rendered in the summary grid');
  await trigger.click();
  await page.waitForTimeout(200);
  const tooltip = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="tooltip"]');
    const triggerEl = document.querySelector('[data-testid="tooltip-trigger"]');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      role: el.getAttribute('role'),
      describedBy: triggerEl?.getAttribute('aria-describedby'),
      expanded: triggerEl?.getAttribute('aria-expanded'),
      insideViewport: rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0,
      placement: el.getAttribute('data-placement')
    };
  });
  assertEqual(tooltip?.role, 'tooltip', 'Tooltip renders with role="tooltip" on activation');
  assert(tooltip?.expanded === 'true', 'Tooltip trigger reports aria-expanded="true" while open');
  assert(Boolean(tooltip?.describedBy) && tooltip.describedBy !== 'null', 'Tooltip trigger links the bubble with aria-describedby');
  assert(tooltip?.insideViewport === true, 'Tooltip bubble stays inside the viewport bounds');
  assert(tooltip?.placement === 'top', `Tooltip auto-flips above the trigger when there is room (${tooltip?.placement})`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assertEqual(
    await page.locator('[data-testid="tooltip"]').count(),
    0,
    'Tooltip dismisses on the Escape key'
  );

  // ---- Empty state --------------------------------------------------------
  await page.locator('[data-testid="server-search"]').fill('zzzz-no-such-instance');
  await page.waitForTimeout(250);
  const emptyState = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="table-empty"]');
    return { present: Boolean(el), text: el?.textContent?.replace(/\s+/g, ' ').trim() ?? null };
  });
  assert(emptyState.present, 'Table renders an explicit empty state when nothing matches');
  assert(
    emptyState.text?.includes('No instances match the active filters'),
    `Empty state explains the situation and the remedy (${emptyState.text})`
  );
  await page.locator('[data-testid="server-search"]').fill('');
  await page.waitForTimeout(250);

  // ---- Reset button state -------------------------------------------------
  const resetDisabled = await page
    .locator('[data-testid="filter-reset"]')
    .evaluate((el) => el.disabled);
  assertEqual(resetDisabled, true, 'Reset button is disabled while no filter is active');
  await page.locator('[data-testid="server-search"]').fill('postgres');
  await page.waitForTimeout(200);
  const resetEnabled = await page
    .locator('[data-testid="filter-reset"]')
    .evaluate((el) => !el.disabled);
  assertEqual(resetEnabled, true, 'Reset button enables once a filter is active');
  await page.locator('[data-testid="filter-reset"]').click();
  await page.waitForTimeout(250);
  assertEqual(
    await countVisible(page, '[data-testid="server-row-name"]'),
    12,
    'Reset restores the full fleet'
  );
}

/* ------------------------------------------------------------------ */
/* Phase 3 — compound molecules                                        */
/* ------------------------------------------------------------------ */

async function checkPhase3(page) {
  section('Phase 3 · Compound Molecules');

  await page.goto(`${BASE_URL}/servers/srv-use1-api-01`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  await page.waitForSelector('[data-testid="metric-chart"], [data-testid="chart-loading"]', {
    timeout: 20_000
  });
  await page.waitForTimeout(1200);

  const chart = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="metric-chart"]');
    if (!svg) return { found: false };
    const verticalAxisTexts = svg.querySelectorAll('text[data-axis="y-left"], text[data-axis="y-right"]');
    return {
      found: true,
      series: svg.querySelectorAll('polyline[data-series]').length,
      areas: svg.querySelectorAll('path[data-area]').length,
      leftAxis: svg.querySelectorAll('text[data-axis="y-left"]').length,
      rightAxis: svg.querySelectorAll('text[data-axis="y-right"]').length,
      grid: svg.querySelectorAll('line[data-grid]').length,
      maxAxisFont: Math.max(
        0,
        ...Array.from(verticalAxisTexts).map((t) => Number.parseFloat(getComputedStyle(t).fontSize))
      ),
      width: Math.round(svg.getBoundingClientRect().width)
    };
  });

  assert(chart.found, 'MetricChart renders a [data-testid="metric-chart"] SVG');
  if (chart.found) {
    assertEqual(chart.series, 2, 'MetricChart draws both series as polylines');
    assertEqual(chart.areas, 2, 'MetricChart fills an area under each series');
    assert(
      chart.leftAxis >= 4 && chart.rightAxis >= 4,
      `MetricChart labels both Y axes (left:${chart.leftAxis} right:${chart.rightAxis})`
    );
    assert(chart.grid >= 3, `MetricChart draws horizontal gridlines (${chart.grid})`);
    assert(chart.maxAxisFont <= 10, `Axis type never exceeds 10px (${chart.maxAxisFont}px)`);
    assert(chart.width > 200, `MetricChart fills its container (${chart.width}px wide)`);

    const box = await page.locator('[data-testid="metric-chart"]').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.waitForTimeout(250);
      assert(
        (await page.locator('[data-testid="chart-readout"]').count()) > 0,
        'MetricChart exposes a scrub readout on pointer interaction'
      );
      assert(
        (await page.locator('[data-testid="chart-scrubber"]').count()) > 0,
        'MetricChart renders a scrub handle during interaction'
      );

      const geometry = await page.evaluate(() => {
        const bubble = document.querySelector('[data-testid="chart-readout"]');
        const svg = document.querySelector('[data-testid="metric-chart"]');
        if (!bubble || !svg) return null;
        const b = bubble.getBoundingClientRect();
        const s = svg.getBoundingClientRect();
        return { b, s };
      });
      if (geometry) {
        assert(
          geometry.b.bottom <= geometry.s.bottom,
          'Chart readout stays inside the plot rather than spilling below it'
        );
        assert(
          geometry.b.right <= geometry.s.right + 1 && geometry.b.left >= geometry.s.left - 1,
          'Chart readout is clamped inside the plot bounds'
        );
      }

      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
      await page.waitForTimeout(200);
      assert(
        (await page.locator('[data-testid="chart-readout"]').count()) > 0,
        'Scrub readout follows the pointer across the plot'
      );
      await page.mouse.move(4, 4);
      await page.waitForTimeout(200);
    }
  }

  const tabCount = await page.locator('[data-testid="metric-tab"]').count();
  assertEqual(tabCount, 4, 'Server detail exposes four metric tabs');
  if (tabCount === 4) {
    await page.locator('[data-testid="metric-tab"]').nth(3).click();
    await page.waitForTimeout(1000);
    const selected = await page
      .locator('[data-testid="metric-tab"]')
      .nth(3)
      .getAttribute('aria-selected');
    assertEqual(selected, 'true', 'Metric tabs update aria-selected on activation');
    assert(
      (await page.locator('[data-testid="metric-chart"]').count()) > 0,
      'Switching metric tabs re-renders the chart'
    );
  }

  const timeRangeButtons = await page.locator('[data-testid="time-range-selector"] button').count();
  assertEqual(timeRangeButtons, 6, 'TimeRangeSelector renders all six range buttons');
  if (timeRangeButtons === 6) {
    await page.locator('[data-testid="time-range-7d"]').click();
    await page.waitForTimeout(1000);
    assertEqual(
      await page.locator('[data-testid="time-range-7d"]').getAttribute('aria-pressed'),
      'true',
      'TimeRangeSelector marks the chosen range as pressed'
    );
    assert(
      (await page.locator('[data-testid="metric-chart"]').count()) > 0,
      'Switching to the 7d range re-renders the chart'
    );
    await page.locator('[data-testid="time-range-1h"]').click();
    await page.waitForTimeout(700);
  }

  const refreshOptions = await page.locator('[data-testid="refresh-rate-dropdown"] option').count();
  assertEqual(refreshOptions, 5, 'RefreshRateDropdown offers 5s, 15s, 30s, 60s and Paused');

  await page.locator('[data-testid="refresh-rate-select"]').selectOption('0');
  await page.waitForTimeout(300);
  const paused = await page.locator('[data-testid="footer-refresh"]').textContent();
  assert(paused?.includes('paused'), `Selecting 0ms pauses the poll loop (${paused?.trim()})`);
  await page.locator('[data-testid="refresh-rate-select"]').selectOption('15000');
  await page.waitForTimeout(300);
  const resumed = await page.locator('[data-testid="footer-refresh"]').textContent();
  assert(resumed?.includes('15s'), `Resuming restores the 15s cadence (${resumed?.trim()})`);

  const logConsole = await page.locator('[data-testid="log-console"]').count();
  assert(logConsole > 0, 'LogConsole is mounted on the server detail route');
  if (logConsole > 0) {
    await page
      .waitForFunction(() => document.querySelectorAll('[data-testid="log-line"]').length > 0, undefined, {
        timeout: 20_000
      })
      .catch(() => undefined);
    assert((await page.locator('[data-testid="log-line"]').count()) > 0, 'LogConsole renders persisted log lines');
    assertEqual(
      await page.locator('[data-testid="log-level-WARN"]').getAttribute('aria-pressed'),
      'true',
      'WARN level chip starts active'
    );

    await page.locator('[data-testid="log-level-INFO"]').click();
    await page.waitForTimeout(300);
    const levels = await page.evaluate(() => [
      ...new Set(
        Array.from(document.querySelectorAll('[data-testid="log-line"]')).map((el) =>
          el.getAttribute('data-level')
        )
      )
    ]);
    assert(!levels.includes('INFO'), `Toggling INFO off removes those lines (${levels.join(', ')})`);
    await page.locator('[data-testid="log-level-INFO"]').click();
    await page.waitForTimeout(300);

    await page.locator('[data-testid="log-search"]').fill('Telemetry|cache');
    await page.waitForTimeout(350);
    assert(
      (await page.locator('[data-testid="log-line"]').count()) > 0,
      'LogConsole accepts a regular expression alternation query'
    );

    await page.locator('[data-testid="log-search"]').fill('(unclosed');
    await page.waitForTimeout(300);
    assert(
      (await page.locator('[data-testid="log-search-error"]').count()) > 0,
      'LogConsole surfaces an explicit error for an invalid regular expression'
    );

    await page.locator('[data-testid="log-search"]').fill('zzzz-no-match-zzzz');
    await page.waitForTimeout(300);
    assertEqual(
      await page.locator('[data-testid="log-line"]').count(),
      0,
      'LogConsole filters every line out when nothing matches'
    );
    assert(
      (await page.locator('[data-testid="log-empty"]').count()) > 0,
      'LogConsole shows an explicit empty state for a non-matching query'
    );
    assert(
      (await page.locator('[data-testid="log-empty-reset"]').count()) > 0,
      'LogConsole empty state offers a way out'
    );
    await page.locator('[data-testid="log-empty-reset"]').click();
    await page.waitForTimeout(300);
    assert(
      (await page.locator('[data-testid="log-line"]').count()) > 0,
      'Clearing the LogConsole filters restores the stream'
    );
  }

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  await page.waitForTimeout(700);
  const sparklines = await page.locator('[data-testid="sparkline"]').count();
  assert(sparklines > 0, `Server table renders inline Sparklines (${sparklines} found)`);

  const sparklineBox =
    sparklines > 0 ? await page.locator('[data-testid="sparkline"]').first().boundingBox() : null;
  if (sparklineBox) {
    assert(
      sparklineBox.width >= 70 &&
        sparklineBox.width <= 96 &&
        sparklineBox.height >= 20 &&
        sparklineBox.height <= 30,
      `Sparkline renders at the 80x24 spec (${Math.round(sparklineBox.width)}x${Math.round(sparklineBox.height)})`
    );
  }

  const toolbar = await page.locator('[data-testid="filter-toolbar"]').count();
  assert(toolbar > 0, 'FilterSearchToolbar is mounted on the dashboard');
  if (toolbar > 0) {
    const criticalCount = await page
      .locator('[data-testid="status-count-critical"]')
      .textContent();
    assert(
      /^\d+$/.test((criticalCount ?? '').trim()),
      `Status pills report live numeric counts (critical = ${criticalCount?.trim()})`
    );
    await page.locator('[data-testid="status-filter-warning"]').click();
    await page.waitForTimeout(350);
    assertEqual(
      await page.locator('[data-testid="status-filter-warning"]').getAttribute('aria-pressed'),
      'true',
      'Status pills expose their pressed state'
    );
    await page.locator('[data-testid="filter-reset"]').click();
    await page.waitForTimeout(300);
    assertEqual(
      await countVisible(page, '[data-testid="server-row-name"]'),
      12,
      'Resetting the toolbar restores the full fleet'
    );
  }
}

/* ------------------------------------------------------------------ */
/* Phase 4 — engine, stores, domain components                        */
/* ------------------------------------------------------------------ */

async function checkPhase4(page) {
  section('Phase 4 · Engine & Reactive State');

  /* ---- alarm evaluation semantics (pure engine, run in-browser) ---- */
  const engine = await page.evaluate(async () => {
    const engine = await import('/src/lib/engine/alarmEvaluator.ts');
    const base = {
      id: 'r1',
      serverId: 'srv-a',
      name: 'CPU high',
      metric: 'cpu',
      operator: 'GT',
      threshold: 90,
      evaluationPeriods: 2,
      periodSeconds: 10,
      state: 'OK',
      enabled: true,
      consecutiveBreaches: 0,
      lastEvaluatedAt: 0,
      lastStateChangeAt: 0,
      createdAt: 0
    };
    const sample = (cpu) => ({
      timestamp: 1,
      cpuUsage: cpu,
      memoryUsage: 40,
      diskUsage: 40,
      networkInKbps: 100,
      networkOutKbps: 100,
      latencyMs: 10
    });

    const one = engine.evaluateRule(base, sample(95), 1000);
    const two = engine.evaluateRule(one.rule, sample(96), 2000);
    const recovered = engine.evaluateRule(two.rule, sample(20), 3000);

    const batch = engine.evaluateRules([base, { ...base, id: 'r2', serverId: 'srv-b' }], 'srv-a', sample(95), 1000);
    const disabled = engine.evaluateRule({ ...base, enabled: false }, sample(99), 1000);
    const fleet = engine.evaluateRules([{ ...base, serverId: 'all' }], 'srv-zzz', sample(10), 1000);

    const incident = engine.incidentFromAlarm(base, {
      id: 'srv-a',
      name: 'api-01',
      hostname: 'api-01',
      ipAddress: '10.0.0.1',
      region: 'us-east-1',
      availabilityZone: 'us-east-1a',
      environment: 'production',
      status: 'critical',
      tags: {},
      specs: { cpuCores: 2, memoryGb: 4, diskGb: 20, architecture: 'x86_64' },
      lastHeartbeat: 0,
      createdAt: 0,
      updatedAt: 0
    }, 'srv-a', 130, 1000);

    const resolved = {
      ...incident,
      resolvedAt: incident.startedAt + 900_000
    };

    return {
      singleBreachState: one.rule.state,
      singleBreachStreak: one.rule.consecutiveBreaches,
      singleTriggered: one.triggered,
      doubleState: two.rule.state,
      doubleTriggered: two.triggered,
      doubleStateChanged: two.stateChanged,
      recoveredState: recovered.rule.state,
      recoveredStreak: recovered.rule.consecutiveBreaches,
      recoveredLastChange: recovered.rule.lastStateChangeAt,
      lastEvaluatedMoves: recovered.rule.lastEvaluatedAt,
      immutable: one.rule !== base && base.consecutiveBreaches === 0,
      batchEvaluated: batch.evaluations.length,
      batchTriggered: batch.triggered.length,
      disabledEvaluated: disabled.evaluations === undefined ? 0 : disabled.rule.state,
      fleetScopeApplied: fleet.evaluations.length,
      incidentSeverity: incident.severity,
      incidentStatus: incident.status,
      incidentTimeline: incident.timeline.length,
      incidentAuthor: incident.timeline[0]?.author,
      mttr: engine.meanTimeToResolve([resolved, incident]),
      mttrEmpty: engine.meanTimeToResolve([incident]),
      nextStatuses: engine.nextIncidentStatuses('open'),
      terminal: engine.isTerminalStatus('resolved'),
      badThreshold: engine.validateThreshold('cpu', 150),
      okThreshold: engine.validateThreshold('cpu', 85)
    };
  });

  assertEqual(engine.singleBreachState, 'OK', 'A single breaching period does not latch the rule into ALARM');
  assertEqual(engine.singleBreachStreak, 1, 'The breach streak counter increments per breaching period');
  assertEqual(engine.singleTriggered, false, 'A rule below its evaluation window does not trigger an incident');
  assertEqual(engine.doubleState, 'ALARM', 'Reaching evaluationPeriods latches the rule into ALARM');
  assertEqual(engine.doubleTriggered, true, 'Latching reports the transition so an incident can be opened');
  assertEqual(engine.doubleStateChanged, true, 'The evaluator reports that the state changed');
  assertEqual(engine.recoveredState, 'OK', 'A non-breaching period clears the rule back to OK');
  assertEqual(engine.recoveredStreak, 0, 'The breach streak resets once the metric recovers');
  assertEqual(engine.recoveredLastChange, 3000, 'lastStateChangeAt only moves on an actual transition');
  assertEqual(engine.lastEvaluatedMoves, 3000, 'lastEvaluatedAt advances on every evaluation');
  assertEqual(engine.immutable, true, 'evaluateRule returns a new object and never mutates the input rule');
  assertEqual(engine.batchEvaluated, 1, 'Batch evaluation skips rules bound to a different host');
  assertEqual(engine.fleetScopeApplied, 1, 'Fleet-scoped rules are evaluated against every host');
  assertEqual(engine.incidentSeverity, 'SEV-1', 'Breaches beyond 125% of threshold open a SEV-1 incident');
  assertEqual(engine.incidentStatus, 'open', 'A newly opened incident starts in the open state');
  assertEqual(engine.incidentTimeline, 1, 'The new incident timeline starts with the detection event');
  assertEqual(engine.incidentAuthor, 'Automated Monitor', 'The detection event is attributed to the automated monitor');
  assertEqual(
    engine.mttr,
    900000,
    'Mean time to resolve averages only the incidents that were resolved, ignoring the unresolved one'
  );
  assertEqual(engine.mttrEmpty, null, 'Mean time to resolve is null when nothing has been resolved');
  assertEqual(
    JSON.stringify(engine.nextStatuses),
    JSON.stringify(['investigating', 'mitigated', 'resolved']),
    'Only forward lifecycle transitions are offered'
  );
  assertEqual(engine.terminal, true, 'resolved is a terminal incident status');
  assertEqual(engine.badThreshold, 'Percentage metrics cannot exceed 100', 'Threshold validation rejects impossible percentages');
  assertEqual(engine.okThreshold, null, 'Threshold validation accepts a sane percentage');

  /* ---- live store behaviour on the fleet table ---- */
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  await page.waitForTimeout(400);

  // Scope to an online host: drained and powered-down instances never report.
  const onlineRow = page.locator('[data-testid="table-row"]', { hasText: 'prod-use1-api-gw-01' });
  const cpuCell = onlineRow.locator('[data-testid="cpu-value"]').first();
  const before = ((await cpuCell.textContent()) ?? '').trim();
  await page.evaluate(() => document.querySelector('[aria-label="Refresh telemetry now"]')?.click());
  const changed = await page
    .waitForFunction(
      (previous) => {
        const row = Array.from(document.querySelectorAll('[data-testid="table-row"]')).find((r) =>
          r.textContent?.includes('prod-use1-api-gw-01')
        );
        const cell = row?.querySelector('[data-testid="cpu-value"]');
        return Boolean(cell) && cell.textContent?.trim() !== previous;
      },
      before,
      { timeout: 10_000 }
    )
    .then(() => true)
    .catch(() => false);
  const after = ((await cpuCell.textContent()) ?? '').trim();
  assert(changed, `A manual poll cycle produces a new CPU sample (${before} -> ${after})`);

  const offlineRow = page.locator('[data-testid="table-row"]', { hasText: 'dev-sae1-edge-sim-01' });
  const offlineCpu = await offlineRow.locator('[data-testid="cpu-value"]').first().textContent();
  await page.evaluate(() => document.querySelector('[aria-label="Refresh telemetry now"]')?.click());
  await page.waitForTimeout(1200);
  assertEqual(
    await offlineRow.locator('[data-testid="cpu-value"]').first().textContent(),
    offlineCpu,
    'Offline and maintenance instances are excluded from the telemetry loop'
  );

  // Filtering
  await page.locator('[data-testid="server-search"]').fill('postgres');
  await page.waitForTimeout(300);
  const names = await textsOfVisible(page, '[data-testid="server-row-name"]');
  assertEqual(names.length, 1, 'Search narrows the grid to a single matching instance');
  assert(names[0]?.includes('postgres'), `The search match is the expected instance (${names.join(', ')})`);
  await page.locator('[data-testid="server-search"]').fill('');
  await page.waitForTimeout(250);

  await page.locator('[data-testid="status-filter-maintenance"]').click();
  await page.waitForTimeout(300);
  const statuses = await textsOfVisible(page, '[data-testid="server-row-status"]');
  assert(
    statuses.length > 0 && statuses.every((s) => s.trim().toLowerCase().includes('maintenance')),
    `Status pill filter returns only maintenance rows (${statuses.join(', ') || 'none'})`
  );
  await page.locator('[data-testid="status-filter-offline"]').click();
  await page.waitForTimeout(300);
  const offline = await textsOfVisible(page, '[data-testid="server-row-status"]');
  assert(
    offline.length > 0 && offline.every((s) => s.trim().toLowerCase().includes('offline')),
    `Status pill filter returns only offline rows (${offline.join(', ') || 'none'})`
  );
  await page.locator('[data-testid="filter-reset"]').click();
  await page.waitForTimeout(300);
  assertEqual(
    await countVisible(page, '[data-testid="server-row-name"]'),
    12,
    'Resetting the status filter restores all 12 rows'
  );

  // Sorting
  await page.locator('[data-testid="sort-select"]').selectOption('cpu');
  await page.waitForTimeout(400);
  const cpuValues = await textsOfVisible(page, '[data-testid="cpu-value"]');
  const parsed = cpuValues.map((v) => Number.parseFloat(v)).filter((n) => Number.isFinite(n));
  assertEqual(
    JSON.stringify(parsed),
    JSON.stringify([...parsed].sort((a, b) => b - a)),
    'Selecting the CPU sort column produces a monotonically non-increasing column'
  );

  await page.locator('[data-testid="sort-direction"]').click();
  await page.waitForTimeout(400);
  const ascValues = (await textsOfVisible(page, '[data-testid="cpu-value"]'))
    .map((v) => Number.parseFloat(v))
    .filter((n) => Number.isFinite(n));
  assertEqual(
    JSON.stringify(ascValues),
    JSON.stringify([...ascValues].sort((a, b) => a - b)),
    'Toggling the sort direction reverses the column'
  );

  /* ---- alarm manager CRUD ---- */
  await page.goto(`${BASE_URL}/alarms`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  await page.waitForTimeout(600);

  const alarmRows = await countVisible(page, '[data-testid="alarm-row"]');
  assert(alarmRows >= 8, `Alarm manager lists every seeded rule (${alarmRows} rows)`);

  const states = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-field="state"] [data-testid="badge"]')).map(
      (el) => el.getAttribute('data-value')
    )
  );
  assert(
    states.length > 0 && states.every((s) => ['OK', 'ALARM', 'INSUFFICIENT_DATA'].includes(s ?? '')),
    `Every alarm row reports a valid AlarmState (${[...new Set(states)].join(', ')})`
  );

  await page.locator('[data-testid="alarm-create"]').click();
  await page.waitForTimeout(300);
  assert((await page.locator('[data-testid="alarm-form"]').count()) > 0, 'Alarm rule editor opens');

  await page.locator('[data-testid="alarm-submit"]').click();
  await page.waitForTimeout(300);
  assert(
    (await page.locator('[data-testid="alarm-name"][data-error="true"]').count()) > 0,
    'Alarm editor rejects an empty rule name and marks the field'
  );
  assert(
    (await page.locator('[data-testid="alarm-form"] [data-error="true"]').count()) > 0,
    'Alarm editor surfaces validation errors instead of saving an invalid rule'
  );

  await page.locator('[data-testid="alarm-name"]').fill('Verify Harness CPU Guard');
  await page.locator('[data-testid="alarm-scope"]').selectOption('all');
  await page.locator('[data-testid="alarm-metric"]').selectOption('cpu');
  await page.locator('[data-testid="alarm-threshold"]').fill('150');
  await page.locator('[data-testid="alarm-submit"]').click();
  await page.waitForTimeout(300);
  assert(
    (await page.locator('[data-testid="alarm-threshold"][data-error="true"]').count()) > 0,
    'Alarm editor rejects a percentage threshold above 100 for a CPU rule'
  );

  await page.locator('[data-testid="alarm-threshold"]').fill('92');
  await page.locator('[data-testid="alarm-submit"]').click();
  await page.waitForTimeout(700);
  assertEqual(
    await page.locator('[data-testid="alarm-form"]').count(),
    0,
    'A valid alarm draft closes the editor'
  );
  assertEqual(
    await countVisible(page, '[data-testid="alarm-row"]'),
    alarmRows + 1,
    'Creating a rule appends it to the fleet alarm list'
  );

  const createdId = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="alarm-row"]'));
    const match = rows.find((row) =>
      row.querySelector('[data-field="name"]')?.textContent?.includes('Verify Harness CPU Guard')
    );
    const container = match?.closest('tr');
    const buttons = Array.from(container?.querySelectorAll('button') ?? []);
    const remove = buttons.find((b) => (b.getAttribute('data-testid') ?? '').startsWith('alarm-delete-'));
    return remove?.getAttribute('data-testid') ?? null;
  });
  assert(Boolean(createdId), 'The newly created rule exposes management controls');
  if (createdId) {
    const ruleId = createdId.replace('alarm-delete-', '');
    await page.locator(`[data-testid="alarm-toggle-${ruleId}"]`).first().click();
    await page.waitForTimeout(500);
    assertEqual(
      (await textsOfVisible(page, '[data-testid="alarm-stat-disabled"]'))[0],
      '2',
      'Disabling a rule moves it into the disabled counter'
    );
    await page.locator(`[data-testid="alarm-toggle-${ruleId}"]`).first().click();
    await page.waitForTimeout(500);
    await page.locator(`[data-testid="alarm-delete-${ruleId}"]`).first().click();
    await page.waitForTimeout(600);
    assertEqual(
      await countVisible(page, '[data-testid="alarm-row"]'),
      alarmRows,
      'Deleting a rule removes it from the list'
    );
  }

  /* ---- asset form modal ---- */
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  await page.waitForTimeout(500);

  await page.locator('[data-testid="asset-create"]').click();
  await page.waitForTimeout(350);
  assert((await page.locator('[data-testid="asset-form"]').count()) > 0, 'Asset form modal opens');

  await page.locator('[data-testid="asset-submit"]').click();
  await page.waitForTimeout(350);
  assert(
    (await page.locator('[data-testid="asset-form-error"]').count()) > 0,
    'Asset form blocks submission and summarises the validation errors'
  );
  assert(
    (await page.locator('[data-testid="asset-name"][data-error="true"]').count()) > 0,
    'Asset form marks the invalid name field'
  );

  await page.locator('[data-testid="asset-name"]').fill('prod use1 edge#13');
  await page.locator('[data-testid="asset-ip"]').fill('999.1.1.1');
  await page.locator('[data-testid="asset-region"]').fill('us-east-1');
  await page.locator('[data-testid="asset-az"]').fill('us-east-1a');
  await page.locator('[data-testid="asset-submit"]').click();
  await page.waitForTimeout(350);
  assert(
    (await page.locator('[data-testid="asset-name"][data-error="true"]').count()) > 0,
    'Asset form rejects names containing spaces and punctuation'
  );
  assert(
    (await page.locator('[data-testid="asset-ip"][data-error="true"]').count()) > 0,
    'Asset form rejects an out-of-range IPv4 octet'
  );

  await page.locator('[data-testid="asset-name"]').fill('prod-use1-edge-13');
  await page.locator('[data-testid="asset-ip"]').fill('10.0.12.13');
  await page.locator('[data-testid="asset-hostname"]').fill('edge-13.us-east-1.internal');
  await page.locator('[data-testid="asset-submit"]').click();
  await page.waitForTimeout(1200);

  const persisted = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('StatusMonitorDB');
        request.onsuccess = () => {
          const handle = request.result;
          const tx = handle.transaction('servers', 'readonly');
          // `name` is an indexed field on the servers store.
          const req = tx.objectStore('servers').index('name').get('prod-use1-edge-13');
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        };
        request.onerror = () => resolve(null);
      })
  );
  assert(Boolean(persisted), 'A valid asset draft is persisted to IndexedDB');
  assertEqual(
    persisted?.specs?.architecture,
    'x86_64',
    'The persisted asset keeps its capacity spec'
  );
  assertEqual(persisted?.environment, 'production', 'The persisted asset keeps its environment');
  assertEqual(persisted?.ipAddress, '10.0.12.13', 'The persisted asset keeps its IP address');

  // The form navigates to the new instance; go back and confirm it is listed.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  await page.waitForTimeout(400);
  assertEqual(
    await countVisible(page, '[data-testid="server-row-name"]'),
    13,
    'The newly registered instance appears in the fleet table'
  );

  /* ---- incident drawer ---- */
  await page.goto(`${BASE_URL}/incidents`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  await page.waitForTimeout(600);

  assert((await page.locator('[data-testid="incident-open"]').count()) > 0, 'Incident register lists incidents');
  await page.locator('[data-testid="incident-open"]').first().click();
  await page.waitForTimeout(400);
  assert((await page.locator('[data-testid="incident-drawer"]').count()) > 0, 'Incident timeline drawer opens');
  const eventsBefore = await page.locator('[data-testid="timeline-event"]').count();
  assert(eventsBefore > 0, `Incident timeline renders its events (${eventsBefore})`);

  await page.locator('[data-testid="incident-note"]').fill('   ');
  await page.locator('[data-testid="incident-note-submit"]').click();
  await page.waitForTimeout(300);
  assert(
    (await page.locator('[data-testid="incident-note"][aria-invalid="true"]').count()) > 0,
    'Incident drawer rejects an empty timeline note'
  );

  await page.locator('[data-testid="incident-note"]').fill('Rolled back the drain request and re-queued the batch.');
  await page.locator('[data-testid="incident-note-submit"]').click();
  await page.waitForTimeout(500);
  assertEqual(
    await page.locator('[data-testid="timeline-event"]').count(),
    eventsBefore + 1,
    'Appending a note extends the append-only timeline'
  );

  await page.locator('[data-testid="incident-severity-SEV-2"]').click();
  await page.waitForTimeout(500);
  assertEqual(
    await page.locator('[data-testid="timeline-event"]').count(),
    eventsBefore + 2,
    'Changing severity records a timeline event'
  );

  const transitionButton = page.locator('[data-testid="incident-transition-investigating"]');
  if ((await transitionButton.count()) > 0) {
    await transitionButton.click();
    await page.waitForTimeout(500);
    assertEqual(
      await page.locator('[data-testid="timeline-event"]').count(),
      eventsBefore + 3,
      'Advancing the lifecycle status records a transition event'
    );
    assert(
      (await page.locator('[data-testid="incident-transition-resolved"]').count()) > 0,
      'The next lifecycle transition becomes available'
    );
  }

  await page.locator('[data-testid="incident-close"]').click();
  await page.waitForTimeout(300);
  assertEqual(
    await page.locator('[data-testid="incident-drawer"]').count(),
    0,
    'Incident drawer dismisses on close'
  );

  const mttr = await page.locator('[data-testid="incident-summary-mttr"]').textContent();
  assert((mttr ?? '').length > 0, `Mean time to resolve is surfaced on the register (${mttr?.trim()})`);
}
/* ------------------------------------------------------------------ */
/* Phase 5 — page assembly & responsive audit                         */
/* ------------------------------------------------------------------ */

async function auditResponsive(page, diagnostics, label) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(220);

    const overflow = await page.evaluate(OVERFLOW_PROBE);
    assert(
      overflow.length === 0,
      `[${label} @ ${viewport.name}] No element overflows the ${viewport.width}px viewport`,
      overflow.length ? JSON.stringify(overflow, null, 1) : undefined
    );

    const clipped = await page.evaluate(CLIPPING_PROBE);
    assert(
      clipped.length === 0,
      `[${label} @ ${viewport.name}] No text node is clipped`,
      clipped.length ? JSON.stringify(clipped, null, 1) : undefined
    );

    const small = await page.evaluate(TAP_TARGET_PROBE);
    assert(
      small.length === 0,
      `[${label} @ ${viewport.name}] Every interactive target is at least 44x44`,
      small.length ? JSON.stringify(small, null, 1) : undefined
    );

    const horizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    assert(horizontalScroll, `[${label} @ ${viewport.name}] No horizontal page scroll`);
  }

  const errors = diagnostics.filter((entry) => entry.startsWith('[pageerror]'));
  assert(errors.length === 0, `[${label}] No uncaught page errors`, errors.join('\n'));
}

async function checkPhase5(page, diagnostics) {
  section('Phase 5 · Page Assembly & Responsive Audit');

  const routes = [
    { path: '/', label: 'dashboard' },
    { path: '/alarms', label: 'alarms' },
    { path: '/incidents', label: 'incidents' }
  ];

  for (const route of routes) {
    await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle' });
    await waitForFleetReady(page);
    await page.waitForTimeout(250);
    assert(
      (await page.locator('h1').first().textContent())?.trim().length > 0,
      `Route ${route.path} renders a page heading`
    );
    assert(
      (await page.locator('[data-testid="breadcrumb"]').count()) > 0,
      `Route ${route.path} renders the breadcrumb bar`
    );
    await auditResponsive(page, diagnostics, route.label);
  }

  // Deep dive route, resolved from a real row so the id is guaranteed valid.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  const firstRow = page.locator('[data-testid="server-row-link"]').first();
  const count = await page.locator('[data-testid="server-row-link"]').count();
  assert(count > 0, 'Server table exposes drill-down links');
  if (count > 0) {
    const href = await firstRow.getAttribute('href');
    await page.goto(`${BASE_URL}${href}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    assert(
      (await page.locator('[data-testid="server-identity"]').count()) > 0,
      'Server detail route renders the instance identity panel'
    );
    assert(
      (await page.locator('[data-testid="metric-tab"]').count()) >= 4,
      'Server detail route exposes metric tabs'
    );

    const tabButtons = page.locator('[data-testid="metric-tab"]');
    const tabCount = await tabButtons.count();
    if (tabCount >= 4) {
      await tabButtons.nth(3).click();
      await page.waitForTimeout(250);
      assert(
        await tabButtons.nth(3).getAttribute('aria-selected').then((v) => v === 'true'),
        'Metric tabs expose and update aria-selected'
      );
      assert(
        (await page.locator('[data-testid="metric-chart"]').count()) > 0,
        'Switching metric tabs re-renders the chart'
      );
    }

    const incidentLink = page.locator('[data-testid="incident-open"]').first();
    if (await incidentLink.count()) {
      await incidentLink.click();
      await page.waitForTimeout(300);
      const drawerBox = await page.locator('[data-testid="incident-drawer"]').boundingBox();
      assert(Boolean(drawerBox), 'Incident drawer opens from the server detail route');

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
      const mobileBox = await page.locator('[data-testid="incident-drawer"]').boundingBox();
      if (mobileBox) {
        assert(
          mobileBox.width >= 380 && mobileBox.height <= 844 * 0.86,
          `Incident drawer becomes a bottom sheet at 390px (${Math.round(mobileBox.width)}x${Math.round(mobileBox.height)})`
        );
        assert(
          Math.abs(mobileBox.y + mobileBox.height - 844) < 3,
          'Bottom sheet is anchored to the viewport bottom edge'
        );
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(250);
      const desktopBox = await page.locator('[data-testid="incident-drawer"]').boundingBox();
      if (desktopBox) {
        assert(
          desktopBox.width >= 470 && desktopBox.width <= 500 && Math.abs(desktopBox.height - 900) < 3,
          `Incident drawer becomes a 480px full-height sidebar on desktop (${Math.round(desktopBox.width)}x${Math.round(desktopBox.height)})`
        );
        assert(
          Math.abs(desktopBox.x + desktopBox.width - 1280) < 3,
          'Desktop sidebar is anchored to the right edge'
        );
      }
    }

    await auditResponsive(page, diagnostics, 'server-detail');
  }

  // Asset form modal round trip.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await waitForFleetReady(page);
  const createServer = page.locator('[data-testid="asset-create"]');
  if (await createServer.count()) {
    await createServer.click();
    await page.waitForTimeout(250);
    assert((await page.locator('[data-testid="asset-form"]').count()) > 0, 'Asset form modal opens');
    await page.locator('[data-testid="asset-submit"]').click();
    await page.waitForTimeout(200);
    assert(
      (await page.locator('[data-testid="asset-form-error"]').count()) > 0,
      'Asset form rejects an invalid submission and shows field errors'
    );
    await page.locator('[data-testid="asset-name"]').fill('prod-use1-edge-13');
    await page.locator('[data-testid="asset-ip"]').fill('10.0.12.13');
    await page.locator('[data-testid="asset-submit"]').click();
    await page.waitForTimeout(400);
    assertEqual(
      await countVisible(page, '[data-testid="server-row-name"]'),
      13,
      'Creating a new asset appends a 13th row to the fleet table'
    );
  }

  await page.screenshot({ path: `${SHOT_DIR}dashboard-1280.png`, fullPage: true });
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const diagnostics = [];

  const phase1Page = await context.newPage();
  attachDiagnostics(phase1Page, diagnostics);

  console.log(`\n\x1b[1mVerifying ${BASE_URL} with headless Chromium (${browser.version()})\x1b[0m`);

  try {
    await phase1Page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await waitForFleetReady(phase1Page);

    if (maxPhase >= 1) await checkPhase1(phase1Page);
    if (maxPhase >= 2) await checkPhase2(phase1Page);

    if (maxPhase >= 3) await checkPhase3(phase1Page);

    if (maxPhase >= 4) {
      await phase1Page.goto(`${BASE_URL}/alarms`, { waitUntil: 'networkidle' });
      await waitForFleetReady(phase1Page);
      await phase1Page.waitForTimeout(400);
      await checkPhase4(phase1Page);
      await phase1Page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await waitForFleetReady(phase1Page);
      await phase1Page.waitForTimeout(300);
    }

    if (maxPhase >= 5) await checkPhase5(phase1Page, diagnostics);
  } catch (error) {
    record(false, 'Verification harness completed without throwing', error?.stack ?? String(error));
  }

  await browser.close();

  const failures = results.filter((r) => !r.ok);
  const hardFailures = failures.length;
  const overlays = diagnostics.filter((entry) => entry.startsWith('[vite-overlay]'));
  const warnings = diagnostics.filter(
    (entry) => !entry.startsWith('[pageerror]') && !entry.startsWith('[vite-overlay]')
  );

  if (overlays.length) {
    record(false, 'No Vite compile/runtime error overlay was raised', [...new Set(overlays)].join('\n'));
  }

  console.log(`\n\x1b[1mSummary\x1b[0m: ${results.length - failures.length}/${results.length} checks passed`);
  if (warnings.length) {
    console.log(`\n\x1b[33mConsole diagnostics (${warnings.length}):\x1b[0m`);
    for (const warning of [...new Set(warnings)].slice(0, 25)) console.log(`  - ${warning}`);
  }
  if (failures.length) {
    console.log(`\n\x1b[31mFailures (${failures.length}):\x1b[0m`);
    for (const failure of failures) console.log(`  - [${failure.check}] ${failure.message}`);
    process.exitCode = 1;
  } else if (hardFailures === 0) {
    console.log('\x1b[32mAll checks passed.\x1b[0m');
  }
}

main();
