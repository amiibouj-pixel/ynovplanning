'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Valeurs nettoyées : espaces et guillemets autour (fréquent quand on colle dans un tableau de bord)
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  env[k] = typeof v === 'string' ? v.trim().replace(/^(['"])(.*)\1$/, '$2').trim() : v;
}

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT) || 3000,
  timezone: env.TZ_DISPLAY || 'Europe/Paris',

  // Sécurité admin
  adminUser: env.ADMIN_USER || 'admin',
  adminPasswordHash: env.ADMIN_PASSWORD_HASH || '',
  sessionSecret: env.SESSION_SECRET || '',
  adminAllowedIps: list(env.ADMIN_ALLOWED_IPS),
  // Render met toujours un proxy HTTPS devant l'appli (RENDER=true est fourni par Render)
  trustProxy: env.TRUST_PROXY || (env.RENDER ? '1' : false),
  // Cookie admin "Secure" (HTTPS uniquement). Mettre COOKIE_SECURE=false pour un usage en HTTP sur le réseau local.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',

  // Clé optionnelle exigée sur les URL d'écran (?key=...)
  displayKey: env.DISPLAY_KEY || '',
  // Qui a le droit d'intégrer l'écran en iframe (Emity, etc.)
  displayFrameAncestors: list(env.DISPLAY_FRAME_ANCESTORS).length
    ? list(env.DISPLAY_FRAME_ANCESTORS)
    : ['*'],

  // Dossier des réglages (sur un hébergeur : pointer vers un disque persistant)
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
};

// Dossier de données pas accessible en écriture (ex : DATA_DIR=/var/data sur Render sans disque) : on se rabat sur ./data
try {
  require('fs').mkdirSync(config.dataDir, { recursive: true });
  require('fs').accessSync(config.dataDir, require('fs').constants.W_OK);
} catch (e) {
  const fallback = path.join(__dirname, '..', 'data');
  console.warn('[config] ' + config.dataDir + ' inaccessible, réglages enregistrés dans ' + fallback + ' (perdus au redéploiement)');
  config.dataDir = fallback;
}

if (!config.sessionSecret || config.sessionSecret.length < 32) {
  // On démarre quand même (sinon tout le site tombe pour une variable oubliée), avec un secret temporaire
  config.sessionSecret = require('crypto').randomBytes(48).toString('hex');
  console.warn('[config] SESSION_SECRET absent ou trop court : secret temporaire généré (sessions admin perdues au redémarrage). '
    + 'Ajouter SESSION_SECRET dans les variables d\'environnement.');
}

// Clé de chiffrement des secrets stockés (clé API HyperPlanning). À ne jamais changer une fois en production.
config.secretsKey = env.SECRETS_KEY || config.sessionSecret;
if (!env.SECRETS_KEY) console.warn('[config] SECRETS_KEY absent : la clé API enregistrée sera illisible si SESSION_SECRET change.');
// Optionnel : clé API fournie par variable d'environnement (prioritaire sur celle saisie dans l'admin)
config.hpApiKeyEnv = env.HP_API_KEY || '';
// Connexion HyperPlanning réglée par variables (utile sur Render gratuit : les réglages de l'admin sont perdus au redéploiement)
config.hpEnv = {
  baseUrl: env.HP_URL || '',
  username: env.HP_USER || '',
  flavor: ['official', 'soap', 'generic'].includes(env.HP_TYPE) ? env.HP_TYPE : '',
};

if (!config.adminPasswordHash) {
  console.warn('[config] ADMIN_PASSWORD_HASH absent : la connexion admin est désactivée. Lancez `npm run hash-password`.');
} else if (!/^\$2[aby]\$\d\d\$.{53}$/.test(config.adminPasswordHash)) {
  console.warn('[config] ADMIN_PASSWORD_HASH ne ressemble pas à un hash bcrypt (' + config.adminPasswordHash.length + ' caractères au lieu de 60) : vérifier le copier-coller.');
}
console.log('[config] Admin : identifiant "' + config.adminUser + '", mot de passe ' + (config.adminPasswordHash ? 'configuré' : 'NON configuré'));

module.exports = config;
