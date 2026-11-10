// The factory's clock. Two environment variables exist only so tests need not wait for real time:
// FACTOR_MINUTE_MS shortens a minute, FACTOR_CLOCK_OFFSET_MS moves "now" forward.
const minute = Number(process.env.FACTOR_MINUTE_MS);
export const MINUTE_MS = minute > 0 ? minute : 60_000;
export const nowMs = () => Date.now() + (Number(process.env.FACTOR_CLOCK_OFFSET_MS) || 0);
export const nowIso = () => new Date(nowMs()).toISOString();
