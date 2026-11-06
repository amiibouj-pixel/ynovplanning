'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env;

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
  if (config.isProd) {
    throw new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum).');
  }
  config.sessionSecret = require('crypto').randomBytes(48).toString('hex');
  console.warn('[config] SESSION_SECRET absent : secret temporaire généré (sessions perdues au redémarrage).');
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
}

module.exports = config;
