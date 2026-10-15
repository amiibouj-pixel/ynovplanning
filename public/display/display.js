/* Cours du jour, écran TV.
 * Une ligne par classe, une page par niveau (B1 → M2, BTS).
 * ES5 + XHR volontairement : tourne sur les navigateurs embarqués des TV et players
 * d'affichage dynamique (Tizen, webOS, Android WebView, Chromium anciens). */
(function () {
  'use strict';

  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var LEVELS = ['B1', 'B2', 'B3', 'M1', 'M2', 'BTS', 'AUTRE'];
  var LEVEL_NAMES = { B1: 'Bachelor 1', B2: 'Bachelor 2', B3: 'Bachelor 3', M1: 'Mastère 1', M2: 'Mastère 2', BTS: 'BTS', AUTRE: 'Autres' };
  var POLL_MS = 30 * 1000;
  var RELOAD_MS = 6 * 3600 * 1000;
  var CACHE_KEY = 'cours-du-jour-';

  var screenId = decodeURIComponent(location.pathname.split('/').pop() || 'general');
  var keyMatch = /[?&]key=([^&]+)/.exec(location.search);
  var apiUrl = '/api/ecran/' + encodeURIComponent(screenId) + (keyMatch ? '?key=' + keyMatch[1] : '');

  var stage = document.getElementById('stage');
  function $(id) { return document.getElementById(id); }

  var data = null;
  var clockOffset = 0;
  var tzOffset = 120;
  var pages = [];
  var page = 0;
  var currentKey = null; // niveau + partie affichés (ex. "B2#1")
  var pageStart = 0;
  var lastOk = 0;
  var isStale = false;
  var GAP = 14; // espace entre les cartes (px du canevas)

  function now() { return Date.now() + clockOffset; }
  function local(ms) { return new Date(ms + tzOffset * 60000); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // Horaires à la française : 9h, 10h30
  function hh(ms) { var d = local(ms); return d.getUTCHours() + 'h' + (d.getUTCMinutes() ? pad(d.getUTCMinutes()) : ''); }
  function hm(ms) { var d = local(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Canevas fixe 1920×1080 (ou 1080×1920) mis à l'échelle de l'écran */
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    var portrait = h > w * 1.1;
    var dark = data && data.settings.theme === 'dark';
    stage.className = 'stage' + (portrait ? ' portrait' : '') + (dark ? ' dark' : '') + (isStale ? ' stale-mode' : '');
    var sw = portrait ? 1080 : 1920, sh = portrait ? 1920 : 1080;
    var s = Math.min(w / sw, h / sh);
    var t = 'translate(' + (w - sw * s) / 2 + 'px,' + (h - sh * s) / 2 + 'px) scale(' + s + ')';
    stage.style.webkitTransform = t;
    stage.style.transform = t;
    return portrait;
  }

  function tickClock() {
    var d = local(now());
    $('time').textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    $('kicker').textContent = 'Cours du ' + JOURS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MOIS[d.getUTCMonth()];
  }

  /* ---------- Données ---------- */
  function load() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status !== 200) return offline();
      try {
        apply(JSON.parse(xhr.responseText), false);
        lastOk = Date.now();
        try { localStorage.setItem(CACHE_KEY + screenId, xhr.responseText); } catch (e) {}
      } catch (e) { offline(); }
    };
    xhr.onerror = xhr.ontimeout = offline;
    xhr.send();
  }

  function offline() {
    if (!data) {
      try {
        var cached = localStorage.getItem(CACHE_KEY + screenId);
        if (cached) apply(JSON.parse(cached), true);
      } catch (e) {}
    }
    showSync(true);
  }

  function apply(json, fromCache) {
    var first = !data;
    data = json;
    if (!fromCache && json.serverNow) clockOffset = json.serverNow - Date.now();
    if (json.tzOffsetMinutes != null) tzOffset = json.tzOffsetMinutes;
    showNotice();
    showSync(fromCache || json.stale);
    tickClock();
    if (first) { render(true); schedulePage(); }
  }

  /* ---------- Une ligne par classe, regroupées par niveau ---------- */
  function buildPages(per) {
    var t = now();
    var byLevel = {};
    for (var i = 0; i < data.courses.length; i++) {
      var c = data.courses[i];
      var s = Date.parse(c.start), e = Date.parse(c.end);
      if (e <= t) continue; // terminé
      var groups = c.groups.length ? c.groups : [{ label: '', program: '', level: null, levelLabel: '', color: '#c8d0c9' }];
      for (var j = 0; j < groups.length; j++) {
        var g = groups[j];
        var lv = LEVELS.indexOf(g.level) !== -1 ? g.level : 'AUTRE';
        (byLevel[lv] = byLevel[lv] || []).push({ c: c, g: g, others: groups.length - 1, s: s, e: e, live: s <= t && !c.cancelled });
      }
    }
    var out = [];
    for (var k = 0; k < LEVELS.length; k++) {
      var rows = byLevel[LEVELS[k]];
      if (!rows) continue;
      // Par classe (ordre alphabétique), puis par heure : chacun retrouve sa ligne au même endroit
      rows.sort(function (a, b) {
        if (a.g.program !== b.g.program) return a.g.program < b.g.program ? -1 : 1;
        return a.s - b.s;
      });
      var parts = Math.ceil(rows.length / per);
      for (var p = 0; p < parts; p++) {
        out.push({ level: LEVELS[k], rows: rows.slice(p * per, p * per + per), part: p + 1, parts: parts });
      }
    }
    return out;
  }

  function keyOf(pg) { return pg.level + '#' + pg.part; }

  /* ---------- Rendu ---------- */
  function levelsHtml() {
    var html = '', seen = {};
    for (var i = 0; i < pages.length; i++) {
      var pg = pages[i];
      if (seen[pg.level]) continue;
      seen[pg.level] = true;
      var on = pages[page] && pages[page].level === pg.level;
      html += '<span class="lv' + (on ? ' on' : '') + '"><span class="lv-long">' + esc(LEVEL_NAMES[pg.level]) + '</span>' +
        '<span class="lv-short">' + (pg.level === 'AUTRE' ? 'Autres' : pg.level) + '</span></span>';
    }
    return html;
  }

  // Légende : filières présentes sur la page, dans l'ordre d'apparition
  function legendHtml(rows) {
    var seen = {}, html = '';
    for (var i = 0; i < rows.length; i++) {
      var g = rows[i].g;
      if (!g.filiereLabel || seen[g.filiere]) continue;
      seen[g.filiere] = true;
      html += '<span class="key"><i data-bg="' + esc(g.color) + '"></i>' + esc(g.filiereLabel) + '</span>';
    }
    return html;
  }

  function roomHtml(c) {
    if (c.cancelled) return '<div class="room cancel"><small>Cours</small><b>Annulé</b></div>';
    if (c.remote) return '<div class="room note"><small>Cours</small><b>À distance</b></div>';
    if (!c.rooms.length) return '<div class="room note"><small>Salle</small><b>À venir</b></div>';
    var label = c.rooms.slice(0, 2).join(' et ');
    return '<div class="room"><small>Salle</small><b' + (label.length > 5 ? ' class="long"' : '') + '>' + esc(label) + '</b></div>';
  }

  function stateHtml(item, t) {
    if (item.c.cancelled) return '';
    if (item.live) return '<span class="state live">En cours</span>';
    var mins = Math.round((item.s - t) / 60000);
    if (mins <= 60) return '<span class="state">Dans ' + Math.max(1, mins) + ' min</span>';
    return '';
  }

  function rowHtml(item, t, h) {
    var c = item.c, g = item.g;
    var hours = hh(item.s) + ' à ' + hh(item.e);
    var lvl = g.levelLabel ? '<span class="lvl' + (g.levelLabel.length > 2 ? ' wide' : '') + '">' + esc(g.levelLabel) + '</span>' : '';
    var tag = g.program ? '<div class="pill" data-bg="' + esc(g.color) + '" data-ink="' + esc(g.ink || '#0a0006') + '">' + lvl + '<span class="prog">' + esc(g.program) + '</span></div>' : '';
    var also = item.others > 0 ? '<span class="also">+' + item.others + ' classe' + (item.others > 1 ? 's' : '') + '</span>' : '';
    var flag = c.modified && !c.cancelled ? '<span class="tag">Modifié</span>' : '';
    return '<div class="row' + (c.cancelled ? ' cancelled' : '') + (item.live ? ' is-live' : '') + '" data-h="' + h + '">' +
      '<div class="c-class">' + tag + also + '</div>' +
      '<div class="c-course"><div class="subject">' + esc(c.subject) + flag + '</div>' +
        (c.teacher ? '<div class="teacher">' + esc(c.teacher) + '</div>' : '') +
        '<div class="inline-hours">' + hours + stateHtml(item, t) + '</div></div>' +
      '<div class="c-time"><div class="hours">' + hours + '</div>' + stateHtml(item, t) + '</div>' +
      '<div class="c-room">' + roomHtml(c) + '</div>' +
      '</div>';
  }

  // La CSP interdit les styles inline dans le HTML : on les pose via le DOM.
  function applyStyles(root) {
    var rows = root.querySelectorAll('[data-h]');
    for (var i = 0; i < rows.length; i++) rows[i].style.height = rows[i].getAttribute('data-h') + 'px';
    var fills = root.querySelectorAll('[data-bg]');
    for (var j = 0; j < fills.length; j++) {
      fills[j].style.backgroundColor = fills[j].getAttribute('data-bg');
      if (fills[j].getAttribute('data-ink')) fills[j].style.color = fills[j].getAttribute('data-ink');
    }
  }

  function render(animate) {
    var portrait = fit();
    var board = $('board');
    var per = (data ? data.settings.rowsPerPage : 7) * (portrait ? 2 : 1);
    pages = data ? buildPages(per) : [];
    // Reste sur la même page si elle existe encore après une mise à jour des données
    page = 0;
    for (var i = 0; i < pages.length; i++) if (keyOf(pages[i]) === currentKey) page = i;
    currentKey = pages[page] ? keyOf(pages[page]) : null;

    $('levels').innerHTML = levelsHtml();
    var cur = pages[page];
    $('level-title').textContent = cur ? LEVEL_NAMES[cur.level] : (data ? data.settings.campusName + ' Ynov Campus' : '');
    $('part').textContent = cur && cur.parts > 1 ? 'Page ' + cur.part + ' / ' + cur.parts : '';
    $('pager').className = 'pager' + (pages.length > 1 ? '' : ' solo');
    var legend = $('legend');
    legend.innerHTML = cur ? legendHtml(cur.rows) : '';
    applyStyles(legend);

    if (!pages.length) {
      var hour = local(now()).getUTCHours();
      board.innerHTML = '<div class="empty"><h2>' + (hour < 12 ? 'Pas de cours ce matin' : 'Plus de cours aujourd’hui') + '</h2>' +
        '<p>Retrouve ton emploi du temps complet sur HyperPlanning.</p></div>';
    } else {
      var t = now();
      var h = Math.floor((board.clientHeight - GAP * (per - 1)) / per);
      var rows = pages[page].rows;
      var html = '';
      for (var r = 0; r < rows.length; r++) html += rowHtml(rows[r], t, h);
      board.innerHTML = html;
      applyStyles(board);
    }
    if (animate) {
      board.className = board.className.replace(/\s?(in|out)\b/g, '');
      void board.offsetWidth;
      board.className += ' in';
    }
  }

  /* ---------- Rotation des pages ---------- */
  function schedulePage() {
    var secs = data ? data.settings.pageSeconds : 12;
    pageStart = Date.now();
    setTimeout(function () {
      if (pages.length <= 1) { render(false); return schedulePage(); }
      var board = $('board');
      board.className = board.className.replace(/\s?(in|out)\b/g, '') + ' out';
      setTimeout(function () {
        currentKey = keyOf(pages[(page + 1) % pages.length]);
        render(true);
        schedulePage();
      }, 320);
    }, secs * 1000);
  }

  function tickBar() {
    var secs = data ? data.settings.pageSeconds : 12;
    $('timer').style.width = (pages.length > 1 ? Math.min(100, (Date.now() - pageStart) / (secs * 10)) : 0) + '%';
  }

  /* ---------- Annonce ---------- */
  function showNotice() {
    var el = $('notice'), txt = $('notice-text');
    var a = data && data.settings.announcement;
    var text = a ? a.text : data.settings.campusName + ' Ynov Campus. Savoir Faire Évoluer.';
    el.className = 'notice' + (a && a.tone === 'alert' ? ' alert' : '');
    if (txt.textContent !== text) txt.textContent = text;
    txt.style.webkitAnimationDuration = txt.style.animationDuration = '';
    setTimeout(function () {
      if (txt.offsetWidth > el.clientWidth) {
        el.className += ' scroll';
        var d = Math.max(14, Math.round(txt.offsetWidth / 80)) + 's';
        txt.style.webkitAnimationDuration = d;
        txt.style.animationDuration = d;
      }
    }, 50);
  }

  function showSync(stale) {
    var el = $('sync');
    var ref = data && data.lastSuccessAt ? Date.parse(data.lastSuccessAt) : 0;
    isStale = !!(stale || (lastOk && Date.now() - lastOk > 5 * POLL_MS));
    el.className = 'sync' + (isStale ? ' stale' : '');
    stage.className = stage.className.replace(/\s?stale-mode\b/, '') + (isStale ? ' stale-mode' : '');
    el.textContent = !ref ? '' : (isStale ? 'Hors ligne depuis ' : 'Mis à jour à ') + hm(ref);
  }

  window.addEventListener('resize', function () { render(false); });
  fit();
  tickClock();
  load();
  setInterval(tickClock, 1000);
  setInterval(tickBar, 250);
  setInterval(load, POLL_MS);
  setInterval(function () { if (data) render(false); }, 30 * 1000);
  setTimeout(function () { location.reload(); }, RELOAD_MS);
})();
