(function () {
  'use strict';

  var LEVELS = ['B1', 'B2', 'B3', 'M1', 'M2', 'BTS'];
  var csrf = '';
  var displayKey = '';
  var saved = null; // réglages enregistrés
  var draft = null; // réglages en cours d'édition

  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };

  function api(method, url, body) {
    return fetch('/admin/api' + url, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (res.status === 401) { location.href = '/admin/login'; throw new Error('Session expirée'); }
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json.error || 'Erreur ' + res.status);
        return json;
      });
    });
  }

  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function screenUrl(id) {
    return location.origin + '/ecran/' + encodeURIComponent(id) + (displayKey ? '?key=' + encodeURIComponent(displayKey) : '');
  }

  function timeAgo(iso) {
    if (!iso) return 'jamais';
    var d = new Date(iso);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Onglets ---------- */
  $$('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      $$('.panel').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-panel') === b.getAttribute('data-tab')); });
    });
  });

  /* ---------- Formulaires simples ---------- */
  var FIELDS = ['campusName', 'groupPrefix', 'refreshMinutes', 'pageSeconds', 'rowsPerPage', 'modifiedBadgeHours', 'theme'];

  function fillForm() {
    FIELDS.forEach(function (f) { $('#' + f).value = draft[f]; });
    $('#demoMode').checked = draft.demoMode;
    $('#annEnabled').checked = draft.announcement.enabled;
    $('#annText').value = draft.announcement.text;
    $('#annTone').value = draft.announcement.tone;
    var hp = draft.hpApi;
    $('#hpEnabled').checked = hp.enabled;
    $('#hpFlavor').value = hp.flavor || 'official';
    $('#hpBaseUrl').value = hp.baseUrl;
    $('#hpCoursesPath').value = hp.coursesPath;
    $('#hpAuthMode').value = hp.authMode;
    $('#hpHeaderName').value = hp.headerName;
    $('#hpUsername').value = hp.username;
    $('#hpApiKey').value = '';
    $('#hpApiKey').placeholder = hp.apiKeySet ? '•••••••••••• (enregistrée)' : 'Collez la clé API';
    $('#hpKeyState').textContent = hp.apiKeyFromEnv
      ? 'Clé fournie par la variable HP_API_KEY du serveur.'
      : hp.apiKeySet ? 'Une clé est enregistrée. Laissez vide pour la conserver.' : 'Aucune clé enregistrée.';
    $('#hpClear').hidden = !hp.apiKeySet || hp.apiKeyFromEnv;
    updateAuthFields();
    renderSources();
    renderScreens();
    renderPreviewSelect();
  }

  function readForm() {
    FIELDS.forEach(function (f) {
      var el = $('#' + f);
      draft[f] = el.type === 'number' ? Number(el.value) : el.value;
    });
    draft.demoMode = $('#demoMode').checked;
    draft.announcement = { enabled: $('#annEnabled').checked, text: $('#annText').value, tone: $('#annTone').value };
    var newKey = $('#hpApiKey').value.trim();
    draft.hpApi = {
      enabled: $('#hpEnabled').checked,
      flavor: $('#hpFlavor').value,
      baseUrl: $('#hpBaseUrl').value.trim(),
      coursesPath: $('#hpCoursesPath').value.trim(),
      authMode: $('#hpAuthMode').value,
      headerName: $('#hpHeaderName').value.trim(),
      username: $('#hpUsername').value.trim(),
      apiKeySet: saved.hpApi.apiKeySet,
      apiKeyFromEnv: saved.hpApi.apiKeyFromEnv,
    };
    if (newKey) draft.hpApi.apiKey = newKey;
    draft.sources = $$('#sources .list-row').map(function (row) {
      return { name: $('.src-name', row).value.trim(), url: $('.src-url', row).value.trim() };
    });
    draft.screens = $$('#screens .screen-row').map(function (row) {
      return {
        name: $('.sc-name', row).value.trim(),
        id: $('.sc-id', row).value.trim(),
        levels: $$('.sc-levels input:checked', row).map(function (i) { return i.value; }),
      };
    });
  }

  function markDirty() {
    if (!saved) return; // réglages pas encore chargés
    readForm();
    $('#savebar').hidden = JSON.stringify(draft) === JSON.stringify(saved);
  }
  document.addEventListener('input', function (e) { if (e.target.closest('main')) markDirty(); });
  document.addEventListener('change', function (e) { if (e.target.closest('main') && e.target.id !== 'preview-screen') markDirty(); });

  /* ---------- API HyperPlanning ---------- */
  function updateAuthFields() {
    var flavor = $('#hpFlavor').value;
    var official = flavor !== 'generic'; // REST officielle et SOAP : authentification Basic, pas de réglages avancés
    var mode = official ? 'basic' : $('#hpAuthMode').value;
    $$('.adv').forEach(function (el) { el.hidden = official; });
    $('#hpUrlHint').hidden = !official;
    $('#hpUrlHint').textContent = flavor === 'soap' ? 'Adresse du WSDL, en général .../hpsw/wsdl/RpcEncoded' : 'Se termine en général par /hpsw/api/v1/';
    $('#hpBaseUrl').placeholder = flavor === 'soap' ? 'https://hyperplanning.ecole.fr/hpsw/wsdl/RpcEncoded' : 'https://hyperplanning.ecole.fr/hpsw/api/v1/';
    $('#hpHeaderWrap').hidden = official || (mode !== 'header' && mode !== 'query');
    $('#hpUserWrap').hidden = mode !== 'basic';
  }
  $('#hpAuthMode').addEventListener('change', updateAuthFields);
  $('#hpFlavor').addEventListener('change', function () {
    var u = $('#hpBaseUrl').value.trim();
    if (this.value === 'soap') $('#hpBaseUrl').value = toSoapUrl(u);
    if (this.value === 'official') $('#hpBaseUrl').value = toRestUrl(u);
    updateAuthFields();
  });

  $('#hpTest').addEventListener('click', function () {
    readForm();
    var out = $('#hpResult'), b = this;
    out.hidden = false;
    out.className = 'test-out';
    out.textContent = 'Connexion à HyperPlanning…';
    b.disabled = true;
    var body = {
      flavor: draft.hpApi.flavor,
      baseUrl: draft.hpApi.baseUrl, coursesPath: draft.hpApi.coursesPath, authMode: draft.hpApi.authMode,
      headerName: draft.hpApi.headerName, username: draft.hpApi.username, apiKey: draft.hpApi.apiKey || '',
    };
    api('POST', '/test-hpapi', body)
      .then(function (r) {
        out.className = 'test-out ' + (r.understood ? 'ok' : 'warn');
        var lines = ['Connexion réussie. ' + r.received + ' élément(s) reçu(s), ' + r.understood + ' cours reconnu(s).'];
        if (r.sample.length) {
          lines.push('');
          lines.push('Aperçu des cours du jour :');
          r.sample.forEach(function (c) {
            lines.push(new Date(c.debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '  ' + c.cours +
              (c.classes ? ', ' + c.classes : '') + (c.salle ? '  (' + c.salle + ')' : '') + (c.annule ? '  [ANNULÉ]' : ''));
          });
        }
        if (r.operations) {
          var roles = { listRange: 'Cours du jour', start: 'Horaires', subject: 'Matière', rooms: 'Salles', promotions: 'Classes', teachers: 'Enseignants', cancelledRange: 'Cours annulés' };
          lines.push('', 'Opérations SOAP utilisées :');
          Object.keys(roles).forEach(function (k) { lines.push((r.operations[k] ? '  ✓ ' : '  ✗ ') + roles[k] + (r.operations[k] ? ' → ' + r.operations[k] : ' (introuvable)')); });
          if (r.available) lines.push('', r.available.length + ' opération(s) dans le WSDL : ' + r.available.join(', '));
        }
        if (r.received && !r.understood && r.fields && r.fields.length) {
          lines.push('', 'Les champs reçus ne sont pas reconnus : ' + r.fields.join(', '),
            'Il faut ajouter ces noms de champs dans hpapi.js.');
        }
        out.textContent = lines.join('\n');
      })
      .catch(function (e) { out.className = 'test-out err'; out.textContent = 'Échec : ' + e.message; })
      .then(function () { b.disabled = false; });
  });

  $('#hpClear').addEventListener('click', function () {
    if (!window.confirm('Supprimer la clé API enregistrée ? Les écrans garderont les dernières données jusqu\'à la saisie d\'une nouvelle clé.')) return;
    api('POST', '/settings', { hpApi: { clearApiKey: true } })
      .then(function (r) { saved = r.settings; draft = clone(saved); fillForm(); toast('Clé supprimée'); })
      .catch(function (e) { toast(e.message, true); });
  });

  /* ---------- Sources iCal ---------- */
  function addSourceRow(src) {
    var node = $('#tpl-source').content.firstElementChild.cloneNode(true);
    $('.src-name', node).value = src.name || '';
    $('.src-url', node).value = src.url || '';
    $('.src-del', node).addEventListener('click', function () { node.remove(); markDirty(); });
    $('.src-test', node).addEventListener('click', function () {
      var out = $('.src-result', node);
      out.textContent = 'Test en cours…';
      out.className = 'src-result muted';
      api('POST', '/test-source', { url: $('.src-url', node).value.trim() })
        .then(function (r) { out.textContent = '✓ ' + r.count + ' événements trouvés'; out.className = 'src-result ok'; })
        .catch(function (e) { out.textContent = '✗ ' + e.message; out.className = 'src-result err'; });
    });
    $('#sources').appendChild(node);
  }
  function renderSources() {
    $('#sources').innerHTML = '';
    draft.sources.forEach(addSourceRow);
    if (!draft.sources.length) $('#sources').innerHTML = '<p class="empty">Aucune URL : le mode démonstration est utilisé.</p>';
  }
  $('#add-source').addEventListener('click', function () {
    var empty = $('#sources .empty');
    if (empty) empty.remove();
    addSourceRow({});
    markDirty();
  });

  /* ---------- Écrans ---------- */
  function addScreenRow(sc) {
    var node = $('#tpl-screen').content.firstElementChild.cloneNode(true);
    $('.sc-name', node).value = sc.name || '';
    $('.sc-id', node).value = sc.id || '';
    var lv = $('.sc-levels', node);
    LEVELS.forEach(function (l) {
      var lab = document.createElement('label');
      lab.className = 'chip lvl-' + l;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = l;
      cb.checked = !sc.levels || sc.levels.indexOf(l) !== -1;
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + l));
      lv.appendChild(lab);
    });
    function updateUrl() {
      var id = $('.sc-id', node).value.trim();
      $('.sc-url code', node).textContent = id ? screenUrl(id) : 'Renseignez un identifiant';
      $('.sc-open', node).href = id ? screenUrl(id) : '#';
    }
    $('.sc-id', node).addEventListener('input', updateUrl);
    updateUrl();
    $('.sc-copy', node).addEventListener('click', function () {
      var txt = $('.sc-url code', node).textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
        .then(function () { toast('URL copiée. Collez-la dans Emity, widget Site web.'); })
        .catch(function () { toast('Copie impossible, sélectionnez le lien à la main.', true); });
    });
    $('.sc-del', node).addEventListener('click', function () {
      if ($$('#screens .screen-row').length <= 1) return toast('Il faut au moins un écran', true);
      node.remove();
      markDirty();
    });
    $('#screens').appendChild(node);
  }
  function renderScreens() {
    $('#screens').innerHTML = '';
    draft.screens.forEach(addScreenRow);
  }
  $('#add-screen').addEventListener('click', function () {
    addScreenRow({ name: 'Nouvel écran', id: 'ecran-' + ($$('#screens .screen-row').length + 1) });
    markDirty();
  });

  /* ---------- Aperçu ---------- */
  function renderPreviewSelect() {
    var sel = $('#preview-screen');
    var current = sel.value;
    sel.innerHTML = '';
    saved.screens.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      sel.appendChild(o);
    });
    if (current) sel.value = current;
    loadPreview();
  }
  function loadPreview() {
    var id = $('#preview-screen').value || saved.screens[0].id;
    $('#preview').src = screenUrl(id) + (displayKey ? '&' : '?') + 't=' + Date.now();
  }
  $('#preview-screen').addEventListener('change', loadPreview);

  /* ---------- Statut ---------- */
  function renderStatus(st) {
    $('#st-count').textContent = st.count;
    $('#st-sync').textContent = timeAgo(st.lastSuccessAt);
    $('#st-source').textContent = saved.demoMode ? 'Démo'
      : saved.hpApi.enabled ? 'API HyperPlanning' + (saved.sources.length ? ' + iCal' : '')
      : saved.sources.length ? saved.sources.length + ' export(s) iCal' : 'Démo';
    var box = $('#st-errors');
    if (st.errors && st.errors.length) {
      box.textContent = 'Erreurs de synchronisation : ' + st.errors.map(function (e) { return e.source + ' (' + e.message + ')'; }).join(', ') +
        '. Les écrans affichent les dernières données valides.';
      box.hidden = false;
    } else box.hidden = true;
  }
  function refreshStatus() { api('GET', '/status').then(renderStatus).catch(function () {}); }

  $('#refresh-now').addEventListener('click', function () {
    var b = this;
    b.disabled = true;
    api('POST', '/refresh')
      .then(function (st) { renderStatus(st); loadPreview(); toast('Planning synchronisé'); })
      .catch(function (e) { toast(e.message, true); })
      .then(function () { b.disabled = false; });
  });

  /* ---------- Enregistrement ---------- */
  $('#save').addEventListener('click', function () {
    readForm();
    var b = this;
    b.disabled = true;
    api('POST', '/settings', draft)
      .then(function (r) {
        saved = r.settings;
        draft = clone(saved);
        fillForm();
        renderStatus(r.status);
        $('#savebar').hidden = true;
        toast('Réglages enregistrés. Les écrans se mettent à jour sous 1 minute.');
      })
      .catch(function (e) { toast(e.message, true); })
      .then(function () { b.disabled = false; });
  });
  $('#discard').addEventListener('click', function () {
    draft = clone(saved);
    fillForm();
    $('#savebar').hidden = true;
  });

  $('#logout').addEventListener('click', function () {
    fetch('/admin/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf } })
      .catch(function () {})
      .then(function () { location.href = '/admin/login'; });
  });

  // onglet Accueil : bouton Connecter
  var HP_CANDIDATES = ['https://hp26.ynov.com/MON/hpsw/api/v1/']; // Service Web REST HyperPlanning d'Ynov
  // même serveur, version SOAP ou REST de l'adresse
  function toSoapUrl(u) { return /\/hpsw\//i.test(u) ? u.replace(/\/hpsw\/.*$/i, '/hpsw/wsdl/RpcEncoded') : u; }
  function toRestUrl(u) { return /\/hpsw\//i.test(u) ? u.replace(/\/hpsw\/.*$/i, '/hpsw/api/v1/') : u; }
  function renderQuick() {
    var hp = saved.hpApi;
    var connected = hp.enabled && hp.apiKeySet && !saved.demoMode;
    var st = $('#quickState');
    st.className = 'quick-state' + (connected ? ' ok' : '');
    st.textContent = connected ? 'Connecté à HyperPlanning. Pour changer de clé, collez la nouvelle et cliquez sur Connecter.' : '';
    $('#quickKey').placeholder = hp.apiKeySet ? 'Clé enregistrée (collez-en une nouvelle pour la remplacer)' : 'Collez la clé API ici';
    $('#quickUrl').textContent = screenUrl(saved.screens[0].id);
  }

  $('#quickConnect').addEventListener('click', function () {
    var key = $('#quickKey').value.trim();
    var st = $('#quickState'), b = this;
    if (!key && !saved.hpApi.apiKeySet) { st.className = 'quick-state err'; st.textContent = 'Collez d\'abord la clé API.'; return; }
    var hp = saved.hpApi;
    // Format "utilisateur:motdepasse" accepté (authentification du Service Web HyperPlanning)
    var user = hp.username, secret = key;
    if (key && key.indexOf(':') > 0 && !/^https?:/i.test(key)) { user = key.slice(0, key.indexOf(':')); secret = key.slice(key.indexOf(':') + 1); }
    var cfg = { flavor: hp.flavor || 'official', baseUrl: hp.baseUrl, coursesPath: hp.coursesPath, authMode: hp.authMode, headerName: hp.headerName, username: user, apiKey: secret };
    b.disabled = true;
    st.className = 'quick-state';
    st.textContent = 'Connexion à HyperPlanning…';
    // On essaie l'adresse enregistrée (ou celle d'Ynov) en REST, puis la même en SOAP si le REST ne répond pas
    var base = hp.baseUrl || HP_CANDIDATES[0];
    var candidates = [{ flavor: hp.flavor || 'official', url: base }];
    var other = hp.flavor === 'soap' ? { flavor: 'official', url: toRestUrl(base) } : { flavor: 'soap', url: toSoapUrl(base) };
    if (other.url !== base) candidates.push(other);
    function tryNext(lastErr) {
      if (!candidates.length) return Promise.reject(lastErr);
      var c = candidates.shift();
      cfg.baseUrl = c.url;
      cfg.flavor = c.flavor;
      return api('POST', '/test-hpapi', cfg).catch(function (e) {
        // Identifiants refusés (401/403) : inutile d'essayer en SOAP
        if (/HTTP 40[13]/.test(e.message)) throw e;
        return tryNext(e);
      });
    }
    tryNext(new Error('Aucune adresse à tester'))
      .then(function (r) {
        return api('POST', '/settings', { demoMode: false, hpApi: { enabled: true, flavor: cfg.flavor, baseUrl: cfg.baseUrl, username: user, apiKey: secret } })
          .then(function (s) {
            saved = s.settings; draft = clone(saved); fillForm(); renderStatus(s.status); renderQuick(); loadPreview();
            $('#quickKey').value = '';
            st.className = 'quick-state ok';
            st.textContent = 'Connecté. ' + s.status.count + ' cours aujourd\'hui, les écrans sont à jour.';
          });
      })
      .catch(function (e) {
        st.className = 'quick-state err';
        st.textContent = 'Connexion impossible : ' + e.message + '. Vérifiez la clé, ou l\'adresse du serveur dans l\'onglet Connexion (avancé).';
      })
      .then(function () { b.disabled = false; });
  });

  $('#quickCopy').addEventListener('click', function () {
    var txt = $('#quickUrl').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
      .then(function () { toast('Lien copié. Collez-le dans Emity, widget Site web.'); })
      .catch(function () { toast('Copie impossible : sélectionnez le lien à la main.', true); });
  });

  /* ---------- Init ---------- */
  api('GET', '/session')
    .then(function (s) {
      csrf = s.csrf;
      displayKey = s.displayKey || '';
      $('#who').textContent = s.user;
      return api('GET', '/settings');
    })
    .then(function (settings) {
      saved = settings;
      draft = clone(saved);
      fillForm();
      renderQuick();
      refreshStatus();
      setInterval(refreshStatus, 30000);
    })
    .catch(function (e) { toast(e.message, true); });
})();
