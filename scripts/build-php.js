'use strict';

/**
 * Assemble la version PHP prête à envoyer par FTP (IONOS, OVH…) dans dist/ionos/.
 * Usage : npm run build:php
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'ionos');

function copy(src, dest) {
  const from = path.join(ROOT, src);
  const to = path.join(OUT, dest);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Serveur PHP
copy('php/index.php', 'index.php');
copy('php/.htaccess', '.htaccess');
copy('php/config.sample.php', 'config.sample.php');
copy('php/lib', 'lib');
copy('php/data/.htaccess', 'data/.htaccess');

// Front (identique à la version Node)
copy('public/display', 'display');
copy('public/assets', 'assets');
copy('public/admin/static', 'admin/static');
// Pages admin : servies seulement après connexion, donc rangées dans lib/ (non accessible)
copy('public/admin/index.html', 'lib/views/admin.html');
copy('public/admin/login.html', 'lib/views/login.html');

// Config locale (si présente) : jamais écrasée côté serveur, mais pratique pour un premier envoi
if (fs.existsSync(path.join(ROOT, 'php', 'config.php'))) copy('php/config.php', 'config.php');

let count = 0;
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else count++;
  }
})(OUT);
console.log(`Version PHP prête : ${path.relative(ROOT, OUT)}/ (${count} fichiers)`);
console.log('Envoyer TOUT le contenu de ce dossier à la racine du (sous-)domaine par FTP/SFTP.');
