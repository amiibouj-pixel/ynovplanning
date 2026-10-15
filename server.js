'use strict';

const config = require('./src/config');
process.env.TZ = config.timezone;

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const store = require('./src/store');
const schedule = require('./src/schedule');
const { fetchIcal } = require('./src/sources/ical');
const { fetchHpApi } = require('./src/sources/hpapi');
const { fetchHpOfficial } = require('./src/sources/hpofficial');
const auth = require('./src/auth');

const app = express();
const PUB = path.join(__dirname, 'public');

if (config.trustProxy) app.set('trust proxy', config.trustProxy === 'true' ? 1 : config.trustProxy);
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// En-têtes de sécurité (CSP stricte, pas de script/style externe)
// ---------------------------------------------------------------------------
const baseCsp = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  // Pas de upgrade-insecure-requests : les écrans peuvent être servis en HTTP sur le réseau local
  upgradeInsecureRequests: null,
};

app.use(
  helmet({
    contentSecurityPolicy: { directives: { ...baseCsp, frameAncestors: ["'none'"] } },
    frameguard: false, // géré par CSP frame-ancestors (l'écran doit pouvoir être intégré dans Emity)
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Les pages d'écran peuvent être intégrées en iframe par le lecteur d'affichage dynamique
const displayCsp = helmet.contentSecurityPolicy({
  directives: { ...baseCsp, frameAncestors: config.displayFrameAncestors },
});

app.use('/assets', express.static(path.join(PUB, 'assets'), { maxAge: '7d', immutable: true }));

// ---------------------------------------------------------------------------
// Écrans publics (lecture seule)
// ---------------------------------------------------------------------------
function findScreen(req, res) {
  if (config.displayKey && !auth.safeEqual(req.query.key || '', config.displayKey)) {
    res.status(403).send('Accès refusé');
    return null;
  }
  const screen = store.load().screens.find((s) => s.id === req.params.id);
  if (!screen) {
    res.status(404).send('Écran inconnu');
    return null;
  }
  return screen;
}

app.get('/', (req, res) => res.redirect('/ecran/' + store.load().screens[0].id + (req.query.key ? '?key=' + encodeURIComponent(req.query.key) : '')));

app.use('/display', displayCsp, express.static(path.join(PUB, 'display'), { maxAge: 0 }));

app.get('/ecran/:id', displayCsp, (req, res) => {
  if (!findScreen(req, res)) return;
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUB, 'display', 'index.html'));
});

app.get('/api/ecran/:id', (req, res) => {
  const screen = findScreen(req, res);
  if (!screen) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json(schedule.forScreen(screen));
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Back-office (authentifié)
// ---------------------------------------------------------------------------
const admin = express.Router();

admin.use(auth.ipAllowlist);
admin.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
admin.use(
  session({
    name: 'ynov_admin',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: 8 * 3600 * 1000,
      path: '/admin',
    },
  })
);
admin.use(express.json({ limit: '100kb' }));
admin.use(express.urlencoded({ extended: false, limit: '10kb' }));
admin.use('/static', express.static(path.join(PUB, 'admin', 'static')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.locals.loginOk === true,
  handler: (req, res) => res.redirect('/admin/login?e=limit'),
});

admin.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.sendFile(path.join(PUB, 'admin', 'login.html'));
});

admin.post('/login', loginLimiter, async (req, res) => {
  const ok = await auth.checkCredentials(req.body.username, req.body.password);
  if (!ok) return res.redirect('/admin/login?e=1');
  res.locals.loginOk = true;
  req.session.regenerate((err) => {
    if (err) return res.redirect('/admin/login?e=1');
    req.session.admin = true;
    auth.ensureCsrf(req);
    res.redirect('/admin');
  });
});

admin.post('/logout', auth.requireAuth, auth.requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ynov_admin', { path: '/admin' });
    res.json({ ok: true });
  });
});

admin.get('/', auth.requireAuth, (req, res) => res.sendFile(path.join(PUB, 'admin', 'index.html')));

const api = express.Router();
api.use(auth.requireAuth, auth.requireCsrf);

api.get('/session', (req, res) => {
  res.json({ csrf: auth.ensureCsrf(req), user: config.adminUser, displayKey: config.displayKey });
});

api.get('/settings', (req, res) => res.json(store.publicSettings()));

// POST accepté en plus de PUT : certains hébergements mutualisés bloquent PUT
async function saveSettings(req, res) {
  const before = store.load();
  const saved = store.save(req.body || {});
  const sourcesChanged =
    JSON.stringify(before.sources) !== JSON.stringify(saved.sources) ||
    before.demoMode !== saved.demoMode ||
    JSON.stringify(before.hpApi) !== JSON.stringify(saved.hpApi) ||
    before.groupPrefix !== saved.groupPrefix;
  if (sourcesChanged) {
    schedule.resetTracking();
    await schedule.refresh();
  }
  schedule.schedule();
  res.json({ settings: store.publicSettings(), status: schedule.status() });
}
api.put('/settings', saveSettings);
api.post('/settings', saveSettings);

api.get('/status', (req, res) => res.json(schedule.status()));

api.post('/refresh', async (req, res) => {
  await schedule.refresh();
  res.json(schedule.status());
});

api.post('/test-source', async (req, res) => {
  const url = String((req.body && req.body.url) || '');
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('URL http(s) attendue');
    const events = await fetchIcal(url);
    res.json({ ok: true, count: events.length, sample: events.slice(0, 3).map((e) => ({ summary: e.summary, start: e.start })) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Test de la connexion API HyperPlanning avec les réglages saisis (non enregistrés).
// Si aucune nouvelle clé n'est saisie, on utilise la clé déjà enregistrée.
api.post('/test-hpapi', async (req, res) => {
  const body = req.body || {};
  const cfg = { ...store.load().hpApi, ...body };
  const key = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : store.hpApiKey();
  try {
    const u = new URL(cfg.baseUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error('URL http(s) attendue');
    const { events, raw } =
      cfg.flavor === 'generic'
        ? await fetchHpApi(cfg, key, config.timezone)
        : await fetchHpOfficial(cfg, key, config.timezone, { forceRefs: true });
    res.json({
      ok: true,
      received: raw.length,
      understood: events.length,
      fields: raw[0] ? Object.keys(raw[0]).slice(0, 30) : [],
      sample: events.slice(0, 5).map((e) => ({
        cours: e.summary,
        debut: e.start,
        fin: e.end,
        salle: e.location,
        classes: (e.description.match(/^Promotion : (.+)$/gm) || []).map((l) => l.slice(12)).join(', '),
        annule: e.status === 'CANCELLED',
      })),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

admin.use('/api', api);
app.use('/admin', admin);

// ---------------------------------------------------------------------------
app.use((req, res) => res.status(404).send('Not found'));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Erreur serveur');
});

schedule.start().then(() => {
  app.listen(config.port, '0.0.0.0', () => {
    const id = store.load().screens[0].id;
    const key = config.displayKey ? '?key=' + config.displayKey : '';
    // Adresses de cette machine sur le réseau local : ce sont elles qu'on met dans Emity / sur les TV
    const lan = Object.values(require('os').networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    console.log(`\nÉcran (cette machine)  : http://localhost:${config.port}/ecran/${id}${key}`);
    lan.forEach((ip) => console.log(`Écran (réseau local)   : http://${ip}:${config.port}/ecran/${id}${key}`));
    console.log(`Back-office            : http://localhost:${config.port}/admin\n`);
  });
});
