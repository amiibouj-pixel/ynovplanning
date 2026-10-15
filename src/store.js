'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const secrets = require('./secrets');

const FILE = path.join(config.dataDir, 'settings.json');

const LEVELS = ['B1', 'B2', 'B3', 'M1', 'M2', 'BTS'];

const DEFAULTS = {
  campusName: 'Montpellier',
  // Préfixe retiré des noms de groupe HyperPlanning ("Montpellier | CREADD B2" -> "CREADD B2")
  groupPrefix: 'Montpellier |',
  demoMode: true,
  // Connexion principale : API HyperPlanning avec clé API (chiffrée sur disque, jamais renvoyée au navigateur)
  hpApi: {
    enabled: false,
    flavor: 'official', // official = API REST PRONOTE Campus / HyperPlanning ; soap = Service Web SOAP (WSDL) ; generic = autre API JSON
    baseUrl: 'https://hp26.ynov.com/MON/hpsw/api/v1/', // Service Web REST HyperPlanning d'Ynov
    coursesPath: '/api/rest/cours?dateDebut={date}&dateFin={date}',
    authMode: 'basic', // bearer | header | basic | query (API officielle : basic)
    headerName: 'X-API-Key',
    username: '',
    apiKeyEnc: '',
  },
  sources: [], // [{ name, url }] : exports iCal HyperPlanning (solution de repli)
  refreshMinutes: 2,
  pageSeconds: 12,
  rowsPerPage: 6,
  modifiedBadgeHours: 3,
  theme: 'light', // 'light' = DA ynov.com (fond menthe, défaut), 'dark' = fond noir
  announcement: { enabled: false, text: '', tone: 'info' },
  screens: [
    { id: 'general', name: 'Hall, tous les cours', levels: LEVELS.slice() },
  ],
};

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v, max, fallback) {
  if (typeof v !== 'string') return fallback;
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function validUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function slug(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Valide et normalise un objet de réglages venant du back-office (liste blanche stricte). */
function sanitize(input, current) {
  const base = current || DEFAULTS;
  const s = {};
  s.campusName = str(input.campusName, 60, base.campusName) || base.campusName;
  s.groupPrefix = str(input.groupPrefix, 60, base.groupPrefix);
  s.demoMode = typeof input.demoMode === 'boolean' ? input.demoMode : base.demoMode;
  s.refreshMinutes = clampInt(input.refreshMinutes, 1, 120, base.refreshMinutes);
  s.pageSeconds = clampInt(input.pageSeconds, 5, 120, base.pageSeconds);
  s.rowsPerPage = clampInt(input.rowsPerPage, 3, 10, base.rowsPerPage);
  s.modifiedBadgeHours = clampInt(input.modifiedBadgeHours, 0, 48, base.modifiedBadgeHours);

  s.theme = input.theme === 'dark' ? 'dark' : input.theme === 'light' ? 'light' : base.theme;

  const hp = input.hpApi || {};
  const prevHp = base.hpApi || DEFAULTS.hpApi;
  s.hpApi = {
    enabled: typeof hp.enabled === 'boolean' ? hp.enabled : prevHp.enabled,
    flavor: ['official', 'soap', 'generic'].includes(hp.flavor) ? hp.flavor : prevHp.flavor || 'official',
    baseUrl: hp.baseUrl !== undefined ? (validUrl(hp.baseUrl) ? str(hp.baseUrl, 500, '') : '') : prevHp.baseUrl,
    coursesPath: hp.coursesPath !== undefined ? str(hp.coursesPath, 500, prevHp.coursesPath) : prevHp.coursesPath,
    authMode: ['bearer', 'header', 'basic', 'query'].includes(hp.authMode) ? hp.authMode : prevHp.authMode,
    headerName: hp.headerName !== undefined ? str(hp.headerName, 60, '').replace(/[^A-Za-z0-9_-]/g, '') : prevHp.headerName,
    username: hp.username !== undefined ? str(hp.username, 120, '') : prevHp.username,
    apiKeyEnc: prevHp.apiKeyEnc || '',
  };
  // La clé API n'est modifiée que si une nouvelle valeur est saisie (champ "écriture seule")
  if (typeof hp.apiKey === 'string' && hp.apiKey.trim()) s.hpApi.apiKeyEnc = secrets.encrypt(hp.apiKey.trim().slice(0, 1000));
  if (hp.clearApiKey === true) s.hpApi.apiKeyEnc = '';
  // Restaurée depuis le disque : on garde la valeur chiffrée telle quelle
  if (typeof hp.apiKeyEnc === 'string' && hp.apiKeyEnc && !current) s.hpApi.apiKeyEnc = hp.apiKeyEnc;

  const sources = Array.isArray(input.sources) ? input.sources : base.sources;
  s.sources = sources
    .slice(0, 50)
    .map((src) => ({ name: str(src && src.name, 60, ''), url: str(src && src.url, 2000, '') }))
    .filter((src) => src.url && validUrl(src.url));

  const ann = input.announcement || base.announcement;
  s.announcement = {
    enabled: !!ann.enabled,
    text: str(ann.text, 280, ''),
    tone: ann.tone === 'alert' ? 'alert' : 'info',
  };

  const screens = Array.isArray(input.screens) ? input.screens : base.screens;
  const seen = new Set();
  s.screens = screens
    .slice(0, 30)
    .map((sc) => ({
      id: slug(sc && sc.id) || slug(sc && sc.name),
      name: str(sc && sc.name, 60, 'Écran'),
      levels: (Array.isArray(sc && sc.levels) ? sc.levels : LEVELS).filter((l) => LEVELS.includes(l)),
    }))
    .filter((sc) => sc.id && !seen.has(sc.id) && seen.add(sc.id));
  if (!s.screens.length) s.screens = DEFAULTS.screens;

  return s;
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cache = sanitize(raw); // sans "current" : restauration depuis le disque (garde la clé chiffrée)
  } catch (e) {
    cache = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return cache;
}

function save(input) {
  const next = sanitize(input, load());
  fs.mkdirSync(config.dataDir, { recursive: true });
  // Écriture atomique : fichier temporaire puis renommage
  const tmp = FILE + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  cache = next;
  return next;
}

/** Réglages renvoyés au back-office : jamais la clé API, seulement l'information "configurée". */
function publicSettings() {
  const s = JSON.parse(JSON.stringify(load()));
  s.hpApi.apiKeySet = !!s.hpApi.apiKeyEnc || !!config.hpApiKeyEnv;
  s.hpApi.apiKeyFromEnv = !!config.hpApiKeyEnv;
  delete s.hpApi.apiKeyEnc;
  return s;
}

function hpApiKey() {
  return config.hpApiKeyEnv || secrets.decrypt(load().hpApi.apiKeyEnc);
}

module.exports = { load, save, publicSettings, hpApiKey, LEVELS };
