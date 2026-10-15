<?php
/**
 * Sources de données (format commun : uid, summary, description, location, start, end en timestamps, status).
 * - API REST officielle HyperPlanning / PRONOTE Campus (Basic auth, .../hpsw/api/v1/)
 * - Autre API JSON (paramétrable)
 * - Exports iCal (repli)
 * - Démonstration
 */
declare(strict_types=1);

function today_ymd(): string
{
    return date('Y-m-d');
}

/* =====================================================================
 * Démonstration (cours relevés sur les écrans actuels de Montpellier)
 * ===================================================================== */
function demo_events(): array
{
    $rows = [
        ['08:00', '12:00', 'Design Thinking & Nudge B2CPD', 'Madame JAILLON Angelique', ['CREADD B2', 'MKTCD B2'], 'Salle 106, Salle 109'],
        ['09:00', '10:00', 'Anglais 2627 B2', '', ['DIGIA B2'], ''],
        ['09:00', '10:00', 'Archi. infrastructure Data', '', ['DATAE MAST1'], ''],
        ['09:00', '10:00', 'Soft Skills B1', '', ['CYBERSEC B1', 'IADAT B1', 'INFOR B1'], 'Salle 113'],
        ['09:00', '10:30', '7Speaking BTS', '', ['BTS1 YLEVEL'], 'DISTANCIEL'],
        ['09:00', '12:00', 'Captation Son B1', 'Monsieur LEVEQUE Geoffrey', ['AVI B1'], 'Salle 107, Studio 1'],
        ['09:00', '12:00', 'Méthodologies Agile & Scrum', 'Monsieur ATTIK Mohammed', ['DEVFLSTK MAST1', 'DEVMIOT MAST1', 'IADEV MAST1'], 'Salle 305'],
        ['09:00', '13:00', 'AI Habitat - Projet 1', 'Monsieur LIEUTAUD Cyril', ['AINTMOE MAST2'], 'Salle 303 / ART'],
        ['09:00', '13:00', 'APD projet Habitat', 'Monsieur SAINT-CRICQ Frédéric', ['ARCHIN B2'], 'Salle 302 / ART'],
        ['09:00', '13:00', 'Audit SI & Analyse de Besoin', '', ['CSINFRA MAST1'], ''],
        ['09:00', '13:00', 'Culture graphique & LLMs B13D', 'Monsieur DOLATA Benjamin', ['3DTI B1'], 'Salle 101 / Anim 3D'],
        ['09:00', '13:00', 'Culture graphique B1CPD', 'Madame GEKIERE Elodie', ['CREADD B1', 'MKTCD B1', 'DIGIA B1'], 'Salle 105'],
        ['09:00', '13:00', 'Dessin technique Niv1', 'Madame COLLET Adèle', ['ARCHIN B1'], 'Salle ART 001'],
        ['09:00', '13:00', 'Écriture - Storytelling visuel B3CPA', 'Monsieur LABARONNE Arnault', ['AVI B3 CDPAVIM'], 'Salle 104'],
        ['09:00', '13:00', 'Marché, personas & valeur B3CPD', 'Madame RABAUD Soline', ['CREADD B3', 'MKTCD B3'], 'Salle 108'],
        ['09:00', '13:00', 'Physique CIEL IR BTS2', 'Monsieur ELMASRI Djamel', ['BTS2 CIEL A'], 'Salle 306'],
        ['09:00', '13:00', 'U3. Maths Info BTS2', 'Monsieur FAQUIR Mohamed', ['BTS2 SIO SISR', 'BTS2 SIO SLAM'], 'Salle 309', ['modified' => true]],
        ['10:30', '12:30', 'Pentest & Red Team', 'Monsieur MARTIN Hugo', ['CYBERSEC MAST2'], 'Salle 201'],
        ['14:00', '17:00', 'Projet fil rouge', 'Madame DURAND Claire', ['INFOR B2'], 'Salle 202'],
        ['14:00', '18:00', 'Motion design', 'Monsieur PETIT Lucas', ['3DTI B2'], 'Salle 101 / Anim 3D'],
        ['14:00', '16:00', 'Stratégie social media', 'Madame BERNARD Inès', ['MKTCD B3'], 'Salle 108', ['cancelled' => true]],
        ['14:00', '17:30', 'Machine Learning avancé', 'Monsieur ROUX Antoine', ['IADAT MAST2'], 'Salle 305'],
        ['15:30', '17:30', 'Droit du numérique', 'Madame LEROY Sarah', ['DATAE MAST1', 'CSINFRA MAST1'], 'DISTANCIEL'],
    ];
    $today = strtotime('today');
    $h = (int) date('G') + (int) date('i') / 60;
    // Hors des heures de cours : on décale la journée pour qu'il y ait toujours quelque chose à voir
    $shift = ($h < 8 || $h >= 16.5) ? time() - strtotime('today 10:20') : 0;
    $events = [];
    foreach ($rows as $i => $r) {
        [$start, $end, $subject, $teacher, $groups, $room] = $r;
        $extra = $r[6] ?? [];
        $lines = ['Matière : ' . $subject];
        if ($teacher) {
            $lines[] = 'Enseignant : ' . $teacher;
        }
        foreach ($groups as $g) {
            $lines[] = 'Promotion : Montpellier | ' . $g;
        }
        if ($room) {
            $lines[] = 'Salle : ' . $room;
        }
        $events[] = [
            'uid' => 'demo-' . $i,
            'summary' => $subject,
            'description' => implode("\n", $lines),
            'location' => $room,
            'start' => strtotime($start, $today) + $shift,
            'end' => strtotime($end, $today) + $shift,
            'status' => !empty($extra['cancelled']) ? 'CANCELLED' : 'CONFIRMED',
            '_demoModified' => !empty($extra['modified']),
        ];
    }
    return $events;
}

/* =====================================================================
 * iCal
 * ===================================================================== */
function ical_unescape(string $v): string
{
    return strtr($v, ['\\n' => "\n", '\\N' => "\n", '\\,' => ',', '\\;' => ';', '\\\\' => '\\']);
}

function ical_date(string $value, array $params): ?int
{
    $value = trim($value);
    if (preg_match('/^\d{8}$/', $value)) {
        return null; // journée entière : ignorée
    }
    try {
        if (substr($value, -1) === 'Z') {
            $d = DateTime::createFromFormat('Ymd\THis\Z', $value, new DateTimeZone('UTC'));
        } else {
            $tz = isset($params['TZID']) ? new DateTimeZone(trim($params['TZID'], '"')) : new DateTimeZone(date_default_timezone_get());
            $d = DateTime::createFromFormat('Ymd\THis', $value, $tz);
        }
    } catch (Throwable $e) {
        return null;
    }
    return $d ? $d->getTimestamp() : null;
}

function parse_ics(string $text): array
{
    $text = (string) preg_replace("/\r\n|\r/", "\n", $text);
    $text = (string) preg_replace("/\n[ \t]/", '', $text); // lignes repliées
    $events = [];
    $cur = null;
    foreach (explode("\n", $text) as $line) {
        if ($line === 'BEGIN:VEVENT') {
            $cur = [];
            continue;
        }
        if ($line === 'END:VEVENT') {
            if ($cur !== null && isset($cur['start'], $cur['end'])) {
                $events[] = $cur + ['uid' => '', 'summary' => '', 'description' => '', 'location' => '', 'status' => ''];
            }
            $cur = null;
            continue;
        }
        if ($cur === null || !preg_match('/^([A-Z-]+)((?:;[^:]*)?):(.*)$/', $line, $m)) {
            continue;
        }
        $params = [];
        foreach (array_filter(explode(';', $m[2])) as $p) {
            [$k, $v] = array_pad(explode('=', $p, 2), 2, '');
            $params[strtoupper($k)] = $v;
        }
        switch ($m[1]) {
            case 'UID': $cur['uid'] = $m[3]; break;
            case 'SUMMARY': $cur['summary'] = ical_unescape($m[3]); break;
            case 'DESCRIPTION': $cur['description'] = ical_unescape($m[3]); break;
            case 'LOCATION': $cur['location'] = ical_unescape($m[3]); break;
            case 'STATUS': $cur['status'] = $m[3]; break;
            case 'DTSTART': $t = ical_date($m[3], $params); if ($t) { $cur['start'] = $t; } break;
            case 'DTEND': $t = ical_date($m[3], $params); if ($t) { $cur['end'] = $t; } break;
        }
    }
    return $events;
}

function fetch_ical(string $url): array
{
    [$status, $body] = http_get($url, ['Accept: text/calendar, text/plain;q=0.8']);
    if ($status >= 400) {
        throw new RuntimeException('HTTP ' . $status);
    }
    if (strpos($body, 'BEGIN:VCALENDAR') === false) {
        throw new RuntimeException("La réponse n'est pas un calendrier iCal");
    }
    return parse_ics($body);
}

/* =====================================================================
 * API REST officielle HyperPlanning / PRONOTE Campus
 * Spéc. : https://www.index-education.com/FichiersExternes/campus/2026/fr/OpenAPIRestPC.yaml
 * ===================================================================== */
function hp_get(array $cfg, string $secret, string $path, array $query = [])
{
    if (($cfg['baseUrl'] ?? '') === '') {
        throw new RuntimeException('Adresse du Service Web manquante (ex. https://…/hpsw/api/v1/)');
    }
    if ($secret === '') {
        throw new RuntimeException('Mot de passe / clé du Service Web manquant');
    }
    $url = rtrim($cfg['baseUrl'], '/') . '/' . $path;
    if ($query) {
        $url .= '?' . http_build_query(array_map(fn($v) => is_array($v) ? implode(',', $v) : $v, $query));
    }
    $auth = 'Authorization: Basic ' . base64_encode(($cfg['username'] ?? '') . ':' . $secret);
    [$status, $body] = http_get($url, ['Accept: application/json', $auth], 20, false);
    if ($status === 401 || $status === 403) {
        throw new RuntimeException('Identifiant ou clé refusés par HyperPlanning (HTTP ' . $status . ')');
    }
    if ($status >= 300 && $status < 400) { // le Service Web redirige vers sa page d'accueil quand l'accès est refusé
        throw new RuntimeException('Accès refusé par HyperPlanning : clé ou identifiant incorrect, ou API REST non activée sur le Service Web');
    }
    if ($status === 404) {
        throw new RuntimeException('Ressource introuvable : ' . $path . ' (vérifiez l’adresse …/hpsw/api/v1/)');
    }
    if ($status >= 400) {
        throw new RuntimeException('HyperPlanning a répondu HTTP ' . $status . ' sur ' . $path);
    }
    $json = json_decode($body, true);
    if (!is_array($json)) {
        throw new RuntimeException('Accès refusé par HyperPlanning : clé ou identifiant incorrect, ou API REST non activée sur le Service Web');
    }
    return $json;
}

function hp_index($list, callable $label): array
{
    $out = [];
    foreach (is_array($list) ? $list : [] as $x) {
        if (isset($x['cle'])) {
            $out[$x['cle']] = $label($x);
        }
    }
    return $out;
}

/** Référentiels (matières, salles, classes, enseignants) mis en cache 1 h dans data/hp-refs.json. */
function hp_refs(array $cfg, string $secret, bool $force): array
{
    $file = DATA_DIR . '/hp-refs.json';
    $cache = read_json($file, []);
    if (!$force && ($cache['base'] ?? '') === $cfg['baseUrl'] && time() - ($cache['at'] ?? 0) < 3600) {
        return $cache;
    }
    $opt = function (string $p, array $q) use ($cfg, $secret) {
        try {
            return hp_get($cfg, $secret, $p, $q);
        } catch (Throwable $e) {
            return [];
        }
    };
    $refs = [
        'base' => $cfg['baseUrl'],
        'at' => time(),
        'matieres' => hp_index(hp_get($cfg, $secret, 'matieres', ['select' => ['cle', 'libelle', 'libelle_long']]), fn($m) => $m['libelle_long'] ?? $m['libelle'] ?? ''),
        'salles' => hp_index(hp_get($cfg, $secret, 'salles', ['select' => ['cle', 'nom']]), fn($s) => $s['nom'] ?? ''),
        'promotions' => hp_index(hp_get($cfg, $secret, 'promotions', ['select' => ['cle', 'nom']]), fn($p) => $p['nom'] ?? ''),
        'tdoptions' => hp_index($opt('tdoptions', ['select' => ['cle', 'nom']]), fn($t) => $t['nom'] ?? ''),
        'regroupements' => hp_index($opt('regroupements', ['select' => ['cle', 'nom']]), fn($r) => $r['nom'] ?? ''),
        'enseignants' => hp_index(hp_get($cfg, $secret, 'enseignants', ['select' => ['cle', 'nom', 'prenom']]),
            fn($e) => trim(($e['prenom'] ?? '') . ' ' . mb_strtoupper((string) ($e['nom'] ?? '')))),
    ];
    write_json($file, $refs);
    return $refs;
}

function hp_seance_to_event(array $s, array $refs, bool $cancelled): ?array
{
    $start = strtotime((string) ($s['jour_heure_debut'] ?? '')); // sans fuseau = heure locale de l'établissement
    if (!$start) {
        return null;
    }
    $end = $start + (int) round((float) ($s['duree'] ?? 0) * 1440) * 60; // durée exprimée en jours
    $names = function ($keys, string $dict) use ($refs) {
        $out = [];
        foreach ((array) $keys as $k) {
            if (!empty($refs[$dict][$k])) {
                $out[] = $refs[$dict][$k];
            }
        }
        return $out;
    };
    $subject = $refs['matieres'][$s['matiere'] ?? ''] ?? 'Cours';
    $groups = array_merge($names($s['promotions'] ?? [], 'promotions'), $names($s['tdoptions'] ?? [], 'tdoptions'), $names($s['regroupements'] ?? [], 'regroupements'));
    $rooms = $names($s['salles'] ?? [], 'salles');
    $teachers = $names($s['enseignants'] ?? [], 'enseignants');
    $lines = ['Matière : ' . $subject];
    if ($teachers) {
        $lines[] = 'Enseignant : ' . implode(', ', $teachers);
    }
    foreach ($groups as $g) {
        $lines[] = 'Promotion : ' . $g;
    }
    if ($rooms) {
        $lines[] = 'Salle : ' . implode(', ', $rooms);
    }
    if (!empty($s['type'])) {
        $lines[] = 'Type : ' . $s['type'];
    }
    $key = $s['cle'] ?? $s['cle_cours'] ?? '';
    return [
        'uid' => ($cancelled ? 'hp-annule-' : 'hp-') . $key . '-' . ($s['jour_heure_debut'] ?? ''),
        'summary' => $subject,
        'description' => implode("\n", $lines),
        'location' => implode(', ', $rooms),
        'start' => $start,
        'end' => $end,
        'status' => $cancelled ? 'CANCELLED' : 'CONFIRMED',
    ];
}

/** Cours annulés du jour (pas de filtre par date dans l'API : détail mis en cache 30 min). */
function hp_cancelled_today(array $cfg, string $secret, string $day): array
{
    $file = DATA_DIR . '/hp-annules.json';
    $cache = read_json($file, []);
    if (($cache['base'] ?? '') !== $cfg['baseUrl'] || time() - ($cache['at'] ?? 0) > 1800) {
        $cache = ['base' => $cfg['baseUrl'], 'at' => time(), 'byKey' => []];
    }
    try {
        $list = hp_get($cfg, $secret, 'cours_annules', ['select' => ['cle']]);
    } catch (Throwable $e) {
        $list = [];
    }
    $fetched = 0;
    foreach ($list as $c) {
        $k = (string) ($c['cle'] ?? '');
        if ($k === '' || isset($cache['byKey'][$k]) || $fetched >= 40) {
            continue;
        }
        try {
            $cache['byKey'][$k] = hp_get($cfg, $secret, 'cours_annules/' . rawurlencode($k) . '/detail_seances_placees');
        } catch (Throwable $e) {
            $cache['byKey'][$k] = [];
        }
        $fetched++;
    }
    write_json($file, $cache);
    $today = [];
    foreach ($cache['byKey'] as $seances) {
        foreach ((array) $seances as $s) {
            if (strpos((string) ($s['jour_heure_debut'] ?? ''), $day) === 0) {
                $today[] = $s;
            }
        }
    }
    return $today;
}

function fetch_hp_official(array $cfg, string $secret, bool $forceRefs = false): array
{
    $day = today_ymd();
    $refs = hp_refs($cfg, $secret, $forceRefs);
    $seances = hp_get($cfg, $secret, 'cours/detail_seances_placees', ['date_debut' => $day, 'date_fin' => $day]);
    foreach ($seances as $s) { // matière inconnue (créée dans la journée) -> on recharge les référentiels
        if (!empty($s['matiere']) && !isset($refs['matieres'][$s['matiere']]) && !$forceRefs) {
            $refs = hp_refs($cfg, $secret, true);
            break;
        }
    }
    $events = [];
    foreach ($seances as $s) {
        if ($e = hp_seance_to_event($s, $refs, false)) {
            $events[] = $e;
        }
    }
    foreach (hp_cancelled_today($cfg, $secret, $day) as $s) {
        if ($e = hp_seance_to_event($s, $refs, true)) {
            $events[] = $e;
        }
    }
    return ['events' => $events, 'raw' => $seances];
}

/* =====================================================================
 * Autre API JSON (paramétrage avancé)
 * ===================================================================== */
function norm_key($k): string
{
    return (string) preg_replace('/[^a-z0-9]/', '', strip_accents(mb_strtolower((string) $k)));
}

function pick(array $obj, array $names)
{
    $wanted = array_map('norm_key', $names);
    foreach ($obj as $k => $v) {
        if (in_array(norm_key($k), $wanted, true) && $v !== null && $v !== '') {
            return $v;
        }
    }
    return null;
}

function label_of($v): string
{
    if ($v === null) {
        return '';
    }
    if (is_array($v) && array_is_list_compat($v)) {
        return implode(', ', array_filter(array_map('label_of', $v)));
    }
    if (is_array($v)) {
        $nom = pick($v, ['nom', 'lastname', 'name']);
        $prenom = pick($v, ['prenom', 'firstname']);
        if ($nom && $prenom) {
            return $prenom . ' ' . mb_strtoupper((string) $nom);
        }
        return (string) (pick($v, ['libelle', 'libellelong', 'label', 'nom', 'name', 'intitule', 'code']) ?? '');
    }
    return is_bool($v) ? '' : (string) $v;
}

function array_is_list_compat(array $a): bool
{
    return $a === [] || array_keys($a) === range(0, count($a) - 1);
}

function generic_date($dateVal, $timeVal): ?int
{
    if ($dateVal === null) {
        return null;
    }
    if (is_int($dateVal) || is_float($dateVal)) {
        return (int) ($dateVal / 1000);
    }
    $s = (string) $dateVal;
    if ($timeVal !== null && preg_match('/^(\d{1,2})[:h](\d{2})/', (string) $timeVal, $t)) {
        $day = preg_match('#^(\d{2})/(\d{2})/(\d{4})#', $s, $fr) ? "$fr[3]-$fr[2]-$fr[1]" : substr($s, 0, 10);
        return strtotime("$day $t[1]:$t[2]") ?: null;
    }
    if (preg_match('#^(\d{2})/(\d{2})/(\d{4})[ T]?(\d{2})?[:h]?(\d{2})?#', $s, $fr)) {
        return strtotime(sprintf('%s-%s-%s %s:%s', $fr[3], $fr[2], $fr[1], $fr[4] ?: '00', $fr[5] ?? '00')) ?: null;
    }
    return strtotime($s) ?: null;
}

function fetch_hp_generic(array $cfg, string $key): array
{
    if (($cfg['baseUrl'] ?? '') === '') {
        throw new RuntimeException("URL de l'API manquante");
    }
    if ($key === '') {
        throw new RuntimeException('Clé API manquante');
    }
    $path = strtr((string) $cfg['coursesPath'], ['{date}' => date('Y-m-d'), '{dateFR}' => date('d/m/Y')]);
    $url = rtrim($cfg['baseUrl'], '/') . '/' . ltrim($path, '/');
    $headers = ['Accept: application/json'];
    switch ($cfg['authMode']) {
        case 'bearer': $headers[] = 'Authorization: Bearer ' . $key; break;
        case 'basic': $headers[] = 'Authorization: Basic ' . base64_encode(($cfg['username'] ?? '') . ':' . $key); break;
        case 'header': $headers[] = ($cfg['headerName'] ?: 'X-API-Key') . ': ' . $key; break;
        case 'query': $url .= (strpos($url, '?') === false ? '?' : '&') . rawurlencode($cfg['headerName'] ?: 'apikey') . '=' . rawurlencode($key); break;
    }
    [$status, $body] = http_get($url, $headers);
    if ($status === 401 || $status === 403) {
        throw new RuntimeException('Clé API refusée (HTTP ' . $status . ')');
    }
    if ($status >= 400) {
        throw new RuntimeException('HTTP ' . $status);
    }
    $json = json_decode($body, true);
    if (!is_array($json)) {
        throw new RuntimeException("La réponse n'est pas du JSON (vérifiez le chemin de la ressource)");
    }
    $items = $json;
    if (!array_is_list_compat($json)) {
        $items = pick($json, ['cours', 'courses', 'data', 'items', 'results', 'value', 'seances', 'events']) ?? [];
        if (!is_array($items) || !array_is_list_compat($items)) {
            $items = [];
            foreach ($json as $v) {
                if (is_array($v) && array_is_list_compat($v)) {
                    $items = $v;
                    break;
                }
            }
        }
    }
    $events = [];
    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }
        $day = pick($item, ['date', 'jour', 'day']);
        $start = generic_date(pick($item, ['debut', 'datedebut', 'dateheuredebut', 'start', 'startdate']), null) ?? generic_date($day, pick($item, ['heuredebut', 'starttime']));
        $end = generic_date(pick($item, ['fin', 'datefin', 'dateheurefin', 'end', 'enddate']), null) ?? generic_date($day, pick($item, ['heurefin', 'endtime']));
        if (!$start || !$end) {
            continue;
        }
        $subject = label_of(pick($item, ['matiere', 'matieres', 'libellematiere', 'subject', 'libelle', 'intitule', 'nom']));
        $teachers = label_of(pick($item, ['enseignants', 'enseignant', 'intervenants', 'intervenant', 'professeurs', 'teachers']));
        $groups = pick($item, ['promotions', 'promotion', 'td', 'tds', 'groupes', 'groupe', 'classes', 'publics', 'regroupements', 'groups']);
        $rooms = label_of(pick($item, ['salles', 'salle', 'rooms', 'room', 'lieu', 'location']));
        $statut = label_of(pick($item, ['statut', 'status', 'etat']));
        $cancelled = pick($item, ['annule', 'estannule', 'cancelled']) === true || preg_match('/annul|cancel/i', $statut);
        $lines = ['Matière : ' . ($subject ?: 'Cours')];
        if ($teachers) {
            $lines[] = 'Enseignant : ' . $teachers;
        }
        foreach ((is_array($groups) && array_is_list_compat($groups)) ? $groups : ($groups ? [$groups] : []) as $g) {
            $lines[] = 'Promotion : ' . label_of($g);
        }
        if ($rooms) {
            $lines[] = 'Salle : ' . $rooms;
        }
        $events[] = ['uid' => (string) (pick($item, ['id', 'cle', 'uid']) ?? ''), 'summary' => $subject, 'description' => implode("\n", $lines),
            'location' => $rooms, 'start' => $start, 'end' => $end, 'status' => $cancelled ? 'CANCELLED' : 'CONFIRMED'];
    }
    return ['events' => $events, 'raw' => $items];
}
