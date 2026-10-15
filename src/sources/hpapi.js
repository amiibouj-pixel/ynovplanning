'use strict';

// Connecteur pour une API JSON "maison" : tout est réglable dans l'admin (URL, auth, chemin des cours)
// parce que je n'ai pas trouvé de doc publique. J'accepte plusieurs noms pour chaque champ.

const TIMEOUT_MS = 20000;
const MAX_BYTES = 10 * 1024 * 1024;

function todayParts(tz) {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return { y: parts.year, m: parts.month, d: parts.day };
}

function buildUrl(cfg, apiKey, tz) {
  const { y, m, d } = todayParts(tz);
  const path = (cfg.coursesPath || '')
    .replace(/\{date\}/g, `${y}-${m}-${d}`)
    .replace(/\{dateFR\}/g, `${d}/${m}/${y}`);
  const url = new URL(cfg.baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, ''));
  if (cfg.authMode === 'query') url.searchParams.set(cfg.headerName || 'apikey', apiKey);
  return url;
}

function authHeaders(cfg, apiKey) {
  switch (cfg.authMode) {
    case 'bearer':
      return { Authorization: 'Bearer ' + apiKey };
    case 'basic':
      return { Authorization: 'Basic ' + Buffer.from((cfg.username || '') + ':' + apiKey).toString('base64') };
    case 'header':
      return { [cfg.headerName || 'X-API-Key']: apiKey };
    default:
      return {};
  }
}

async function fetchJson(cfg, apiKey, tz) {
  if (!cfg.baseUrl) throw new Error("URL de l'API HyperPlanning manquante");
  if (!apiKey) throw new Error('Clé API manquante');
  const url = buildUrl(cfg, apiKey, tz);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...authHeaders(cfg, apiKey) },
    });
    if (res.status === 401 || res.status === 403) throw new Error('Clé API refusée (HTTP ' + res.status + ')');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('Réponse trop volumineuse');
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("La réponse n'est pas du JSON (vérifiez le chemin de la ressource)");
    }
  } finally {
    clearTimeout(timer);
  }
}

// lecture du JSON (plusieurs noms possibles par champ)

function norm(k) {
  return String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function pick(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined;
  const wanted = names.map(norm);
  for (const k of Object.keys(obj)) {
    if (wanted.includes(norm(k)) && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

function label(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(label).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const nom = pick(v, ['nom', 'lastname', 'name']);
    const prenom = pick(v, ['prenom', 'firstname']);
    if (nom && prenom) return prenom + ' ' + String(nom).toUpperCase();
    return String(pick(v, ['libelle', 'libellelong', 'label', 'nom', 'name', 'intitule', 'code']) || '');
  }
  return String(v);
}

function findArray(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  const preferred = pick(json, ['cours', 'courses', 'data', 'items', 'results', 'value', 'seances', 'events']);
  if (Array.isArray(preferred)) return preferred;
  if (preferred && typeof preferred === 'object') return findArray(preferred);
  const anyArr = Object.values(json).find(Array.isArray);
  return anyArr || [];
}

function toDate(dateVal, timeVal) {
  if (dateVal == null) return null;
  if (typeof dateVal === 'number') return new Date(dateVal);
  const s = String(dateVal);
  if (timeVal && /^\d{1,2}[:h]\d{2}/.test(String(timeVal))) {
    const [h, m] = String(timeVal).split(/[:h]/).map(Number);
    const day = /^\d{2}\/\d{2}\/\d{4}/.test(s) ? s.split('/').reverse().join('-') : s.slice(0, 10);
    const d = new Date(day + 'T00:00:00');
    d.setHours(h, m, 0, 0);
    return d;
  }
  const fr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T]?(\d{2})?[:h]?(\d{2})?/);
  if (fr) return new Date(`${fr[3]}-${fr[2]}-${fr[1]}T${fr[4] || '00'}:${fr[5] || '00'}:00`);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/** Convertit un objet "cours" JSON en événement au format commun (même forme que l'iCal). */
function toEvent(item) {
  const day = pick(item, ['date', 'jour', 'day']);
  const start = toDate(pick(item, ['debut', 'datedebut', 'dateheuredebut', 'start', 'startdate', 'starttime', 'heuredebut']), null) ||
    toDate(day, pick(item, ['heuredebut', 'starttime']));
  const end = toDate(pick(item, ['fin', 'datefin', 'dateheurefin', 'end', 'enddate', 'endtime', 'heurefin']), null) ||
    toDate(day, pick(item, ['heurefin', 'endtime']));
  if (!start || !end) return null;

  const subject = label(pick(item, ['matiere', 'matieres', 'libellematiere', 'subject', 'libelle', 'intitule', 'nom']));
  const teachers = label(pick(item, ['enseignants', 'enseignant', 'intervenants', 'intervenant', 'professeurs', 'teachers', 'teacher']));
  const groups = pick(item, ['promotions', 'promotion', 'td', 'tds', 'groupes', 'groupe', 'publics', 'public', 'regroupements', 'groups']);
  const rooms = label(pick(item, ['salles', 'salle', 'rooms', 'room', 'lieu', 'location']));
  const type = label(pick(item, ['type', 'typecours', 'nature', 'categorie']));
  const statut = label(pick(item, ['statut', 'status', 'etat']));
  const cancelled = pick(item, ['annule', 'estannule', 'cancelled', 'canceled']) === true || /annul|cancel/i.test(statut);

  const lines = ['Matière : ' + (subject || 'Cours')];
  if (teachers) lines.push('Enseignant : ' + teachers);
  (Array.isArray(groups) ? groups : groups ? [groups] : []).forEach((g) => lines.push('Promotion : ' + label(g)));
  if (rooms) lines.push('Salle : ' + rooms);
  if (type) lines.push('Type : ' + type);

  return {
    uid: String(pick(item, ['id', 'cle', 'uid', 'identifiant', 'numero']) || ''),
    summary: subject,
    description: lines.join('\n'),
    location: rooms,
    start,
    end,
    status: cancelled ? 'CANCELLED' : 'CONFIRMED',
  };
}

async function fetchHpApi(cfg, apiKey, tz) {
  const json = await fetchJson(cfg, apiKey, tz);
  const items = findArray(json);
  return { events: items.map(toEvent).filter(Boolean), raw: items };
}

module.exports = { fetchHpApi };
