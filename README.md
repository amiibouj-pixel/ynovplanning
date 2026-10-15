# Cours du jour, écrans Ynov Campus

Affiche les cours du jour (HyperPlanning) sur les TV du campus, avec un back-office réservé à la pédagogie.

```
HyperPlanning ──(API + clé)──▶  Serveur (clé chiffrée, jamais envoyée ailleurs)
                                   ├──▶ /ecran/<id>   page publique en lecture seule → collée dans Emity → TV
                                   └──▶ /admin        back-office protégé par mot de passe
```

## L'écran

Même direction artistique que ynov.com : header noir avec la nav en pilules, fond menthe `#eaf0eb`,
grand titre serif, pilules arrondies, carrés noirs, barre noire en bas, filets arc-en-ciel.

Un étudiant cherche **sa classe**, puis **sa salle** :

- **Une page par niveau** (Bachelor 1 → Mastère 2 → BTS), indiquée dans la nav du haut et en grand titre.
- **Une ligne par classe**, triée par ordre alphabétique.
- **Pilule de classe remplie avec la couleur de la filière** + légende des filières présentes sur la page.
- Salle dans un carré noir, `En cours` / `Dans 20 min`, `Modifié` (jaune), `Annulé` (rouge).

### Code couleur des filières

Tokens officiels du site (`--c-formation-*`), recoupés avec les carrés de couleur des écrans actuels :

| Filière | Classes (ex.) | Couleur |
|---|---|---|
| Création & Design | CREADD | `#89dc8f` vert |
| Marketing & Com | MKTCD | `#e38338` orange |
| Audiovisuel | AVI | `#ffdb2d` jaune |
| 3D & Jeu vidéo | 3DTI | `#c259ff` violet |
| Illustration | 2D | `#ff5aff` rose |
| Architecture | ARCHIN, AINTMOE | `#3ca55b` vert foncé |
| Informatique | INFOR, DEVFLSTK, DEVMIOT | `#5ec5ea` bleu clair |
| Cybersécurité | CYBERSEC, CSINFRA | `#5affb6` vert menthe |
| IA & Data | IADAT, IADEV, DIGIA, DATAE | `#859cff` bleu lavande* |
| BTS Tech | SIO, CIEL | `#3d68d1` bleu (texte blanc) |

\* Sur le site, IA (`#f5822b`) et Marketing (`#e38338`) sont deux oranges presque identiques : IA & Data
prend le bleu lavande de la palette secondaire pour qu'on les distingue de loin. Tout se règle dans `src/normalize.js`.

## Installation

```bash
npm install
```

```bash
npm run hash-password
```

Copier `.env.example` en `.env` et remplir au minimum `ADMIN_PASSWORD_HASH` (entre guillemets simples),
`SESSION_SECRET` et `SECRETS_KEY` (`openssl rand -hex 32` pour chacun). Puis :

```bash
npm start
```

- Écran : http://localhost:3000/ecran/general
- Back-office : http://localhost:3000/admin

## Brancher HyperPlanning (API officielle)

Le connecteur suit la spécification officielle de l'API REST PRONOTE Campus / HYPERPLANNING
([OpenAPIRestPC.yaml](https://www.index-education.com/FichiersExternes/campus/2026/fr/OpenAPIRestPC.yaml)) :

- adresse : `https://<serveur-hyperplanning>/hpsw/api/v1/`
- authentification : **HTTP Basic** (un utilisateur « Service Web » + son mot de passe / clé)
- séances du jour : `cours/detail_seances_placees?date_debut=…&date_fin=…`, puis traduction des clés en noms
  via `matieres`, `salles`, `promotions`, `tdoptions`, `regroupements`, `enseignants`
- cours annulés : `cours_annules` + `cours_annules/{cle}/detail_seances_placees`

À demander à l'administrateur HyperPlanning (ou à la personne qui a configuré la connexion Emity) :
**l'adresse du Service Web, l'utilisateur et le mot de passe / la clé**. Il est préférable d'avoir un utilisateur
dédié aux écrans, en **lecture seule**.

Back-office → **Source HyperPlanning** :
1. Type d'API : « HyperPlanning / PRONOTE Campus (API REST officielle) ».
2. Adresse, utilisateur, mot de passe / clé → **Tester la connexion** (affiche les cours du jour reconnus).
3. Cocher « Utiliser l'API HyperPlanning », décocher le mode démonstration, **Enregistrer**.

### Mises à jour

HyperPlanning ne prévient pas quand un cours change (pas de webhook dans l'API). Le serveur relit donc le planning
**toutes les 2 minutes** (une seule requête pour la journée ; matières, salles et classes sont mises en cache 1 h),
et les écrans se rafraîchissent toutes les 30 secondes : une modification de la péda apparaît en **2 à 3 minutes**,
avec le badge `MODIFIÉ` sur le cours concerné. Si HyperPlanning ne répond pas, les écrans gardent les dernières données.

Les identifiants sont chiffrés (AES-256-GCM) dans `data/settings.json`, jamais réaffichés ni envoyés aux écrans.
Alternative : variable d'environnement `HP_API_KEY` (le mot de passe n'est alors stocké nulle part).

## Sur un hébergement web IONOS (ou OVH, o2switch… : PHP, sans Node.js)

Les hébergements web classiques n'exécutent que du PHP : une **version PHP** du serveur est fournie (`php/`),
avec exactement le même écran, le même back-office et la même sécurité. Pas de processus permanent : quand une TV
demande le planning et que les données ont plus de 2 minutes, PHP relit HyperPlanning (un seul à la fois).

1. **Sur ton ordinateur**, copier `php/config.sample.php` en `php/config.php` et le remplir :
   - `admin_password_hash` : résultat de `npm run hash-password`
   - `secrets_key` : résultat de `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `display_key` (recommandé) : une autre chaîne aléatoire
2. Construire le dossier à envoyer (il inclut ton `config.php`) :
   ```bash
   npm run build:php
   ```
   → `dist/ionos/`
3. **Espace client IONOS** :
   - *Hébergement → Paramètres PHP* : PHP **8.2 ou plus** ;
   - *Domaines & SSL* : créer un sous-domaine (ex. `planning.ton-domaine.fr`) qui pointe vers un **nouveau dossier**
     (ex. `/planning`), puis activer son **certificat SSL** ;
   - *Hébergement → SFTP & SSH* : récupérer les identifiants SFTP.
4. Avec **FileZilla** (SFTP) : envoyer **tout le contenu** de `dist/ionos/` dans ce dossier
   (afficher les fichiers cachés pour envoyer aussi les `.htaccess`).
5. Ouvrir `https://planning.ton-domaine.fr/admin` → API HyperPlanning → Tester → Enregistrer.
6. Onglet **Écrans** → **Copier l'URL** → Emity, widget **Site web**.

Vérification rapide : `https://planning.ton-domaine.fr/healthz` doit afficher `{"ok":true,…}`, et
`https://planning.ton-domaine.fr/config.php` doit être **refusé** (403).

Mise à jour : relancer `npm run build:php` et renvoyer les fichiers **sauf** `config.php` et le dossier `data/`.

## Sur un serveur existant (le vôtre ou celui d'Ynov)

Conditions : Node.js 18+ **ou** Docker sur le serveur. Un hébergement mutualisé PHP seul ne suffit pas.
Prévoir un **sous-domaine** dédié (ex. `planning.ynov-montpellier.fr`) : le site n'est pas prévu pour tourner
dans un sous-dossier d'un autre site.

**Avec Docker** (le plus propre, n'interfère avec rien) :
1. Copier le projet sur le serveur, créer `.env` à partir de `.env.example` (mot de passe, `SESSION_SECRET`, `SECRETS_KEY`).
2. `docker compose up -d` → le site écoute sur `127.0.0.1:3000`, réglages conservés dans un volume.
3. Brancher le sous-domaine via le reverse proxy déjà en place (exemple Nginx : `deploy/nginx.conf`,
   HTTPS gratuit avec `certbot --nginx`).

**Sans Docker** (Node installé directement) :
1. Copier le projet dans `/opt/cours-du-jour`, `npm ci --omit=dev`, créer `.env`.
2. Service au démarrage : `deploy/cours-du-jour.service` (systemd), ou `pm2` (voir « En local »).
3. Reverse proxy + HTTPS comme ci-dessus.

Serveur Windows : installer Node.js, lancer avec `pm2` (ou un service Windows via NSSM), et publier via IIS
(module *URL Rewrite* + *ARR* en reverse proxy vers `http://localhost:3000`).

## Le plus simple : en ligne (recommandé avec Emity)

Emity étant un service en ligne, le plus simple est d'héberger le site en ligne avec HTTPS :
pas de machine à laisser allumée, pas d'IP fixe, pas de DSI, et pas d'écran blanc dans Emity.

1. Mettre le dossier du projet sur un dépôt GitHub **privé**.
2. Sur [render.com](https://render.com) : **New → Blueprint** → choisir le dépôt. Le fichier `render.yaml`
   configure tout (HTTPS, disque pour les réglages, secrets générés automatiquement, `DISPLAY_KEY` activée).
3. Dans Render → *Environment* : coller `ADMIN_PASSWORD_HASH` (obtenu avec `npm run hash-password`).
4. Ouvrir `https://<votre-app>.onrender.com/admin` → saisir la clé API HyperPlanning → Tester → Enregistrer.
5. Onglet **Écrans** → **Copier l'URL** → dans Emity, widget **Site web** → coller → publier.

Coût : offre Render « Starter » (le disque persistant est payant, quelques euros par mois).
Condition : le serveur HyperPlanning doit être joignable depuis Internet (c'est le cas s'il est hébergé en ligne ;
si HyperPlanning n'est accessible que depuis le réseau de l'école, utiliser l'installation en local ci-dessous).

## En local, sur le réseau de l'école

Le serveur tourne sur une machine du campus (Mac, PC ou mini-PC). Rien n'est exposé sur Internet.

1. Sur cette machine : installer Node.js (≥ 18), copier le dossier du projet, puis `npm install`.
2. Dans `.env` : `COOKIE_SECURE=false` (pas de HTTPS en local) et, si possible,
   `ADMIN_ALLOWED_IPS=10.*` (ou la plage du réseau de l'école) pour que seul le réseau interne accède à l'admin.
3. Lancer `npm start`. Le terminal affiche l'adresse à utiliser :
   ```
   Écran (réseau local)   : http://10.37.3.1:3000/ecran/general
   ```
   C'est cette adresse (avec l'IP de la machine) qu'on met dans Emity ou dans le navigateur de la TV.
4. Pour que ça tourne en permanence et redémarre tout seul :
   ```bash
   npm install -g pm2
   pm2 start server.js --name cours-du-jour
   pm2 save
   pm2 startup
   ```
   (`pm2 startup` affiche une commande à copier-coller une fois pour le lancement au démarrage.)

À demander à la DSI :
- une **IP fixe** pour cette machine (réservation DHCP), sinon l'adresse dans Emity change ;
- que le **port 3000** soit autorisé entre les TV/players et cette machine ;
- que la machine ne se mette **jamais en veille**.

**Emity et HTTP local** : si le widget « Site web » d'Emity s'affiche dans une page HTTPS, le navigateur
peut bloquer une adresse `http://` locale (contenu mixte) → écran blanc. Dans ce cas, soit le player ouvre
directement l'URL (mode navigateur / kiosque), soit la DSI met un certificat HTTPS interne devant le serveur.

## Mettre l'écran sur une TV (Emity)

### 1. Mettre le serveur en ligne

Les TV doivent pouvoir joindre le serveur. Deux options :

- **Serveur de l'école** (recommandé) : une VM ou un mini-PC sur le réseau interne, accessible par les players Emity.
- **Hébergeur** (Render, Railway, Fly.io, OVH…) : accessible depuis Internet, donc mettre une `DISPLAY_KEY`.

Dans les deux cas : HTTPS via un reverse proxy (Caddy, Nginx), `NODE_ENV=production`, `TRUST_PROXY=1`,
et un gestionnaire de processus (`pm2 start server.js --name cours-du-jour`) pour un redémarrage automatique.

### 2. Récupérer l'URL de l'écran

Back-office → **Écrans** → **Copier l'URL**. Exemple :
`https://planning.ynov-montpellier.fr/ecran/hall?key=…`

Un écran par emplacement si besoin (ex. `etage-3` avec uniquement M1 et M2).

### 3. L'ajouter dans Emity

Dans E-MANAGER :

1. **Nouvelle création** au format de l'écran (16:9 paysage, ou 9:16 si la TV est verticale).
2. Ajouter le widget **Site web** (catégorie *Web & News*) en **plein écran**, et coller l'URL.
3. Mettre cette création **seule dans la playlist** de la TV, ou avec une durée longue.
   La page gère elle-même le défilement des niveaux, l'horloge et la mise à jour (toutes les 60 s) :
   aucun rechargement côté Emity n'est nécessaire.
4. Publier sur l'écran.

Sans widget : la plupart des players Emity et des Smart TV peuvent aussi ouvrir directement une URL
en plein écran (navigateur en mode kiosque).

À confirmer avec le support Emity : que le widget « Site web » de votre offre accepte une URL externe et que vos
players atteignent le serveur. Si Emity affiche une page blanche, vérifier `DISPLAY_FRAME_ANCESTORS` dans `.env`
(vide = intégration autorisée partout).

### Pourquoi ça tient sur une TV

- Canevas fixe 1920×1080 (ou 1080×1920) mis à l'échelle : même rendu en 720p, 1080p ou 4K.
- JavaScript ES5, pas de CSS Grid : compatible avec les navigateurs anciens des TV (Tizen, webOS, Android).
- Aucune ressource externe : polices et logo hébergés sur le serveur.
- Heure prise sur le serveur (l'horloge des TV dérive souvent).
- Coupure réseau : l'écran garde les dernières données et l'indique (« hors ligne »).
- Rechargement complet toutes les 6 h.

## Sécurité

- Back-office : mot de passe hashé bcrypt, session `HttpOnly` / `SameSite=Strict` / `Secure`, expiration 8 h.
- 8 tentatives de connexion ratées max. par 15 min et par IP.
- Jeton CSRF obligatoire sur toute modification.
- `ADMIN_ALLOWED_IPS` : back-office accessible uniquement depuis le réseau de l'école (404 ailleurs).
- CSP stricte, aucun script externe, `noindex` partout, admin non intégrable en iframe.
- Écrans en lecture seule. Aucune donnée sensible exposée (ni clé, ni URL de source).
  `DISPLAY_KEY` empêche la consultation par des inconnus.

## Arborescence

```
server.js                  Routes écrans, API, back-office, sécurité
src/config.js              Variables d'environnement
src/store.js               Réglages (validation, écriture atomique, clé API chiffrée)
src/secrets.js             Chiffrement AES-256-GCM
src/schedule.js            Synchronisation, fusion des doublons, détection des modifications
src/normalize.js           Niveau, filière, couleur, salle, intervenant
src/sources/hpapi.js       Connecteur API HyperPlanning (clé API)
src/sources/ical.js        Connecteur exports iCal (repli)
src/sources/demo.js        Données de démonstration
public/display/            Écran TV
public/admin/              Back-office
```

## Charte et polices

- Texte : **LT Superior**, la police de ynov.com (LyonsType, licence SIL OFL 1.1, fichier `OFL.txt` fourni dans
  `public/assets/fonts/lt-superior/`, à conserver avec la police).
- Titres : le site utilise **LT Superior Serif**. Elle n'était pas disponible au téléchargement : déposer
  `LTSuperiorSerif-Medium.ttf` (fourni par la com') dans `public/assets/fonts/lt-superior/` et elle sera utilisée
  automatiquement. En attendant : Source Serif 4.
- Toute diffusion au nom d'Ynov Campus nécessite l'accord de la direction de la communication.
