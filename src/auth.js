'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Hash factice pour garder un temps de réponse constant même si l'identifiant est faux
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

async function checkCredentials(user, password) {
  if (!config.adminPasswordHash) return false;
  const userOk = safeEqual(user || '', config.adminUser);
  const passOk = await bcrypt.compare(String(password || ''), userOk ? config.adminPasswordHash : DUMMY_HASH);
  return userOk && passOk;
}

function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

/** Restreint l'accès admin à une liste d'IP (ex. réseau interne de l'école), si configurée. */
function ipAllowlist(req, res, next) {
  if (!config.adminAllowedIps.length) return next();
  const ip = normalizeIp(req.ip);
  const ok = config.adminAllowedIps.some((allowed) => {
    if (allowed.endsWith('*')) return ip.startsWith(allowed.slice(0, -1));
    return ip === normalizeIp(allowed);
  });
  if (ok) return next();
  return res.status(404).send('Not found');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  if (req.originalUrl.startsWith('/admin/api') || req.accepts(['html', 'json']) === 'json') {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  return res.redirect('/admin/login');
}

function ensureCsrf(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  return req.session.csrf;
}

/** Protection CSRF : jeton de session exigé dans l'en-tête X-CSRF-Token pour toute écriture. */
function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('X-CSRF-Token') || (req.body && req.body._csrf);
  if (token && req.session.csrf && safeEqual(token, req.session.csrf)) return next();
  return res.status(403).json({ error: 'Jeton CSRF invalide' });
}

module.exports = { checkCredentials, ipAllowlist, requireAuth, requireCsrf, ensureCsrf, safeEqual };
