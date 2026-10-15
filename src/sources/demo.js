'use strict';

// Données de démo (recopiées des écrans actuels de Montpellier) pour tester sans l'API

const P = 'Montpellier | ';

// [début, fin, matière, enseignant, groupes, salle, extra]
const ROWS = [
  ['08:00', '12:00', 'Design Thinking & Nudge B2CPD', 'Madame JAILLON Angelique', ['CREADD B2', 'MKTCD B2'], 'Salle 106, Salle 109'],
  ['09:00', '10:00', 'Anglais 2627 B2', '', ['DIGIA B2'], ''],
  ['09:00', '10:00', 'Archi. infrastructure Data', '', ['DATAE MAST1'], ''],
  ['09:00', '10:00', 'Soft Skills B1', '', ['CYBERSEC B1', 'IADAT B1', 'INFOR B1'], 'Salle 113'],
  ['09:00', '10:30', '7Speaking BTS', '', ['BTS1 YLEVEL'], 'DISTANCIEL'],
  ['09:00', '12:00', 'Captation Son B1', 'Monsieur LEVEQUE Geoffrey', ['AVI B1'], 'Salle 107, Studio 1'],
  ['09:00', '12:00', 'Méthodologies Agile & Scrum', 'Monsieur ATTIK Mohammed', ['DEVFLSTK MAST1', 'DEVMIOT MAST1', 'IADEV MAST1'], 'Salle 305'],
  ['09:00', '13:00', 'AI Habitat - Projet 1', 'Monsieur LIEUTAUD Cyril', ['AINTMOE MAST2'], 'Salle 303 / ART'],
  ['09:00', '13:00', 'APD projet Habitat', 'Monsieur SAINT-CRICQ Frédéric', ['ARCHIN B2'], 'Salle 302 / ART'],
  ['09:00', '13:00', 'Audit SI & Analyse de Besoin', '', ['CSINFRA MAST1'], ''],
  ['09:00', '13:00', 'Culture graphique & LLMs B13D', 'Monsieur DOLATA Benjamin', ['3DTI B1'], 'Salle 101 / Anim 3D'],
  ['09:00', '13:00', 'Culture graphique B1CPD', 'Madame GEKIERE Elodie', ['CREADD B1', 'MKTCD B1', 'DIGIA B1'], 'Salle 105'],
  ['09:00', '13:00', 'Dessin technique Niv1', 'Madame COLLET Adèle', ['ARCHIN B1'], 'Salle ART 001'],
  ['09:00', '13:00', 'Écriture - Storytelling visuel B3CPA', 'Monsieur LABARONNE Arnault', ['AVI B3 CDPAVIM'], 'Salle 104'],
  ['09:00', '13:00', 'Marché, personas & valeur B3CPD', 'Madame RABAUD Soline', ['CREADD B3', 'MKTCD B3'], 'Salle 108'],
  ['09:00', '13:00', 'Physique CIEL IR BTS2', 'Monsieur ELMASRI Djamel', ['BTS2 CIEL A'], 'Salle 306'],
  ['09:00', '13:00', 'U3. Maths Info BTS2', 'Monsieur FAQUIR Mohamed', ['BTS2 SIO SISR', 'BTS2 SIO SLAM'], 'Salle 309', { modified: true }],
  ['10:30', '12:30', 'Pentest & Red Team', 'Monsieur MARTIN Hugo', ['CYBERSEC MAST2'], 'Salle 201'],
  ['14:00', '17:00', 'Projet fil rouge', 'Madame DURAND Claire', ['INFOR B2'], 'Salle 202'],
  ['14:00', '18:00', 'Motion design', 'Monsieur PETIT Lucas', ['3DTI B2'], 'Salle 101 / Anim 3D'],
  ['14:00', '16:00', 'Stratégie social media', 'Madame BERNARD Inès', ['MKTCD B3'], 'Salle 108', { cancelled: true }],
  ['14:00', '17:30', 'Machine Learning avancé', 'Monsieur ROUX Antoine', ['IADAT MAST2'], 'Salle 305'],
  ['15:30', '17:30', 'Droit du numérique', 'Madame LEROY Sarah', ['DATAE MAST1', 'CSINFRA MAST1'], 'DISTANCIEL'],
];

function at(base, hhmm, shiftMs) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return new Date(d.getTime() + shiftMs);
}

function demoEvents() {
  const now = new Date();
  // Hors des heures de cours, on décale la journée pour qu'il y ait toujours quelque chose à voir.
  let shift = 0;
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 8 || h >= 16.5) shift = now.getTime() - at(now, '10:20', 0).getTime();

  return ROWS.map((r, i) => {
    const [start, end, subject, teacher, groups, room, extra = {}] = r;
    const lines = ['Matière : ' + subject];
    if (teacher) lines.push('Enseignant : ' + teacher);
    groups.forEach((g) => lines.push('Promotion : ' + P + g));
    if (room) lines.push('Salle : ' + room);
    if (extra.cancelled) lines.push('Mémo : Cours annulé');
    return {
      uid: 'demo-' + i,
      summary: subject,
      description: lines.join('\n'),
      location: room,
      start: at(now, start, shift),
      end: at(now, end, shift),
      status: extra.cancelled ? 'CANCELLED' : 'CONFIRMED',
      _demoModified: !!extra.modified,
    };
  });
}

module.exports = { demoEvents };
