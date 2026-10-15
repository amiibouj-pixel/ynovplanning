'use strict';

// Transforme les events HyperPlanning en cours affichables (niveau, filière, couleur, salle...)

// couleurs reprises du CSS de ynov.com (--c-formation-*)
// "ink" = couleur du texte posé sur l'aplat (contraste lisible de loin).
const FILIERES = [
  { key: 'bts', label: 'BTS Tech', color: '#3d68d1', ink: '#ffffff', univers: 'tech', match: /SIO|CIEL|YLEVEL|SLAM|SISR/ },
  { key: 'cyber', label: 'Cybersécurité', color: '#5affb6', ink: '#0a0006', univers: 'tech', match: /CYBER|CSINFRA/ },
  { key: 'ia', label: 'IA & Data', color: '#859cff', ink: '#0a0006', univers: 'tech', match: /^IA|DIGIA|IADAT|IADEV|DATA/ },
  { key: 'info', label: 'Informatique', color: '#5ec5ea', ink: '#0a0006', univers: 'tech', match: /INFOR|DEV/ },
  { key: 'archi', label: 'Architecture', color: '#3ca55b', ink: '#0a0006', univers: 'archi', match: /ARCHI|AINT|BIM/ },
  { key: 'audiovisuel', label: 'Audiovisuel', color: '#ffdb2d', ink: '#0a0006', univers: 'creative', match: /AVI|AUDIO/ },
  { key: '3d', label: '3D & Jeu vidéo', color: '#c259ff', ink: '#0a0006', univers: 'creative', match: /3D|ANIM|GAME/ },
  { key: 'marketing', label: 'Marketing & Com', color: '#e38338', ink: '#0a0006', univers: 'creative', match: /MKT|MARK|COM/ },
  { key: 'design', label: 'Création & Design', color: '#89dc8f', ink: '#0a0006', univers: 'creative', match: /CREA|DESIGN|UX/ },
  { key: '2d', label: 'Illustration', color: '#ff5aff', ink: '#0a0006', univers: 'creative', match: /2D|ILLU/ },
];
const DEFAULT_FILIERE = { key: 'autre', label: 'Autre', color: '#dbdbdb', ink: '#0a0006', univers: 'corpo' };

function filiereOf(program) {
  const p = (program || '').toUpperCase();
  return FILIERES.find((f) => f.match.test(p)) || DEFAULT_FILIERE;
}

/** "Montpellier | CREADD B2" -> { label, program: "CREADD", level: "B2", levelLabel: "B2" } */
function parseGroup(raw, prefix) {
  let label = String(raw || '').trim();
  if (prefix && label.toLowerCase().startsWith(prefix.toLowerCase())) {
    label = label.slice(prefix.length).trim();
  }
  label = label.replace(/^[|\-–:\s]+/, '');

  let level = null;
  let levelLabel = null;
  let rest = label;

  const rules = [
    [/\bBTS\s?([12])\b/i, (m) => ['BTS', 'BTS ' + m[1]]],
    [/\bMAST(?:ER)?\s?([12])\b/i, (m) => ['M' + m[1], 'M' + m[1]]],
    [/\bM([12])\b/, (m) => ['M' + m[1], 'M' + m[1]]],
    [/\bB([123])\b/i, (m) => ['B' + m[1], 'B' + m[1]]],
    [/\bBACHELOR\s?([123])\b/i, (m) => ['B' + m[1], 'B' + m[1]]],
  ];
  for (const [re, fn] of rules) {
    const m = label.match(re);
    if (m) {
      [level, levelLabel] = fn(m);
      rest = label.replace(re, ' ');
      break;
    }
  }
  if (!level && /\bBTS\b/i.test(label)) {
    level = 'BTS';
    levelLabel = 'BTS';
    rest = label.replace(/\bBTS\b/i, ' ');
  }

  const program = rest.replace(/\s+/g, ' ').trim() || label;
  const filiere = filiereOf(program);
  return {
    label, program, level, levelLabel,
    filiere: filiere.key, filiereLabel: filiere.label, univers: filiere.univers, color: filiere.color, ink: filiere.ink,
  };
}

/** "Monsieur LEVEQUE Geoffrey" -> "Geoffrey Leveque" (plus court et plus lisible à distance) */
function formatTeacher(raw) {
  if (!raw) return '';
  const cap = (w) => w.toLowerCase().replace(/(^|[-\s'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  return String(raw)
    .split(/\s*[,;]\s*/)
    .map((one) => {
      const civ = (one.match(/^(Monsieur|Madame|M\.|Mme|Mr)\s+/i) || [])[1] || '';
      const parts = one.replace(/^(Monsieur|Madame|M\.|Mme|Mr)\s+/i, '').trim().split(/\s+/);
      const upper = parts.filter((w) => w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w));
      const others = parts.filter((w) => !upper.includes(w));
      // Nom seul (export iCal : "Madame RABAUD") -> "Mme Rabaud"
      if (!others.length && upper.length) {
        const short = /^madame|^mme/i.test(civ) ? 'Mme ' : civ ? 'M. ' : '';
        return short + upper.map(cap).join(' ');
      }
      if (!upper.length) return parts.join(' ');
      return others.join(' ') + ' ' + upper.map(cap).join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

/** "Salle 107 / Studio 1" ou "Salle 106, Salle 109" -> ["107", "Studio 1"] */
function parseRooms(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\s*(?:,|;|\n)\s*/)
    .map((r) => r.replace(/^Salle\s+/i, '').replace(/\.$/, '').trim())
    .filter(Boolean);
}

const REMOTE_RE = /DISTANCIEL|DISTANCE|REMOTE|EN LIGNE|VISIO|TEAMS|ZOOM|^EAD/i;

/**
 * HyperPlanning met les infos dans DESCRIPTION sous forme "Clé : valeur" (une par ligne).
 * Selon la configuration de l'export, les clés varient : on accepte les variantes courantes.
 */
function parseDescription(desc) {
  const out = {};
  String(desc || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^\s*([^:]{2,30}?)\s*:\s*(.+)$/);
      if (!m) return;
      const key = m[1]
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\(s\)|s$/g, '')
        .trim();
      const val = m[2].trim();
      const map = {
        matiere: 'subject',
        enseignant: 'teacher',
        intervenant: 'teacher',
        professeur: 'teacher',
        promotion: 'groups',
        classe: 'groups', // export iCal Ynov : "Classes : Montpellier | CREADD B3, ..."
        td: 'groups',
        groupe: 'groups',
        public: 'groups',
        salle: 'rooms',
        type: 'type',
        memo: 'note',
        remarque: 'note',
      };
      const field = map[key];
      if (field) out[field] = out[field] ? out[field] + ', ' + val : val;
    });
  return out;
}

// Les exports HyperPlanning ont des propriétés avec paramètres (SUMMARY;LANGUAGE=fr:...) :
// node-ical les renvoie alors sous forme { params, val }.
function txt(v) {
  if (v && typeof v === 'object' && 'val' in v) return String(v.val);
  return v == null ? '' : String(v);
}

function toCourse(ev, settings) {
  ev = { ...ev, summary: txt(ev.summary), description: txt(ev.description), location: txt(ev.location) };
  const d = parseDescription(ev.description);
  const summaryParts = String(ev.summary || '').split(/\s+-\s+/);

  const subject = d.subject || summaryParts[0] || 'Cours';
  const teacher = formatTeacher(d.teacher || '');
  const roomsRaw = d.rooms || ev.location || '';
  const groupsRaw = d.groups ? d.groups.split(/\s*,\s*/) : [];

  const remote = REMOTE_RE.test(roomsRaw) || REMOTE_RE.test(d.type || '');
  const rooms = remote ? [] : parseRooms(roomsRaw);
  const cancelled =
    String(ev.status || '').toUpperCase() === 'CANCELLED' || /annul/i.test(ev.summary || '') || /annul/i.test(d.note || '');

  return {
    uid: String(ev.uid || ''),
    start: new Date(ev.start).toISOString(),
    end: new Date(ev.end).toISOString(),
    subject: subject.trim(),
    type: d.type || '',
    teacher,
    groups: groupsRaw.map((g) => parseGroup(g, settings.groupPrefix)),
    rooms,
    remote,
    cancelled,
  };
}

module.exports = { toCourse };
