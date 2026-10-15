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
  trustProxy: env.TRUST_PROXY || false,
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

if (!config.sessionSecret || config.sessionSecret.length < 32) {
  if (config.isProd) {
    throw new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum).');
  }
  config.sessionSecret = require('crypto').randomBytes(48).toString('hex');
  console.warn('[config] SESSION_SECRET absent : secret temporaire généré (sessions perdues au redémarrage).');
}

// Clé de chiffrement des secrets stockés (clé API HyperPlanning). À ne jamais changer une fois en production.
config.secretsKey = env.SECRETS_KEY || config.sessionSecret;
// Optionnel : clé API fournie par variable d'environnement (prioritaire sur celle saisie dans l'admin)
config.hpApiKeyEnv = env.HP_API_KEY || '';

if (!config.adminPasswordHash) {
  console.warn('[config] ADMIN_PASSWORD_HASH absent : la connexion admin est désactivée. Lancez `npm run hash-password`.');
}

module.exports = config;
