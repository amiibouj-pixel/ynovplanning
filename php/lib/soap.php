<?php
/**
 * Service Web SOAP HyperPlanning (WSDL type https://<serveur>/hpsw/wsdl/RpcEncoded), auth Basic.
 * Pas besoin de l'extension soap, les enveloppes sont faites à la main.
 *
 * Les noms d'opérations changent selon les versions d'HP, donc on prend le premier qui existe
 * dans SOAP_ROLES. Si le test de l'admin affiche une opération manquante, ajouter son nom ici.
 */
declare(strict_types=1);

const SOAP_ROLES = [
    // Liste des cours/séances d'une période (date début, date fin)
    'listRange' => ['CoursEntre2Dates', 'CoursEntreDeuxDates', 'TableauDeCoursEntre2Dates', 'SeancesEntre2Dates', 'SeancesEntreDeuxDates', 'CoursPlacesEntre2Dates'],
    'cancelledRange' => ['CoursAnnulesEntre2Dates', 'CoursAnnulesEntreDeuxDates', 'SeancesAnnuleesEntre2Dates'],
    'listAll' => ['TousLesCours'],
    // Détail d'un cours (clé du cours)
    'start' => ['DateEtHeureDebutCours', 'DateHeureDebutCours', 'DebutCours', 'JourEtHeureDebutCours', 'DateDebutCours', 'HeureDebutCours'],
    'end' => ['DateEtHeureFinCours', 'DateHeureFinCours', 'FinCours', 'DateFinCours', 'HeureFinCours'],
    'duration' => ['DureeCours', 'DureeDuCours'],
    'subject' => ['MatiereDuCours', 'MatiereCours'],
    'rooms' => ['SallesDuCours', 'SallesCours'],
    'promotions' => ['PromotionsDuCours', 'PromotionsCours'],
    'tdoptions' => ['TDOptionsDuCours', 'TDOptionsCours'],
    'teachers' => ['EnseignantsDuCours', 'EnseignantsCours'],
    'cancelled' => ['EstAnnuleCours', 'CoursEstAnnule', 'CoursAnnule'],
    // Libellés (clé -> nom)
    'subjectName' => ['LibelleLongMatiere', 'LibelleMatiere', 'NomMatiere'],
    'roomName' => ['NomSalle', 'LibelleSalle'],
    'promotionName' => ['NomPromotion', 'LibellePromotion'],
    'tdoptionName' => ['NomTDOption', 'LibelleTDOption'],
    'teacherName' => ['NomEnseignant'],
    'teacherFirstName' => ['PrenomEnseignant'],
];

const SOAP_MAX_COURSES = 400; // garde-fou : pas plus de cours détaillés par synchronisation

/* ---------- WSDL ---------- */

function soap_auth_header(array $cfg, string $secret): string
{
    return 'Authorization: Basic ' . base64_encode(($cfg['username'] ?? '') . ':' . $secret);
}

/** Lit le WSDL (cache 1 h) : point d'accès, espace de noms, style, opérations et leurs paramètres. */
function soap_wsdl(array $cfg, string $secret, bool $force = false): array
{
    $url = (string) ($cfg['baseUrl'] ?? '');
    if ($url === '') {
        throw new RuntimeException('Adresse du WSDL manquante (ex. https://…/hpsw/wsdl/RpcEncoded)');
    }
    if ($secret === '') {
        throw new RuntimeException('Mot de passe du Service Web manquant');
    }
    $file = DATA_DIR . '/hp-wsdl.json';
    $cache = read_json($file, []);
    if (!$force && ($cache['url'] ?? '') === $url && time() - ($cache['at'] ?? 0) < 3600) {
        return $cache;
    }
    [$status, $body] = http_get($url, ['Accept: text/xml, application/xml', soap_auth_header($cfg, $secret)], 20, true);
    if ($status === 401 || $status === 403) {
        throw new RuntimeException('Identifiant ou mot de passe refusés par HyperPlanning (HTTP ' . $status . ')');
    }
    if ($status >= 400) {
        throw new RuntimeException('WSDL introuvable (HTTP ' . $status . ') : vérifiez l’adresse …/hpsw/wsdl/RpcEncoded');
    }
    $dom = new DOMDocument();
    if (!@$dom->loadXML($body, LIBXML_NONET) || stripos($dom->documentElement->localName ?? '', 'definitions') === false) {
        throw new RuntimeException('La réponse n’est pas un WSDL : vérifiez l’adresse (elle se termine en général par /hpsw/wsdl/RpcEncoded)');
    }
    $root = $dom->documentElement;
    $tns = $root->getAttribute('targetNamespace');
    $messages = [];
    foreach ($dom->getElementsByTagNameNS('*', 'message') as $m) {
        $parts = [];
        foreach ($m->getElementsByTagNameNS('*', 'part') as $p) {
            $parts[] = ['name' => $p->getAttribute('name'), 'type' => preg_replace('/^.*:/', '', $p->getAttribute('type') ?: $p->getAttribute('element'))];
        }
        $messages[$m->getAttribute('name')] = $parts;
    }
    $ops = [];
    foreach ($dom->getElementsByTagNameNS('*', 'portType') as $pt) {
        foreach ($pt->getElementsByTagNameNS('*', 'operation') as $op) {
            $in = $op->getElementsByTagNameNS('*', 'input')->item(0);
            $msg = $in ? preg_replace('/^.*:/', '', $in->getAttribute('message')) : '';
            $ops[$op->getAttribute('name')] = ['params' => $messages[$msg] ?? [], 'action' => '', 'ns' => $tns];
        }
    }
    $literal = false;
    foreach ($dom->getElementsByTagNameNS('*', 'binding') as $b) {
        foreach ($b->getElementsByTagNameNS('*', 'operation') as $op) {
            $name = $op->getAttribute('name');
            if (!isset($ops[$name])) {
                continue;
            }
            foreach ($op->childNodes as $child) {
                if ($child instanceof DOMElement && $child->localName === 'operation' && $child->hasAttribute('soapAction')) {
                    $ops[$name]['action'] = $child->getAttribute('soapAction');
                }
            }
            $body = $op->getElementsByTagNameNS('*', 'body')->item(0);
            if ($body instanceof DOMElement) {
                $literal = $literal || $body->getAttribute('use') === 'literal';
                if ($body->getAttribute('namespace') !== '') {
                    $ops[$name]['ns'] = $body->getAttribute('namespace');
                }
            }
        }
    }
    $endpoint = '';
    foreach ($dom->getElementsByTagNameNS('*', 'address') as $a) {
        if ($a->getAttribute('location') !== '') {
            $endpoint = $a->getAttribute('location');
            break;
        }
    }
    if ($endpoint === '') {
        $endpoint = preg_replace('#/wsdl/.*$#i', '/soap/', $url);
    }
    // Le WSDL annonce parfois une adresse interne (http://localhost…) : on garde l'hôte saisi dans le back-office
    $given = parse_url($url);
    $ep = parse_url($endpoint);
    if ($given && $ep && ($ep['host'] ?? '') !== ($given['host'] ?? '')) {
        $endpoint = $given['scheme'] . '://' . $given['host'] . (isset($given['port']) ? ':' . $given['port'] : '') . ($ep['path'] ?? '/') . (isset($ep['query']) ? '?' . $ep['query'] : '');
    }
    $wsdl = ['url' => $url, 'at' => time(), 'endpoint' => $endpoint, 'literal' => $literal, 'ops' => $ops];
    write_json($file, $wsdl);
    return $wsdl;
}

/** Pour chaque rôle, première opération du WSDL qui correspond (insensible à la casse). */
function soap_resolve(array $wsdl): array
{
    $byLower = [];
    foreach (array_keys($wsdl['ops']) as $name) {
        $byLower[strtolower($name)] = $name;
    }
    $found = [];
    foreach (SOAP_ROLES as $role => $candidates) {
        foreach ($candidates as $c) {
            if (isset($byLower[strtolower($c)])) {
                $found[$role] = $byLower[strtolower($c)];
                break;
            }
        }
    }
    return $found;
}

/* ---------- Appels ---------- */

function soap_xsd_type(string $type): string
{
    $t = strtolower($type);
    if (in_array($t, ['int', 'integer', 'long', 'short', 'byte', 'unsignedint', 'unsignedlong'], true)) {
        return 'xsd:int';
    }
    if (in_array($t, ['double', 'float', 'decimal'], true)) {
        return 'xsd:double';
    }
    if ($t === 'boolean') {
        return 'xsd:boolean';
    }
    if ($t === 'datetime') {
        return 'xsd:dateTime';
    }
    if ($t === 'date') {
        return 'xsd:date';
    }
    return 'xsd:string';
}

/** Date (Y-m-d) au format attendu par le paramètre : date, dateTime ou nombre (TDateTime Delphi). */
function soap_date_arg(string $ymd, string $type, bool $endOfDay)
{
    $t = strtolower($type);
    if ($t === 'date') {
        return $ymd;
    }
    if (in_array($t, ['double', 'float', 'decimal'], true)) { // jours depuis le 30/12/1899
        $days = (strtotime($ymd . ' 00:00:00 UTC') - strtotime('1899-12-30 00:00:00 UTC')) / 86400;
        return $endOfDay ? $days + 0.99999 : $days;
    }
    return $ymd . ($endOfDay ? 'T23:59:59' : 'T00:00:00');
}

function soap_envelope(array $wsdl, string $op, array $args): string
{
    $def = $wsdl['ops'][$op];
    $encoded = !$wsdl['literal'];
    $xml = '';
    foreach (array_values($def['params']) as $i => $p) {
        if (!array_key_exists($i, $args)) {
            break;
        }
        $v = $args[$i];
        $v = is_bool($v) ? ($v ? 'true' : 'false') : (string) $v;
        $type = $encoded ? ' xsi:type="' . soap_xsd_type($p['type']) . '"' : '';
        $xml .= '<' . $p['name'] . $type . '>' . htmlspecialchars($v, ENT_XML1) . '</' . $p['name'] . '>';
    }
    $style = $encoded ? ' soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"' : '';
    return '<?xml version="1.0" encoding="UTF-8"?>'
        . '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema"'
        . ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/"' . $style . '>'
        . '<soap:Body><ns:' . $op . ' xmlns:ns="' . htmlspecialchars($def['ns'], ENT_XML1) . '">' . $xml . '</ns:' . $op . '></soap:Body></soap:Envelope>';
}

/** Transforme un élément de réponse en valeur PHP (texte, nombre, tableau), en suivant les références multiRef. */
function soap_value(DOMElement $el, array $ids)
{
    if ($el->hasAttribute('href')) {
        $ref = $ids[ltrim($el->getAttribute('href'), '#')] ?? null;
        return $ref ? soap_value($ref, $ids) : null;
    }
    $children = [];
    foreach ($el->childNodes as $c) {
        if ($c instanceof DOMElement) {
            $children[] = $c;
        }
    }
    if (!$children) {
        if ($el->getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'nil') === 'true') {
            return null;
        }
        return trim($el->textContent);
    }
    $out = [];
    $names = [];
    foreach ($children as $c) {
        $names[$c->localName] = true;
    }
    $isList = count($names) === 1 && count($children) > 1 || in_array(strtolower(array_key_first($names)), ['item', 'return'], true)
        || stripos($el->getAttributeNS('http://schemas.xmlsoap.org/soap/encoding/', 'arrayType'), '[') !== false;
    foreach ($children as $c) {
        if ($isList) {
            $out[] = soap_value($c, $ids);
        } else {
            $out[$c->localName] = soap_value($c, $ids);
        }
    }
    return $out;
}

function soap_parse_response(string $body, string $op)
{
    $dom = new DOMDocument();
    if (!@$dom->loadXML($body, LIBXML_NONET)) {
        throw new RuntimeException('Réponse SOAP illisible pour ' . $op);
    }
    $fault = $dom->getElementsByTagNameNS('*', 'Fault')->item(0);
    if ($fault) {
        $msg = $fault->getElementsByTagName('faultstring')->item(0);
        throw new RuntimeException('HyperPlanning (' . $op . ') : ' . trim($msg ? $msg->textContent : $fault->textContent));
    }
    $ids = [];
    $xp = new DOMXPath($dom);
    foreach ($xp->query('//*[@id]') as $el) {
        $ids[$el->getAttribute('id')] = $el;
    }
    $bodyEl = $dom->getElementsByTagNameNS('*', 'Body')->item(0);
    $resp = null;
    foreach ($bodyEl ? $bodyEl->childNodes : [] as $c) {
        if ($c instanceof DOMElement && !$c->hasAttribute('id')) {
            $resp = $c;
            break;
        }
    }
    if (!$resp) {
        return null;
    }
    foreach ($resp->childNodes as $c) { // première valeur de retour
        if ($c instanceof DOMElement) {
            return soap_value($c, $ids);
        }
    }
    return null;
}

/** Appelle plusieurs opérations en parallèle (cURL multi). $calls = [[op, args], …] -> résultats dans le même ordre. */
function soap_call_many(array $cfg, string $secret, array $wsdl, array $calls, int $parallel = 8): array
{
    $results = [];
    $auth = soap_auth_header($cfg, $secret);
    foreach (array_chunk($calls, $parallel, true) as $chunk) {
        $mh = curl_multi_init();
        $handles = [];
        foreach ($chunk as $i => [$op, $args]) {
            $ch = curl_init($wsdl['endpoint']);
            $action = $wsdl['ops'][$op]['action'] ?: ($wsdl['ops'][$op]['ns'] . '#' . $op);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => soap_envelope($wsdl, $op, $args),
                CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                CURLOPT_TIMEOUT => 20,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_HTTPHEADER => ['Content-Type: text/xml; charset=utf-8', 'SOAPAction: "' . $action . '"', $auth],
                CURLOPT_USERAGENT => 'CoursDuJour-Ynov/1.0',
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$i] = $ch;
        }
        do {
            $st = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running && $st === CURLM_OK);
        foreach ($handles as $i => $ch) {
            $body = curl_multi_getcontent($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $err = curl_error($ch);
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            $op = $calls[$i][0];
            if ($status === 401 || $status === 403) {
                throw new RuntimeException('Identifiant ou mot de passe refusés par HyperPlanning (HTTP ' . $status . ')');
            }
            if (!$body) {
                throw new RuntimeException('HyperPlanning injoignable (' . ($err ?: 'HTTP ' . $status) . ')');
            }
            $results[$i] = soap_parse_response($body, $op);
        }
        curl_multi_close($mh);
    }
    ksort($results);
    return $results;
}

function soap_call(array $cfg, string $secret, array $wsdl, string $op, array $args = [])
{
    return soap_call_many($cfg, $secret, $wsdl, [[$op, $args]])[0];
}

/* ---------- Interprétation des valeurs ---------- */

function soap_list($v): array
{
    if ($v === null || $v === '') {
        return [];
    }
    if (!is_array($v)) {
        return [$v];
    }
    $flat = [];
    array_walk_recursive($v, function ($x) use (&$flat) {
        if ($x !== null && $x !== '') {
            $flat[] = $x;
        }
    });
    return $flat;
}

/** Date/heure HyperPlanning -> horodatage : ISO 8601, « JJ/MM/AAAA HH:MM » ou TDateTime (nombre de jours). */
function soap_time($v): ?int
{
    if (is_array($v)) {
        $v = soap_list($v)[0] ?? null;
    }
    if ($v === null || $v === '') {
        return null;
    }
    $s = (string) $v;
    if (is_numeric($s) && (float) $s > 10000) {
        $base = new DateTime('1899-12-30 00:00:00');
        return $base->getTimestamp() + (int) round((float) $s * 86400);
    }
    if (preg_match('#^(\d{2})/(\d{2})/(\d{4})(?:[ T](\d{1,2})[:h](\d{2}))?#', $s, $m)) {
        return strtotime(sprintf('%s-%s-%s %02d:%s:00', $m[3], $m[2], $m[1], (int) ($m[4] ?? 0), $m[5] ?? '00')) ?: null;
    }
    $t = strtotime($s);
    return $t ?: null;
}

/** Durée -> secondes : fraction de jour (< 1), heures (< 24 avec décimales) ou minutes. */
function soap_duration($v): int
{
    $v = is_array($v) ? (soap_list($v)[0] ?? 0) : $v;
    if (is_string($v) && preg_match('/^(\d{1,2})[:h](\d{2})/', $v, $m)) {
        return ((int) $m[1] * 60 + (int) $m[2]) * 60;
    }
    $n = (float) $v;
    if ($n <= 0) {
        return 0;
    }
    if ($n < 1) {
        return (int) round($n * 1440) * 60; // fraction de jour, arrondie à la minute
    }
    if ($n <= 12) {
        return (int) round($n * 3600);
    }
    return (int) round($n * 60);
}

/* ---------- Récupération des cours du jour ---------- */

/** Libellés (matières, salles…) mis en cache 1 h. */
function soap_names(array $cfg, string $secret, array $wsdl, array $ops, string $role, array $keys, array &$cache): array
{
    $out = [];
    $missing = [];
    foreach (array_unique($keys) as $k) {
        if (isset($cache[$role][$k])) {
            $out[$k] = $cache[$role][$k];
        } elseif (isset($ops[$role])) {
            $missing[] = $k;
        }
    }
    if ($missing) {
        $calls = [];
        foreach ($missing as $k) {
            $calls[] = [$ops[$role], [$k]];
        }
        if ($role === 'teacherName' && isset($ops['teacherFirstName'])) {
            foreach ($missing as $k) {
                $calls[] = [$ops['teacherFirstName'], [$k]];
            }
        }
        $res = soap_call_many($cfg, $secret, $wsdl, $calls);
        foreach ($missing as $i => $k) {
            $name = trim((string) (soap_list($res[$i])[0] ?? ''));
            if ($role === 'teacherName') {
                $first = trim((string) (soap_list($res[$i + count($missing)] ?? null)[0] ?? ''));
                $name = trim($first . ' ' . mb_strtoupper($name));
            }
            $cache[$role][$k] = $out[$k] = $name;
        }
    }
    return $out;
}

function fetch_hp_soap(array $cfg, string $secret, bool $force = false): array
{
    $wsdl = soap_wsdl($cfg, $secret, $force);
    $ops = soap_resolve($wsdl);
    if (!isset($ops['start']) && !isset($ops['listRange'])) {
        throw new RuntimeException('Opérations attendues introuvables dans le WSDL (cours d’une période, horaires). Opérations disponibles : '
            . implode(', ', array_slice(array_keys($wsdl['ops']), 0, 80)));
    }
    $day = today_ymd();
    $dayStart = strtotime($day . ' 00:00:00');
    $dayEnd = $dayStart + 86400;

    // 1. Clés des cours (du jour si possible)
    $cancelledKeys = [];
    if (isset($ops['listRange'])) {
        $p = $wsdl['ops'][$ops['listRange']]['params'];
        $keys = soap_list(soap_call($cfg, $secret, $wsdl, $ops['listRange'], [
            soap_date_arg($day, $p[0]['type'] ?? 'dateTime', false), soap_date_arg($day, $p[1]['type'] ?? 'dateTime', true)]));
        if (isset($ops['cancelledRange'])) {
            $pc = $wsdl['ops'][$ops['cancelledRange']]['params'];
            try {
                $cancelledKeys = soap_list(soap_call($cfg, $secret, $wsdl, $ops['cancelledRange'], [
                    soap_date_arg($day, $pc[0]['type'] ?? 'dateTime', false), soap_date_arg($day, $pc[1]['type'] ?? 'dateTime', true)]));
            } catch (Throwable $e) {
                $cancelledKeys = [];
            }
        }
    } else {
        $keys = soap_list(soap_call($cfg, $secret, $wsdl, $ops['listAll']));
    }
    $keys = array_values(array_unique(array_merge($keys, $cancelledKeys)));
    $raw = ['operations' => $ops, 'cours' => count($keys)];

    // 2. Horaires (pour filtrer sur aujourd'hui quand la liste n'est pas déjà filtrée)
    $timeRoles = array_values(array_filter(['start', 'end', 'duration'], fn($r) => isset($ops[$r])));
    $calls = [];
    foreach ($keys as $k) {
        foreach ($timeRoles as $r) {
            $calls[] = [$ops[$r], [$k]];
        }
    }
    if (count($keys) > SOAP_MAX_COURSES && !isset($ops['listRange'])) {
        throw new RuntimeException(count($keys) . ' cours renvoyés sans filtre de date : trop pour être lus à chaque synchronisation. '
            . 'Il faut une opération « cours entre deux dates » (opérations disponibles : ' . implode(', ', array_slice(array_keys($wsdl['ops']), 0, 80)) . ')');
    }
    $timeRes = $calls ? soap_call_many($cfg, $secret, $wsdl, $calls) : [];
    $courses = [];
    foreach ($keys as $i => $k) {
        $vals = [];
        foreach ($timeRoles as $j => $r) {
            $vals[$r] = $timeRes[$i * count($timeRoles) + $j] ?? null;
        }
        $start = soap_time($vals['start'] ?? null);
        if (!$start) {
            continue;
        }
        $end = isset($vals['end']) ? soap_time($vals['end']) : null;
        if (!$end || $end <= $start) {
            $end = $start + (soap_duration($vals['duration'] ?? 0) ?: 3600);
        }
        if ($end <= $dayStart || $start >= $dayEnd) {
            continue;
        }
        $courses[$k] = ['start' => $start, 'end' => $end];
    }

    // 3. Détail des cours du jour (matière, salles, classes, enseignants)
    $detailRoles = array_values(array_filter(['subject', 'rooms', 'promotions', 'tdoptions', 'teachers', 'cancelled'], fn($r) => isset($ops[$r])));
    $calls = [];
    foreach (array_keys($courses) as $k) {
        foreach ($detailRoles as $r) {
            $calls[] = [$ops[$r], [$k]];
        }
    }
    $detailRes = $calls ? soap_call_many($cfg, $secret, $wsdl, $calls) : [];
    $i = 0;
    foreach (array_keys($courses) as $k) {
        foreach ($detailRoles as $r) {
            $courses[$k][$r] = soap_list($detailRes[$i++] ?? null);
        }
    }

    // 4. Libellés (cache 1 h)
    $file = DATA_DIR . '/hp-soap-names.json';
    $cache = read_json($file, []);
    if (($cache['url'] ?? '') !== $cfg['baseUrl'] || time() - ($cache['at'] ?? 0) > 3600 || $force) {
        $cache = ['url' => $cfg['baseUrl'], 'at' => time()];
    }
    $collect = fn(string $field) => array_merge([], ...array_map(fn($c) => $c[$field] ?? [], array_values($courses)));
    $names = [
        'subject' => soap_names($cfg, $secret, $wsdl, $ops, 'subjectName', $collect('subject'), $cache),
        'rooms' => soap_names($cfg, $secret, $wsdl, $ops, 'roomName', $collect('rooms'), $cache),
        'promotions' => soap_names($cfg, $secret, $wsdl, $ops, 'promotionName', $collect('promotions'), $cache),
        'tdoptions' => soap_names($cfg, $secret, $wsdl, $ops, 'tdoptionName', $collect('tdoptions'), $cache),
        'teachers' => soap_names($cfg, $secret, $wsdl, $ops, 'teacherName', $collect('teachers'), $cache),
    ];
    write_json($file, $cache);

    $label = fn(array $list, string $dict) => array_values(array_filter(array_map(fn($x) => $names[$dict][$x] ?? (is_numeric($x) ? '' : (string) $x), $list)));
    $events = [];
    foreach ($courses as $k => $c) {
        $subject = $label($c['subject'] ?? [], 'subject')[0] ?? 'Cours';
        $rooms = $label($c['rooms'] ?? [], 'rooms');
        $groups = array_merge($label($c['promotions'] ?? [], 'promotions'), $label($c['tdoptions'] ?? [], 'tdoptions'));
        $teachers = $label($c['teachers'] ?? [], 'teachers');
        $flag = strtolower((string) (($c['cancelled'] ?? [])[0] ?? ''));
        $cancelled = in_array((string) $k, array_map('strval', $cancelledKeys), true) || in_array($flag, ['true', '1'], true);
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
        $events[] = [
            'uid' => 'hpsoap-' . $k . '-' . $c['start'],
            'summary' => $subject,
            'description' => implode("\n", $lines),
            'location' => implode(', ', $rooms),
            'start' => $c['start'],
            'end' => $c['end'],
            'status' => $cancelled ? 'CANCELLED' : 'CONFIRMED',
        ];
    }
    return ['events' => $events, 'raw' => [$raw], 'operations' => $ops, 'available' => array_keys($wsdl['ops'])];
}
