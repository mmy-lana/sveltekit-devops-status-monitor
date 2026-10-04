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

/** Wait until the monitor store has finished its first IndexedDB hydration. */
async function waitForFleetReady(page) {
  await page.waitForFunction(
    () => document.body.innerText.includes('/ 12 Healthy') || document.body.innerText.includes('/ 12'),
    undefined,
    { timeout: 20_000 }
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

  const chart = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="metric-chart"]');
    if (!svg) return { found: false };
    const polylines = svg.querySelectorAll('polyline[data-series]');
    const areas = svg.querySelectorAll('path[data-area]');
    const verticalAxisTexts = svg.querySelectorAll('text[data-axis="y-left"], text[data-axis="y-right"]');
    const gridLines = svg.querySelectorAll('line[data-grid]');
    const scrubber = svg.querySelector('[data-testid="chart-scrubber"]');
    return {
      found: true,
      series: polylines.length,
      areas: areas.length,
      verticalAxis: verticalAxisTexts.length,
      grid: gridLines.length,
      scrubberPresent: Boolean(scrubber),
      width: Math.round(svg.getBoundingClientRect().width)
    };
  });

  assert(chart.found, 'MetricChart renders a [data-testid="metric-chart"] SVG');
  if (chart.found) {
    assert(chart.series >= 2, `MetricChart draws a dual series (${chart.series} polylines)`);
    assert(chart.areas >= 2, `MetricChart fills series areas (${chart.areas} paths)`);
    assert(chart.verticalAxis >= 4, `MetricChart labels both Y axes (${chart.verticalAxis} tick labels)`);
    assert(chart.grid >= 3, `MetricChart draws horizontal gridlines (${chart.grid})`);
    assert(chart.width > 200, `MetricChart fills its container (${chart.width}px wide)`);
  }

  // Touch scrubbing: tap near the right edge and assert a readout appears.
  if (chart.found) {
    const box = await page.locator('[data-testid="metric-chart"]').boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.waitForTimeout(150);
      const readout = await page.locator('[data-testid="chart-readout"]').count();
      assert(readout > 0, 'MetricChart exposes a scrub readout on pointer interaction');

      const scrubberCount = await page.locator('[data-testid="chart-scrubber"]').count();
      assert(scrubberCount > 0, 'MetricChart renders a scrub handle during interaction');
    }
  }

  const sparklines = await page.locator('[data-testid="sparkline"]').count();
  assert(sparklines > 0, `Server table renders inline Sparklines (${sparklines} found)`);

  const sparklineBox = sparklines > 0 ? await page.locator('[data-testid="sparkline"]').first().boundingBox() : null;
  if (sparklineBox) {
    assert(
      sparklineBox.width >= 70 && sparklineBox.width <= 96 && sparklineBox.height >= 20 && sparklineBox.height <= 30,
      `Sparkline renders at the 80x24 spec (${Math.round(sparklineBox.width)}x${Math.round(sparklineBox.height)})`
    );
  }

  const timeRangeButtons = await page.locator('[data-testid="time-range-selector"] button').count();
  assertEqual(timeRangeButtons, 6, 'TimeRangeSelector renders all six range buttons');

  const refreshOptions = await page.locator('[data-testid="refresh-rate-dropdown"] select option').count();
  assert(refreshOptions >= 4, `RefreshRateDropdown offers interval + paused options (${refreshOptions})`);

  const logConsole = await page.locator('[data-testid="log-console"]').count();
  assert(logConsole > 0, 'LogConsole is mounted on the server detail route');

  if (logConsole > 0) {
    const before = await page.locator('[data-testid="log-line"]').count();
    assert(before > 0, `LogConsole renders persisted log lines (${before})`);
    const search = page.locator('[data-testid="log-search"]');
    if (await search.count()) {
      await search.fill('zzzz-no-match-zzzz');
      await page.waitForTimeout(120);
      const after = await page.locator('[data-testid="log-line"]').count();
      assertEqual(after, 0, 'LogConsole search filters every line out when nothing matches');
      assert(
        (await page.locator('[data-testid="log-empty"]').count()) > 0,
        'LogConsole shows an explicit empty state for a non-matching query'
      );
      await search.fill('');
      await page.waitForTimeout(120);
      assert((await page.locator('[data-testid="log-line"]').count()) > 0, 'LogConsole search clears cleanly');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Phase 4 — engine, stores, domain components                        */
/* ------------------------------------------------------------------ */

async function checkPhase4(page) {
  section('Phase 4 · Engine & Reactive State');

  const state = await page.evaluate(() => {
    const telemetryCell = document.querySelector('[data-testid="cpu-value"]');
    return {
      cpu: telemetryCell ? telemetryCell.textContent : null
    };
  });
  assert(state.cpu !== null, 'Monitor store publishes live CPU telemetry into the DOM');

  const alarmState = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="alarm-row"]'));
    return rows.map((row) => ({
      name: row.querySelector('[data-field="name"]')?.textContent?.trim(),
      state: row.querySelector('[data-field="state"]')?.textContent?.trim()
    }));
  });
  assert(alarmState.length >= 6, `Alarm manager lists every seeded rule (${alarmState.length} rows)`);
  assert(
    alarmState.every((row) => ['OK', 'ALARM', 'INSUFFICIENT_DATA'].includes(row.state ?? '')),
    'Every alarm row reports a valid AlarmState'
  );

  // Exercise the rule editor end to end.
  const createButton = page.locator('[data-testid="alarm-create"]');
  if (await createButton.count()) {
    await createButton.click();
    await page.waitForTimeout(200);
    assert((await page.locator('[data-testid="alarm-form"]').count()) > 0, 'Alarm rule editor opens');
    await page.locator('[data-testid="alarm-submit"]').click();
    await page.waitForTimeout(150);
    assert(
      (await page.locator('[data-testid="alarm-form-error"]').count()) > 0,
      'Alarm rule editor blocks submission with invalid input and surfaces field errors'
    );
    await page.locator('[data-testid="alarm-cancel"]').click();
    await page.waitForTimeout(150);
  }

  const filterResults = await page.evaluate(async () => {
    const search = document.querySelector('[data-testid="server-search"]');
    return { hasSearch: Boolean(search) };
  });
  assert(filterResults.hasSearch, 'FilterSearchToolbar exposes a labelled search input');

  if (filterResults.hasSearch) {
    await page.locator('[data-testid="server-search"]').fill('postgres');
    await page.waitForTimeout(200);
    const names = await textsOfVisible(page, '[data-testid="server-row-name"]');
    assert(names.length === 1 && names[0].includes('postgres'), `Search narrows the grid to the matching instance (${names.join(', ')})`);

    await page.locator('[data-testid="server-search"]').fill('');
    await page.waitForTimeout(150);

    await page.locator('[data-testid="status-filter-critical"]').click();
    await page.waitForTimeout(200);
    const statuses = await textsOfVisible(page, '[data-testid="server-row-status"]');
    assert(
      statuses.every((s) => s.trim().toLowerCase() === 'critical'),
      `Status pill filter returns only matching rows (${statuses.join(', ') || 'none'})`
    );

    await page.locator('[data-testid="status-filter-all"]').click();
    await page.waitForTimeout(200);
    assert((await countVisible(page, '[data-testid="server-row-name"]')) === 12, 'Resetting the status filter restores all 12 rows');
  }

  const sortToggle = page.locator('[data-testid="sort-cpu"]');
  if (await sortToggle.count()) {
    await sortToggle.click();
    await page.waitForTimeout(200);
    const cpuValues = await textsOfVisible(page, '[data-testid="cpu-value"]');
    const parsed = cpuValues.map((v) => Number.parseFloat(v)).filter((n) => Number.isFinite(n));
    const sortedDesc = [...parsed].sort((a, b) => b - a);
    assertEqual(
      JSON.stringify(parsed),
      JSON.stringify(sortedDesc),
      'Sorting by CPU descending produces a monotonically non-increasing column'
    );
    await sortToggle.click();
    await page.waitForTimeout(150);
  }

  // Incident timeline drawer: bottom sheet under 640px, sidebar above.
  const drawer = page.locator('[data-testid="incident-drawer"]');
  if (await drawer.count()) {
    const box = await drawer.boundingBox();
    assert(Boolean(box), 'Incident timeline drawer has a measurable box');
  }
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

    if (maxPhase >= 3 || maxPhase >= 4 || maxPhase >= 5) {
      await phase1Page.goto(`${BASE_URL}/servers/srv-use1-api-01`, { waitUntil: 'networkidle' });
      await waitForFleetReady(phase1Page);
      await phase1Page.waitForTimeout(400);
      await phase1Page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await waitForFleetReady(phase1Page);
      await phase1Page.waitForTimeout(300);
    }

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
