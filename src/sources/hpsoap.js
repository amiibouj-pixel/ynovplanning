'use strict';

// Service Web SOAP HyperPlanning, même logique que php/lib/soap.php (voir les commentaires là-bas).

const TIMEOUT_MS = 20000;
const MAX_COURSES = 400;
const NAMES_TTL_MS = 60 * 60 * 1000;

const ROLES = {
  listRange: ['CoursEntre2Dates', 'CoursEntreDeuxDates', 'TableauDeCoursEntre2Dates', 'SeancesEntre2Dates', 'SeancesEntreDeuxDates', 'CoursPlacesEntre2Dates'],
  cancelledRange: ['CoursAnnulesEntre2Dates', 'CoursAnnulesEntreDeuxDates', 'SeancesAnnuleesEntre2Dates'],
  listAll: ['TousLesCours'],
  start: ['DateEtHeureDebutCours', 'DateHeureDebutCours', 'DebutCours', 'JourEtHeureDebutCours', 'DateDebutCours', 'HeureDebutCours'],
  end: ['DateEtHeureFinCours', 'DateHeureFinCours', 'FinCours', 'DateFinCours', 'HeureFinCours'],
  duration: ['DureeCours', 'DureeDuCours'],
  subject: ['MatiereDuCours', 'MatiereCours'],
  rooms: ['SallesDuCours', 'SallesCours'],
  promotions: ['PromotionsDuCours', 'PromotionsCours'],
  tdoptions: ['TDOptionsDuCours', 'TDOptionsCours'],
  teachers: ['EnseignantsDuCours', 'EnseignantsCours'],
  cancelled: ['EstAnnuleCours', 'CoursEstAnnule', 'CoursAnnule'],
  subjectName: ['LibelleLongMatiere', 'LibelleMatiere', 'NomMatiere'],
  roomName: ['NomSalle', 'LibelleSalle'],
  promotionName: ['NomPromotion', 'LibellePromotion'],
  tdoptionName: ['NomTDOption', 'LibelleTDOption'],
  teacherName: ['NomEnseignant'],
  teacherFirstName: ['PrenomEnseignant'],
};

const wsdlCache = { url: '', at: 0, data: null };
const namesCache = { url: '', at: 0, byRole: {} };

/* ---------- Mini-parseur XML (suffisant pour WSDL et réponses SOAP) ---------- */

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function parseXml(text) {
  const root = { name: '#root', local: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s>/]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[3]) {
      if (m[2] === '/') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs = {};
      (m[4] || '').replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (x, k, v, a, b) => (attrs[k] = decode(a !== undefined ? a : b)));
      const el = { name: m[3], local: m[3].replace(/^.*:/, ''), attrs, children: [], text: '' };
      top.children.push(el);
      if (m[5] !== '/') stack.push(el);
    }
  }
  return root;
}

function all(el, local, out = []) {
  el.children.forEach((c) => {
    if (c.local === local) out.push(c);
    all(c, local, out);
  });
  return out;
}

function attrLocal(el, local) {
  const k = Object.keys(el.attrs).find((a) => a.replace(/^.*:/, '') === local);
  return k ? el.attrs[k] : '';
}

/* ---------- WSDL ---------- */

function authHeader(cfg, secret) {
  return 'Basic ' + Buffer.from((cfg.username || '') + ':' + secret).toString('base64');
}

async function httpFetch(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'HyperPlanning ne répond pas (délai dépassé)' : 'HyperPlanning injoignable (' + e.message + ')');
  } finally {
    clearTimeout(timer);
  }
}

async function loadWsdl(cfg, secret, force) {
  const url = cfg.baseUrl || '';
  if (!url) throw new Error('Adresse du WSDL manquante (ex. https://.../hpsw/wsdl/RpcEncoded)');
  if (!secret) throw new Error('Mot de passe du Service Web manquant');
  if (!force && wsdlCache.url === url && Date.now() - wsdlCache.at < NAMES_TTL_MS) return wsdlCache.data;

  const res = await httpFetch(url, { headers: { Accept: 'text/xml, application/xml', Authorization: authHeader(cfg, secret) } });
  if (res.status === 401 || res.status === 403) throw new Error('Identifiant ou mot de passe refusés par HyperPlanning (HTTP ' + res.status + ')');
  if (!res.ok) throw new Error('WSDL introuvable (HTTP ' + res.status + ') : vérifiez l\'adresse .../hpsw/wsdl/RpcEncoded');
  const doc = parseXml(await res.text());
  const defs = all(doc, 'definitions')[0];
  if (!defs) throw new Error('La réponse n\'est pas un WSDL : vérifiez l\'adresse (elle se termine en général par /hpsw/wsdl/RpcEncoded)');

  const tns = defs.attrs.targetNamespace || '';
  const messages = {};
  all(defs, 'message').forEach((m) => {
    messages[m.attrs.name] = all(m, 'part').map((p) => ({ name: p.attrs.name, type: String(p.attrs.type || p.attrs.element || '').replace(/^.*:/, '') }));
  });
  const ops = {};
  all(defs, 'portType').forEach((pt) =>
    pt.children.filter((c) => c.local === 'operation').forEach((op) => {
      const input = op.children.find((c) => c.local === 'input');
      const msg = input ? String(input.attrs.message || '').replace(/^.*:/, '') : '';
      ops[op.attrs.name] = { params: messages[msg] || [], action: '', ns: tns };
    })
  );
  let literal = false;
  all(defs, 'binding').forEach((b) =>
    b.children.filter((c) => c.local === 'operation').forEach((op) => {
      const o = ops[op.attrs.name];
      if (!o) return;
      const soapOp = op.children.find((c) => c.local === 'operation');
      if (soapOp && soapOp.attrs.soapAction) o.action = soapOp.attrs.soapAction;
      const body = all(op, 'body')[0];
      if (body) {
        literal = literal || body.attrs.use === 'literal';
        if (body.attrs.namespace) o.ns = body.attrs.namespace;
      }
    })
  );
  const addr = all(defs, 'address').find((a) => a.attrs.location);
  let endpoint = addr ? addr.attrs.location : url.replace(/\/wsdl\/.*$/i, '/soap/');
  // Le WSDL annonce parfois une adresse interne : on garde l'hôte saisi dans le back-office
  try {
    const given = new URL(url);
    const ep = new URL(endpoint, url);
    if (ep.host !== given.host) endpoint = given.protocol + '//' + given.host + ep.pathname + ep.search;
    else endpoint = ep.href;
  } catch (e) {
    /* adresse laissée telle quelle */
  }
  const data = { endpoint, literal, ops };
  Object.assign(wsdlCache, { url, at: Date.now(), data });
  return data;
}

function resolve(wsdl) {
  const byLower = {};
  Object.keys(wsdl.ops).forEach((n) => (byLower[n.toLowerCase()] = n));
  const found = {};
  Object.keys(ROLES).forEach((role) => {
    const hit = ROLES[role].find((c) => byLower[c.toLowerCase()]);
    if (hit) found[role] = byLower[hit.toLowerCase()];
  });
  return found;
}

/* ---------- Appels ---------- */

function xsdType(type) {
  const t = String(type).toLowerCase();
  if (['int', 'integer', 'long', 'short', 'byte', 'unsignedint', 'unsignedlong'].includes(t)) return 'xsd:int';
  if (['double', 'float', 'decimal'].includes(t)) return 'xsd:double';
  if (t === 'boolean') return 'xsd:boolean';
  if (t === 'datetime') return 'xsd:dateTime';
  if (t === 'date') return 'xsd:date';
  return 'xsd:string';
}

function dateArg(ymd, type, endOfDay) {
  const t = String(type).toLowerCase();
  if (t === 'date') return ymd;
  if (['double', 'float', 'decimal'].includes(t)) {
    const days = (Date.parse(ymd + 'T00:00:00Z') - Date.parse('1899-12-30T00:00:00Z')) / 86400000;
    return endOfDay ? days + 0.99999 : days;
  }
  return ymd + (endOfDay ? 'T23:59:59' : 'T00:00:00');
}

function xmlEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function envelope(wsdl, op, args) {
  const def = wsdl.ops[op];
  const encoded = !wsdl.literal;
  const params = def.params
    .slice(0, args.length)
    .map((p, i) => '<' + p.name + (encoded ? ' xsi:type="' + xsdType(p.type) + '"' : '') + '>' + xmlEsc(args[i]) + '</' + p.name + '>')
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/"' +
    (encoded ? ' soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"' : '') + '>' +
    '<soap:Body><ns:' + op + ' xmlns:ns="' + xmlEsc(def.ns) + '">' + params + '</ns:' + op + '></soap:Body></soap:Envelope>'
  );
}

function value(el, ids) {
  if (el.attrs.href) {
    const ref = ids[el.attrs.href.replace(/^#/, '')];
    return ref ? value(ref, ids) : null;
  }
  if (!el.children.length) return attrLocal(el, 'nil') === 'true' ? null : el.text.trim();
  const names = new Set(el.children.map((c) => c.local));
  const first = [...names][0].toLowerCase();
  const isList = (names.size === 1 && el.children.length > 1) || first === 'item' || first === 'return' || attrLocal(el, 'arrayType').includes('[');
  if (isList) return el.children.map((c) => value(c, ids));
  const out = {};
  el.children.forEach((c) => (out[c.local] = value(c, ids)));
  return out;
}

function parseResponse(text, op) {
  const doc = parseXml(text);
  const fault = all(doc, 'Fault')[0];
  if (fault) {
    const fs = all(fault, 'faultstring')[0];
    throw new Error('HyperPlanning (' + op + ') : ' + (fs ? fs.text : 'erreur SOAP').trim());
  }
  const ids = {};
  (function walk(el) {
    el.children.forEach((c) => {
      if (c.attrs.id) ids[c.attrs.id] = c;
      walk(c);
    });
  })(doc);
  const body = all(doc, 'Body')[0];
  if (!body) throw new Error('Réponse SOAP illisible pour ' + op);
  const resp = body.children.find((c) => !c.attrs.id);
  if (!resp || !resp.children.length) return null;
  return value(resp.children[0], ids);
}

async function call(cfg, secret, wsdl, op, args = []) {
  const def = wsdl.ops[op];
  const res = await httpFetch(wsdl.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '"' + (def.action || def.ns + '#' + op) + '"',
      Authorization: authHeader(cfg, secret),
    },
    body: envelope(wsdl, op, args),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Identifiant ou mot de passe refusés par HyperPlanning (HTTP ' + res.status + ')');
  return parseResponse(await res.text(), op);
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

/* ---------- Interprétation ---------- */

function list(v) {
  if (v == null || v === '') return [];
  if (!Array.isArray(v)) return typeof v === 'object' ? Object.values(v).flatMap(list) : [v];
  return v.flatMap(list);
}

function soapTime(v) {
  const s = list(v)[0];
  if (s == null || s === '') return null;
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 10000) {
    // TDateTime = jours depuis le 30/12/1899. On calcule en UTC puis on relit comme une heure locale.
    const u = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s) * 1440) * 60000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
  }
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{1,2})[:h](\d{2}))?/.exec(s);
  if (fr) return new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]), Number(fr[4] || 0), Number(fr[5] || 0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function duration(v) {
  const s = list(v)[0];
  const hm = /^(\d{1,2})[:h](\d{2})/.exec(String(s || ''));
  if (hm) return (Number(hm[1]) * 60 + Number(hm[2])) * 60000;
  const n = Number(s);
  if (!(n > 0)) return 0;
  if (n < 1) return Math.round(n * 1440) * 60000; // fraction de jour, arrondie à la minute
  if (n <= 12) return Math.round(n * 3600000);
  return Math.round(n * 60000);
}

function todayISO(tz) {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
    .reduce((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

/* ---------- Cours du jour ---------- */

async function names(cfg, secret, wsdl, ops, role, keys) {
  const cache = (namesCache.byRole[role] = namesCache.byRole[role] || {});
  const missing = [...new Set(keys)].filter((k) => !(k in cache));
  if (ops[role] && missing.length) {
    await mapLimit(missing, 8, async (k) => {
      let name = String(list(await call(cfg, secret, wsdl, ops[role], [k]))[0] || '').trim();
      if (role === 'teacherName') {
        const first = ops.teacherFirstName ? String(list(await call(cfg, secret, wsdl, ops.teacherFirstName, [k]))[0] || '').trim() : '';
        name = [first, name.toUpperCase()].filter(Boolean).join(' ');
      }
      cache[k] = name;
    });
  }
  return cache;
}

async function fetchHpSoap(cfg, secret, tz, opts) {
  const force = !!(opts && opts.force);
  const wsdl = await loadWsdl(cfg, secret, force);
  const ops = resolve(wsdl);
  const available = Object.keys(wsdl.ops);
  if (!ops.start && !ops.listRange) {
    throw new Error('Opérations attendues introuvables dans le WSDL (cours d\'une période, horaires). Opérations disponibles : ' + available.slice(0, 80).join(', '));
  }
  const day = todayISO(tz);
  const dayStart = new Date(day + 'T00:00:00').getTime();
  const dayEnd = dayStart + 86400000;

  let keys;
  let cancelledKeys = [];
  if (ops.listRange) {
    const p = wsdl.ops[ops.listRange].params;
    keys = list(await call(cfg, secret, wsdl, ops.listRange, [dateArg(day, (p[0] || {}).type || 'dateTime', false), dateArg(day, (p[1] || {}).type || 'dateTime', true)]));
    if (ops.cancelledRange) {
      const pc = wsdl.ops[ops.cancelledRange].params;
      cancelledKeys = list(
        await call(cfg, secret, wsdl, ops.cancelledRange, [dateArg(day, (pc[0] || {}).type || 'dateTime', false), dateArg(day, (pc[1] || {}).type || 'dateTime', true)]).catch(() => [])
      );
    }
  } else {
    keys = list(await call(cfg, secret, wsdl, ops.listAll));
    if (keys.length > MAX_COURSES) {
      throw new Error(keys.length + ' cours renvoyés sans filtre de date : trop pour être lus à chaque synchronisation. Il faut une opération "cours entre deux dates" (opérations disponibles : ' + available.slice(0, 80).join(', ') + ')');
    }
  }
  keys = [...new Set(keys.concat(cancelledKeys))];
  const cancelledSet = new Set(cancelledKeys.map(String));

  const get = (role, k) => (ops[role] ? call(cfg, secret, wsdl, ops[role], [k]) : Promise.resolve(null));
  const timed = await mapLimit(keys, 8, async (k) => {
    const [s, e, d] = [await get('start', k), await get('end', k), await get('duration', k)];
    const start = soapTime(s);
    if (!start) return null;
    let end = e != null ? soapTime(e) : null;
    if (!end || end <= start) end = new Date(start.getTime() + (duration(d) || 3600000));
    if (end.getTime() <= dayStart || start.getTime() >= dayEnd) return null;
    return { key: k, start, end };
  });
  const courses = timed.filter(Boolean);

  await mapLimit(courses, 8, async (c) => {
    for (const role of ['subject', 'rooms', 'promotions', 'tdoptions', 'teachers', 'cancelled']) c[role] = list(await get(role, c.key));
  });

  if (force || namesCache.url !== cfg.baseUrl || Date.now() - namesCache.at > NAMES_TTL_MS) Object.assign(namesCache, { url: cfg.baseUrl, at: Date.now(), byRole: {} });
  const collect = (f) => courses.flatMap((c) => c[f] || []);
  const dict = {
    subject: await names(cfg, secret, wsdl, ops, 'subjectName', collect('subject')),
    rooms: await names(cfg, secret, wsdl, ops, 'roomName', collect('rooms')),
    promotions: await names(cfg, secret, wsdl, ops, 'promotionName', collect('promotions')),
    tdoptions: await names(cfg, secret, wsdl, ops, 'tdoptionName', collect('tdoptions')),
    teachers: await names(cfg, secret, wsdl, ops, 'teacherName', collect('teachers')),
  };
  const label = (arr, d) => (arr || []).map((x) => dict[d][x] || (/^\d+$/.test(String(x)) ? '' : String(x))).filter(Boolean);

  const events = courses.map((c) => {
    const subject = label(c.subject, 'subject')[0] || 'Cours';
    const rooms = label(c.rooms, 'rooms');
    const groups = label(c.promotions, 'promotions').concat(label(c.tdoptions, 'tdoptions'));
    const teachers = label(c.teachers, 'teachers');
    const flag = String((c.cancelled || [])[0] || '').toLowerCase();
    const isCancelled = cancelledSet.has(String(c.key)) || flag === 'true' || flag === '1';
    const lines = ['Matière : ' + subject];
    if (teachers.length) lines.push('Enseignant : ' + teachers.join(', '));
    groups.forEach((g) => lines.push('Promotion : ' + g));
    if (rooms.length) lines.push('Salle : ' + rooms.join(', '));
    return {
      uid: 'hpsoap-' + c.key + '-' + c.start.getTime(),
      summary: subject,
      description: lines.join('\n'),
      location: rooms.join(', '),
      start: c.start,
      end: c.end,
      status: isCancelled ? 'CANCELLED' : 'CONFIRMED',
    };
  });
  return { events, raw: [{ operations: ops, cours: keys.length }], operations: ops, available };
}

module.exports = { fetchHpSoap };
