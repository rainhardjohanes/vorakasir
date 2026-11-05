// A closing schedule requests a human close/count. It never settles a shift,
// changes money or sends a network request. All calculations work offline.
const DEFAULT_ZONE = 'Asia/Makassar';
const DEFAULT_TIME = '00:00';
const formatters = new Map();
const cutoffs = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    const value = new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    if (formatters.size >= 20) formatters.delete(formatters.keys().next().value);
    formatters.set(timeZone, value);
  }
  return formatters.get(timeZone);
}

export function registerCloseTimezone(profile = {}) {
  const requested = [profile?.timezone, profile?.timeZone, profile?.time_zone]
    .find(value => typeof value === 'string' && value.length > 0);
  if (requested) {
    try { formatter(requested); return requested; } catch { /* Match receipt fallback. */ }
  }
  return DEFAULT_ZONE;
}

export function getRegisterCloseSchedule(profile = {}) {
  const config = profile?.registerCloseSchedule;
  const supplied = config != null;
  const validObject = config && typeof config === 'object' && !Array.isArray(config);
  const validTime = validObject && typeof config.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config.time);
  const validFlag = validObject && typeof config.enabled === 'boolean';
  const time = validTime ? config.time : DEFAULT_TIME;
  return {
    enabled: validFlag ? config.enabled : true,
    time, timeLabel: time.replace(':', '.'), timezone: registerCloseTimezone(profile),
    valid: !supplied || !!(validTime && validFlag),
  };
}

/** Validate the owner's form before its durable save, without changing fields. */
export function validateRegisterCloseSchedule(profile = {}) {
  const result = getRegisterCloseSchedule(profile);
  if (!result.valid) throw new Error('Isi jam tutup kasir antara 00:00–23:59 dengan format jam dan menit yang lengkap.');
  return { enabled: result.enabled, time: result.time };
}

function localParts(stamp, timezone) {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(stamp)
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}
const wall = parts => Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);

// Find actual instants for a wall-clock minute. Repeated DST minutes have two
// candidates. A nonexistent minute uses the first valid time after the gap.
function wallInstants(parts, timezone) {
  const target = wall(parts);
  const offsets = new Set();
  for (let hour = -36; hour <= 36; hour += 6) {
    const stamp = target + hour * 3600000;
    offsets.add(wall(localParts(stamp, timezone)) - stamp);
  }
  const candidates = [...offsets].map(offset => target - offset);
  const matches = candidates.filter(stamp => wall(localParts(stamp, timezone)) === target).sort((a, b) => a - b);
  if (matches.length) return matches;
  const after = candidates.filter(stamp => wall(localParts(stamp, timezone)) >= target).sort((a, b) => a - b);
  if (!after.length) throw new Error('Local closing time cannot be resolved.');
  let high = Math.ceil(after[0] / 60000), low = high - 48 * 60;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (wall(localParts(middle * 60000, timezone)) >= target) high = middle;
    else low = middle;
  }
  return [high * 60000];
}

function firstCutoff(openedAt, time, timezone) {
  const key = `${openedAt}|${time}|${timezone}`;
  if (cutoffs.has(key)) return cutoffs.get(key);
  const opened = localParts(openedAt, timezone);
  const [hour, minute] = time.split(':').map(Number);
  let result;
  for (let day = 0; day <= 3; day++) {
    const next = new Date(Date.UTC(opened.year, opened.month - 1, opened.day + day));
    const parts = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour, minute, second: 0 };
    result = wallInstants(parts, timezone).find(stamp => stamp > openedAt);
    if (result !== undefined) break;
  }
  if (!Number.isFinite(result)) throw new Error('Next closing time cannot be resolved.');
  if (cutoffs.size >= 250) cutoffs.delete(cutoffs.keys().next().value);
  cutoffs.set(key, result);
  return result;
}

function parseInstant(value) {
  if (typeof value !== 'string') return NaN;
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i);
  if (!matched) return NaN;
  const [year, month, day] = matched.slice(1).map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
  return Date.parse(value);
}

/**
 * The first cutoff strictly AFTER this shift opened remains the deadline even
 * after several days/restarts. Callers should latch a required result per shift
 * so a later device-clock rollback cannot unlock an already observed deadline.
 * @param {{shift?:any,profile?:any,now?:number|string|Date}} options
 */
export function getRegisterCloseState({ shift, profile = {}, now = Date.now() } = {}) {
  const schedule = getRegisterCloseSchedule(profile);
  const base = { required: false, dueAt: null, timeLabel: schedule.timeLabel, timezone: schedule.timezone, enabled: schedule.enabled };
  if (!shift || shift.status === 'closed' || !schedule.enabled) return base;
  const raw = shift.openedAt ?? shift.opened_at;
  const opened = parseInstant(raw);
  const current = now instanceof Date ? now.getTime() : typeof now === 'string' ? parseInstant(now) : now;
  if (!Number.isFinite(opened) || !Number.isFinite(current)) return { ...base, required: true, invalid: true };
  try {
    const due = firstCutoff(opened, schedule.time, schedule.timezone);
    return { ...base, required: current >= due, dueAt: new Date(due).toISOString(),
      ...(current < opened ? { clockBehind: true } : {}), ...(!schedule.valid ? { defaultApplied: true } : {}) };
  } catch { return { ...base, required: true, invalid: true }; }
}
