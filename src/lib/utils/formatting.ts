import type { LogLevel, MetricUnit, TimeRangeFilter, TimeRangeValue } from '$lib/types/monitor';

/* ------------------------------------------------------------------ */
/* Bandwidth & storage                                                 */
/* ------------------------------------------------------------------ */

/**
 * Render a Kbps figure using the largest unit that keeps the number readable.
 * `450` -> `450 Kbps`, `4500` -> `4.5 Mbps`, `4500000` -> `4.50 Gbps`.
 */
export function formatBytes(kbps: number): string {
  if (!Number.isFinite(kbps)) return '--';
  const abs = Math.abs(kbps);
  if (abs < 1000) return `${kbps.toFixed(0)} Kbps`;
  const mbps = kbps / 1000;
  if (Math.abs(mbps) < 1000) return `${mbps.toFixed(1)} Mbps`;
  return `${(mbps / 1000).toFixed(2)} Gbps`;
}

/** Render a binary storage quantity (GB) with an adaptive precision. */
export function formatDiskUsage(diskGb: number): string {
  if (!Number.isFinite(diskGb)) return '--';
  if (diskGb >= 1024) return `${(diskGb / 1024).toFixed(2)} TiB`;
  return `${diskGb.toFixed(diskGb % 1 === 0 ? 0 : 1)} GB`;
}

/** Render a memory quantity (GB) with an adaptive precision. */
export function formatMemoryUsage(memoryGb: number): string {
  if (!Number.isFinite(memoryGb)) return '--';
  return `${memoryGb.toFixed(memoryGb % 1 === 0 ? 0 : 1)} GB`;
}

/* ------------------------------------------------------------------ */
/* Duration & clock                                                    */
/* ------------------------------------------------------------------ */

/** Compact duration rendering: `45s`, `12m`, `3h 7m`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '--';
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  const seconds = Math.floor(abs / 1000);
  if (seconds < 60) return `${sign}${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${sign}${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${sign}${hours}h ${remainingMinutes}m`;
}

/** Zero-padded two digit number. */
function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `14:03:27` — the clock format used across chart axes and the log console. */
export function formatClockTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--';
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** `Sep 14, 03:27` — compact absolute timestamp for tables and timelines. */
export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/** `2026-09-14 03:27:08` — unambiguous timestamp for log lines. */
export function formatLogTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Human readable "time ago" label. Deliberately coarse so it does not flicker
 * on every telemetry tick.
 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return '--';
  const delta = now - timestamp;
  if (delta < 0) return 'just now';
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

/* ------------------------------------------------------------------ */
/* Percentages & metrics                                               */
/* ------------------------------------------------------------------ */

/** Render a 0-100 ratio with a fixed single decimal and a percent sign. */
export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '--';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Render a metric using the precision that matches its unit:
 * percentages get 1 decimal, latency 1 decimal, bandwidth stays integral.
 */
export function formatMetricValue(value: number, unit: MetricUnit): string {
  if (!Number.isFinite(value)) return '--';
  if (unit === 'Kbps') return formatBytes(value);
  return `${value.toFixed(1)}${unit}`;
}

/** Thousands-separated integer, used by the fleet rollup counters. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

/* ------------------------------------------------------------------ */
/* Domain lookups                                                      */
/* ------------------------------------------------------------------ */

/** Maps a log level to its semantic colour class used by `LogConsole`. */
export const LOG_LEVEL_TONE: Record<LogLevel, 'slate' | 'sky' | 'amber' | 'rose' | 'fuchsia'> = {
  DEBUG: 'slate',
  INFO: 'sky',
  WARN: 'amber',
  ERROR: 'rose',
  FATAL: 'fuchsia'
};

/** Ordered log levels, quietest first, for filter chips. */
export const LOG_LEVEL_ORDER: readonly LogLevel[] = [
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
  'FATAL'
] as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Canonical time range options offered by `TimeRangeSelector`. */
export const TIME_RANGE_OPTIONS: readonly TimeRangeFilter[] = [
  { label: '1h', value: '1h', durationMs: HOUR },
  { label: '3h', value: '3h', durationMs: 3 * HOUR },
  { label: '6h', value: '6h', durationMs: 6 * HOUR },
  { label: '12h', value: '12h', durationMs: 12 * HOUR },
  { label: '24h', value: '24h', durationMs: 24 * HOUR },
  { label: '7d', value: '7d', durationMs: 7 * DAY }
] as const;

/** Resolve a time range value into milliseconds, defaulting to 1 hour. */
export function durationForTimeRange(value: TimeRangeValue): number {
  return TIME_RANGE_OPTIONS.find((option) => option.value === value)?.durationMs ?? HOUR;
}

/** Retention window enforced by the telemetry loop. */
export const RETENTION_MS = 7 * DAY;
