'use strict';

/**
 * Chiffrement des secrets stockés sur disque (clé API HyperPlanning) en AES-256-GCM.
 * La clé de chiffrement vient de SECRETS_KEY (ou à défaut SESSION_SECRET) : sans elle,
 * le fichier data/settings.json ne permet pas de retrouver la clé API.
 */
const crypto = require('crypto');
const config = require('./config');

let key = null;
function getKey() {
  if (!key) key = crypto.scryptSync(config.secretsKey, 'ynov-planning-secrets', 32);
  return key;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(blob) {
  if (!blob) return '';
  try {
    const [v, iv, tag, data] = String(blob).split(':');
    if (v !== 'v1') return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[secrets] Impossible de déchiffrer la clé API (SECRETS_KEY a changé ?)');
    return '';
  }
}

module.exports = { encrypt, decrypt };
