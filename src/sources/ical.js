'use strict';

const ical = require('node-ical');

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20000;

/** Télécharge un export iCal HyperPlanning et renvoie les événements VEVENT bruts. */
async function fetchIcal(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: 'text/calendar, text/plain;q=0.8' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('Fichier iCal trop volumineux');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('Fichier iCal trop volumineux');
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("La réponse n'est pas un calendrier iCal");
    const data = ical.sync.parseICS(text);
    return Object.values(data).filter((e) => e && e.type === 'VEVENT' && e.start && e.end);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchIcal };
