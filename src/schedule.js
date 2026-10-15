'use strict';

const crypto = require('crypto');
const store = require('./store');
const { toCourse } = require('./normalize');
const { fetchIcal } = require('./sources/ical');
const { demoEvents } = require('./sources/demo');
const { fetchHpApi } = require('./sources/hpapi');
const { fetchHpOfficial } = require('./sources/hpofficial');
const { fetchHpSoap } = require('./sources/hpsoap');
const config = require('./config');

const state = {
  courses: [],
  lastFetchAt: null,
  lastSuccessAt: null,
  errors: [], // [{ source, message }]
  fingerprints: new Map(), // uid -> empreinte du contenu
  modifiedAt: new Map(), // uid -> date de dernière modification détectée
  timer: null,
  running: null,
};

function isToday(iso) {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function fingerprint(c) {
  return crypto
    .createHash('sha1')
    .update([c.start, c.end, c.subject, c.teacher, c.rooms.join('|'), c.remote, c.cancelled].join('#'))
    .digest('hex');
}

/**
 * Fusionne les doublons : HyperPlanning exporte souvent le même cours dans le calendrier
 * de chaque promotion. On regroupe (même horaire + matière + intervenant) et on cumule groupes et salles.
 */
function merge(courses) {
  const byKey = new Map();
  for (const c of courses) {
    const key = [c.start, c.end, c.subject.toLowerCase(), c.teacher.toLowerCase()].join('#');
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...c, groups: c.groups.slice(), rooms: c.rooms.slice() });
      continue;
    }
    c.groups.forEach((g) => {
      if (!prev.groups.some((x) => x.label === g.label)) prev.groups.push(g);
    });
    c.rooms.forEach((r) => {
      if (!prev.rooms.includes(r)) prev.rooms.push(r);
    });
    prev.remote = prev.remote || c.remote;
    prev.cancelled = prev.cancelled && c.cancelled;
  }
  return [...byKey.values()];
}

async function refresh() {
  if (state.running) return state.running;
  state.running = (async () => {
    const settings = store.load();
    const errors = [];
    let raw = [];

    const jobs = [];
    if (!settings.demoMode) {
      if (settings.hpApi.enabled) {
        jobs.push({
          name: 'API HyperPlanning',
          run: () =>
            (settings.hpApi.flavor === 'generic'
              ? fetchHpApi(settings.hpApi, store.hpApiKey(), config.timezone)
              : settings.hpApi.flavor === 'soap'
                ? fetchHpSoap(settings.hpApi, store.hpApiKey(), config.timezone)
                : fetchHpOfficial(settings.hpApi, store.hpApiKey(), config.timezone)
            ).then((r) => r.events),
        });
      }
      settings.sources.forEach((src, i) => jobs.push({ name: src.name || 'iCal ' + (i + 1), run: () => fetchIcal(src.url) }));
    }

    if (!jobs.length) {
      raw = demoEvents();
    } else {
      const results = await Promise.allSettled(jobs.map((j) => j.run()));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') raw = raw.concat(r.value);
        else errors.push({ source: jobs[i].name, message: r.reason.message });
      });
    }

    state.lastFetchAt = new Date().toISOString();
    state.errors = errors;

    // Si toutes les sources échouent, on garde les dernières données valides (l'écran ne se vide pas).
    if (jobs.length && errors.length === jobs.length) return;

    const now = Date.now();
    const firstLoad = state.fingerprints.size === 0;
    const courses = merge(
      raw
        .map((ev) => {
          try {
            const c = toCourse(ev, settings);
            c._demoModified = ev._demoModified;
            return c;
          } catch (e) {
            return null;
          }
        })
        .filter((c) => c && isToday(c.start))
    );

    for (const c of courses) {
      c.id = c.uid || fingerprint({ ...c, teacher: '', rooms: [] });
      const fp = fingerprint(c);
      const prev = state.fingerprints.get(c.id);
      if (!firstLoad && (prev === undefined || prev !== fp)) state.modifiedAt.set(c.id, now);
      if (c._demoModified && !state.modifiedAt.has(c.id)) state.modifiedAt.set(c.id, now - 20 * 60000);
      state.fingerprints.set(c.id, fp);
      delete c._demoModified;
      delete c.uid;
    }

    courses.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    state.courses = courses;
    state.lastSuccessAt = state.lastFetchAt;
  })()
    .catch((e) => {
      state.errors = [{ source: 'global', message: e.message }];
    })
    .finally(() => {
      state.running = null;
    });
  return state.running;
}

/** Changement de source (démo -> API…) : on repart de zéro pour ne pas tout marquer « modifié ». */
function resetTracking() {
  state.fingerprints.clear();
  state.modifiedAt.clear();
}

function schedule() {
  clearTimeout(state.timer);
  const minutes = store.load().refreshMinutes;
  state.timer = setTimeout(async () => {
    await refresh();
    schedule();
  }, minutes * 60000);
  state.timer.unref();
}

async function start() {
  await refresh();
  schedule();
}

/** Données publiques pour un écran : uniquement ce qui doit s'afficher, aucun secret. */
function forScreen(screen) {
  const settings = store.load();
  const levels = new Set(screen.levels);
  const ttl = settings.modifiedBadgeHours * 3600000;
  const now = Date.now();

  const courses = state.courses
    .filter((c) => !c.groups.length || c.groups.some((g) => !g.level || levels.has(g.level)))
    .map((c) => {
      const m = state.modifiedAt.get(c.id);
      return { ...c, modified: !!m && ttl > 0 && now - m < ttl };
    });

  return {
    generatedAt: new Date().toISOString(),
    // L'horloge/fuseau des TV n'est pas fiable : l'écran se cale sur l'heure du serveur.
    serverNow: now,
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
    lastSuccessAt: state.lastSuccessAt,
    stale: state.errors.length > 0,
    screen: { id: screen.id, name: screen.name },
    settings: {
      campusName: settings.campusName,
      pageSeconds: settings.pageSeconds,
      rowsPerPage: settings.rowsPerPage,
      theme: settings.theme,
      refreshMinutes: settings.refreshMinutes,
      announcement: settings.announcement.enabled && settings.announcement.text ? settings.announcement : null,
    },
    courses,
  };
}

function status() {
  return {
    lastFetchAt: state.lastFetchAt,
    lastSuccessAt: state.lastSuccessAt,
    errors: state.errors,
    count: state.courses.length,
  };
}

module.exports = { start, refresh, schedule, forScreen, status, resetTracking };
