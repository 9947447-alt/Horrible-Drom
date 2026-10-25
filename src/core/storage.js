// 本地存档：设置、最佳记录、已解锁体验。所有失败都静默回退。

const KEY = 'horrible-dorm-reaction-v1';

export const DEFAULT_SETTINGS = {
  volume: 0.55,
  muted: false,
  reducedMotion: false,
  shake: true,
};

const DEFAULT_RECORDS = {
  runs: 0,
  wins: 0,
  bestNight: 0,
  bestGrade: '',
  byDifficulty: {
    easy: { wins: 0, runs: 0, bestNight: 0 },
    normal: { wins: 0, runs: 0, bestNight: 0 },
    nightmare: { wins: 0, runs: 0, bestNight: 0 },
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function loadSave() {
  let data = null;
  try {
    data = safeParse(localStorage.getItem(KEY));
  } catch {
    data = null;
  }
  const settings = { ...clone(DEFAULT_SETTINGS), ...(data?.settings || {}) };
  settings.volume = Math.min(1, Math.max(0, Number(settings.volume) || 0));
  const records = { ...clone(DEFAULT_RECORDS), ...(data?.records || {}) };
  records.byDifficulty = { ...clone(DEFAULT_RECORDS.byDifficulty), ...(data?.records?.byDifficulty || {}) };
  return { settings, records };
}

export function saveSave({ settings, records }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ settings, records, savedAt: Date.now() }));
  } catch {
    // 隐私模式/磁盘满：游戏仍可继续，只是不持久化。
  }
}

export function resetSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function recordRun(records, { difficulty, result, nightElapsed, grade }) {
  const next = clone(records || DEFAULT_RECORDS);
  next.runs += 1;
  const bucket = next.byDifficulty[difficulty] || (next.byDifficulty[difficulty] = { wins: 0, runs: 0, bestNight: 0 });
  bucket.runs += 1;
  if (result?.outcome === 'victory') {
    next.wins += 1;
    bucket.wins += 1;
    const night = Math.round(nightElapsed || 0);
    if (night > bucket.bestNight) bucket.bestNight = night;
    if (night > next.bestNight) next.bestNight = night;
    if (result.grade && (!next.bestGrade || result.grade < next.bestGrade)) next.bestGrade = result.grade;
  }
  return next;
}

export function formatNight(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
