'use strict';

/**
 * Connecteur officiel : API REST PRONOTE Campus / HYPERPLANNING (Index Education).
 * Spécification : https://www.index-education.com/FichiersExternes/campus/2026/fr/OpenAPIRestPC.yaml
 *
 * - Base : https://<serveur>/hpsw/api/v1/
 * - Authentification : HTTP Basic (utilisateur "Service Web" + mot de passe / clé)
 * - Séances du jour : GET cours/detail_seances_placees?date_debut=AAAA-MM-JJ&date_fin=AAAA-MM-JJ
 *   → renvoie des CLÉS (matière, salles, promotions…) qu'on traduit en noms via les référentiels.
 * - Durée exprimée en jours (0.125 = 3 h). jour_heure_debut sans fuseau = heure locale de l'établissement.
 * - Pas de notification de modification côté HyperPlanning : on interroge régulièrement
 *   et la détection des changements se fait dans schedule.js.
 */

const TIMEOUT_MS = 20000;
const REF_TTL_MS = 60 * 60 * 1000; // référentiels (matières, salles…) rechargés toutes les heures
const CANCEL_TTL_MS = 30 * 60 * 1000; // détail des cours annulés rechargé toutes les 30 min
const MAX_CANCEL_FETCH = 60; // requêtes "cours annulés" max par synchronisation

const refs = { at: 0, base: '', matieres: {}, salles: {}, groupes: {}, enseignants: {} };
const cancelled = { at: 0, base: '', byKey: new Map() }; // cle -> séances

function todayISO(tz) {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
    .reduce((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

function client(cfg, secret) {
  if (!cfg.baseUrl) throw new Error('Adresse du Service Web manquante (ex. https://…/hpsw/api/v1/)');
  if (!secret) throw new Error('Mot de passe / clé du Service Web manquant');
  const base = cfg.baseUrl.replace(/\/?$/, '/');
  const auth = 'Basic ' + Buffer.from((cfg.username || '') + ':' + secret).toString('base64');

  return async function get(path, query) {
    const url = new URL(path, base);
    Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, Array.isArray(v) ? v.join(',') : v));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual', headers: { Accept: 'application/json', Authorization: auth } });
      // Le Service Web redirige vers sa page d'accueil quand l'accès est refusé
      if (res.status >= 300 && res.status < 400) throw new Error('Accès refusé par HyperPlanning : clé ou identifiant incorrect, ou API REST non activée sur le Service Web');
      if (res.status === 401 || res.status === 403) throw new Error('Identifiant ou clé refusés par HyperPlanning (HTTP ' + res.status + ')');
      if (res.status === 404) throw new Error('Ressource introuvable : ' + path + ' (vérifiez l’adresse …/hpsw/api/v1/)');
      if (!res.ok) throw new Error('HyperPlanning a répondu HTTP ' + res.status + ' sur ' + path);
      const type = res.headers.get('content-type') || '';
      if (!/json/i.test(type)) throw new Error('Accès refusé par HyperPlanning : clé ou identifiant incorrect, ou API REST non activée sur le Service Web');
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('HyperPlanning ne répond pas (délai dépassé)');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}

function index(list, label) {
  const out = {};
  (Array.isArray(list) ? list : []).forEach((x) => (out[x.cle] = label(x)));
  return out;
}

async function loadRefs(get, base, force) {
  if (!force && refs.base === base && Date.now() - refs.at < REF_TTL_MS) return;
  const [matieres, salles, promotions, tdoptions, regroupements, enseignants] = await Promise.all([
    get('matieres', { select: ['cle', 'libelle', 'libelle_long'] }),
    get('salles', { select: ['cle', 'nom'] }),
    get('promotions', { select: ['cle', 'nom'] }),
    get('tdoptions', { select: ['cle', 'nom'] }).catch(() => []),
    get('regroupements', { select: ['cle', 'nom'] }).catch(() => []),
    get('enseignants', { select: ['cle', 'nom', 'prenom'] }),
  ]);
  refs.matieres = index(matieres, (m) => m.libelle_long || m.libelle);
  refs.salles = index(salles, (s) => s.nom);
  refs.groupes = {
    p: index(promotions, (p) => p.nom),
    t: index(tdoptions, (t) => t.nom),
    r: index(regroupements, (r) => r.nom),
  };
  refs.enseignants = index(enseignants, (e) => [e.prenom, String(e.nom || '').toUpperCase()].filter(Boolean).join(' '));
  refs.base = base;
  refs.at = Date.now();
}

/** Séance HyperPlanning -> événement au format commun (même forme que l'iCal). */
function toEvent(s, isCancelled) {
  const start = new Date(s.jour_heure_debut); // sans fuseau = heure locale (TZ du serveur = Europe/Paris)
  if (isNaN(start)) return null;
  const end = new Date(start.getTime() + Math.round(Number(s.duree || 0) * 1440) * 60000);
  const names = (keys, dict) => (keys || []).map((k) => dict[k]).filter(Boolean);
  const subject = refs.matieres[s.matiere] || 'Cours';
  const groups = [].concat(names(s.promotions, refs.groupes.p), names(s.tdoptions, refs.groupes.t), names(s.regroupements, refs.groupes.r));
  const rooms = names(s.salles, refs.salles);
  const teachers = names(s.enseignants, refs.enseignants);

  const lines = ['Matière : ' + subject];
  if (teachers.length) lines.push('Enseignant : ' + teachers.join(', '));
  groups.forEach((g) => lines.push('Promotion : ' + g));
  if (rooms.length) lines.push('Salle : ' + rooms.join(', '));
  if (s.type) lines.push('Type : ' + s.type);

  const key = s.cle != null ? s.cle : s.cle_cours;
  return {
    uid: (isCancelled ? 'hp-annule-' : 'hp-') + key + '-' + s.jour_heure_debut,
    summary: subject,
    description: lines.join('\n'),
    location: rooms.join(', '),
    start,
    end,
    status: isCancelled ? 'CANCELLED' : 'CONFIRMED',
  };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

/** Cours annulés du jour : la liste n'a pas de filtre par date, on met en cache le détail de chaque cours annulé. */
async function cancelledToday(get, base, day) {
  if (cancelled.base !== base || Date.now() - cancelled.at > CANCEL_TTL_MS) {
    cancelled.byKey.clear();
    cancelled.base = base;
    cancelled.at = Date.now();
  }
  const list = await get('cours_annules', { select: ['cle'] }).catch(() => []);
  const keys = (Array.isArray(list) ? list : []).map((c) => c.cle).filter((k) => !cancelled.byKey.has(k));
  await mapLimit(keys.slice(0, MAX_CANCEL_FETCH), 4, async (k) => {
    const seances = await get('cours_annules/' + k + '/detail_seances_placees').catch(() => []);
    cancelled.byKey.set(k, Array.isArray(seances) ? seances : []);
  });
  const today = [];
  cancelled.byKey.forEach((seances) => seances.forEach((s) => String(s.jour_heure_debut || '').startsWith(day) && today.push(s)));
  return today;
}

async function fetchHpOfficial(cfg, secret, tz, opts) {
  const get = client(cfg, secret);
  const base = cfg.baseUrl;
  const day = todayISO(tz);
  await loadRefs(get, base, opts && opts.forceRefs);

  const seances = await get('cours/detail_seances_placees', { date_debut: day, date_fin: day });
  // Clé inconnue (matière/salle créée dans la journée) : on recharge les référentiels une fois
  const unknown = (seances || []).some((s) => s.matiere && !refs.matieres[s.matiere]);
  if (unknown && !(opts && opts.forceRefs)) await loadRefs(get, base, true);

  const annules = await cancelledToday(get, base, day);
  const events = (seances || []).map((s) => toEvent(s, false)).concat(annules.map((s) => toEvent(s, true))).filter(Boolean);
  return { events, raw: seances || [] };
}

module.exports = { fetchHpOfficial };
