<?php
// Pas de process qui tourne en continu sur un mutualisé : on resynchronise quand un écran appelle
// et que le cache est trop vieux (avec un verrou pour ne pas lancer 10 synchros en même temps)
declare(strict_types=1);

function state_file(): string
{
    return DATA_DIR . '/state.json';
}

function state_load(): array
{
    return array_merge(
        ['courses' => [], 'lastFetchAt' => null, 'lastSuccessAt' => null, 'errors' => [], 'fingerprints' => [], 'modifiedAt' => [], 'sourceKey' => ''],
        read_json(state_file(), [])
    );
}

function course_fingerprint(array $c): string
{
    return sha1(implode('#', [$c['start'], $c['end'], $c['subject'], $c['teacher'], implode('|', $c['rooms']), $c['remote'] ? 1 : 0, $c['cancelled'] ? 1 : 0]));
}

/** HyperPlanning exporte souvent le même cours pour chaque promotion : on fusionne. */
function merge_courses(array $courses): array
{
    $byKey = [];
    foreach ($courses as $c) {
        $key = implode('#', [$c['start'], $c['end'], mb_strtolower($c['subject']), mb_strtolower($c['teacher'])]);
        if (!isset($byKey[$key])) {
            $byKey[$key] = $c;
            continue;
        }
        $prev = &$byKey[$key];
        $labels = array_column($prev['groups'], 'label');
        foreach ($c['groups'] as $g) {
            if (!in_array($g['label'], $labels, true)) {
                $prev['groups'][] = $g;
            }
        }
        foreach ($c['rooms'] as $r) {
            if (!in_array($r, $prev['rooms'], true)) {
                $prev['rooms'][] = $r;
            }
        }
        $prev['remote'] = $prev['remote'] || $c['remote'];
        $prev['cancelled'] = $prev['cancelled'] && $c['cancelled'];
        unset($prev);
    }
    return array_values($byKey);
}

/** Identifie la configuration des sources : si elle change, on ne marque pas tout "modifié". */
function source_key(array $settings): string
{
    return sha1(json_encode([$settings['demoMode'], $settings['hpApi'], $settings['sources'], $settings['groupPrefix']]));
}

function schedule_refresh(bool $force = false): array
{
    $settings = settings_load();
    $lock = fopen(DATA_DIR . '/refresh.lock', 'c');
    if (!$lock) {
        return state_load();
    }
    if (!flock($lock, $force ? LOCK_EX : LOCK_EX | LOCK_NB)) {
        fclose($lock); // un autre écran est déjà en train de rafraîchir
        return state_load();
    }
    try {
        $state = state_load();
        if (!$force && $state['lastFetchAt'] && time() - (int) ($state['lastFetchAt'] / 1000) < $settings['refreshMinutes'] * 60) {
            return $state; // déjà rafraîchi par un autre appel entre-temps
        }

        $jobs = [];
        if (!$settings['demoMode']) {
            if ($settings['hpApi']['enabled']) {
                $jobs[] = ['API HyperPlanning', function () use ($settings) {
                    switch ($settings['hpApi']['flavor']) {
                        case 'generic':
                            return fetch_hp_generic($settings['hpApi'], hp_api_key())['events'];
                        case 'soap':
                            return fetch_hp_soap($settings['hpApi'], hp_api_key())['events'];
                        default:
                            return fetch_hp_official($settings['hpApi'], hp_api_key())['events'];
                    }
                }];
            }
            foreach ($settings['sources'] as $i => $src) {
                $jobs[] = [$src['name'] ?: 'iCal ' . ($i + 1), fn() => fetch_ical($src['url'])];
            }
        }
        $raw = [];
        $errors = [];
        if (!$jobs) {
            $raw = demo_events();
        } else {
            foreach ($jobs as [$name, $run]) {
                try {
                    $raw = array_merge($raw, $run());
                } catch (Throwable $e) {
                    $errors[] = ['source' => $name, 'message' => $e->getMessage()];
                }
            }
        }
        $state['lastFetchAt'] = now_ms();
        $state['errors'] = $errors;

        // Toutes les sources en erreur : on garde les dernières données valides
        if ($jobs && count($errors) === count($jobs)) {
            write_json(state_file(), $state);
            return $state;
        }

        $key = source_key($settings);
        if ($state['sourceKey'] !== $key) {
            $state['fingerprints'] = [];
            $state['modifiedAt'] = [];
            $state['sourceKey'] = $key;
        }
        $firstLoad = !$state['fingerprints'];
        $today = today_ymd();
        $courses = [];
        foreach ($raw as $ev) {
            if (date('Y-m-d', (int) $ev['start']) !== $today) {
                continue;
            }
            try {
                $c = to_course($ev, $settings);
                $c['_demoModified'] = !empty($ev['_demoModified']);
                $courses[] = $c;
            } catch (Throwable $e) {
            }
        }
        $courses = merge_courses($courses);
        $now = now_ms();
        $fps = [];
        foreach ($courses as &$c) {
            $c['id'] = $c['uid'] !== '' ? $c['uid'] : sha1($c['start'] . $c['end'] . $c['subject']);
            $fp = course_fingerprint($c);
            $prev = $state['fingerprints'][$c['id']] ?? null;
            if (!$firstLoad && $prev !== $fp) {
                $state['modifiedAt'][$c['id']] = $now;
            }
            if ($c['_demoModified'] && !isset($state['modifiedAt'][$c['id']])) {
                $state['modifiedAt'][$c['id']] = $now - 20 * 60000;
            }
            $fps[$c['id']] = $fp;
            unset($c['_demoModified'], $c['uid']);
        }
        unset($c);
        usort($courses, fn($a, $b) => [$a['start'], $a['end']] <=> [$b['start'], $b['end']]);
        $state['fingerprints'] = $fps;
        $state['modifiedAt'] = array_intersect_key($state['modifiedAt'], $fps); // on oublie les jours passés
        $state['courses'] = $courses;
        $state['lastSuccessAt'] = $state['lastFetchAt'];
        write_json(state_file(), $state);
        return $state;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function schedule_get(): array
{
    $state = state_load();
    $settings = settings_load();
    $stale = !$state['lastFetchAt'] || time() - (int) ($state['lastFetchAt'] / 1000) >= $settings['refreshMinutes'] * 60;
    $dayChanged = $state['lastFetchAt'] && date('Y-m-d', (int) ($state['lastFetchAt'] / 1000)) !== today_ymd();
    return ($stale || $dayChanged) ? schedule_refresh() : $state;
}

function schedule_status(array $state): array
{
    return [
        'lastFetchAt' => $state['lastFetchAt'] ? iso((int) ($state['lastFetchAt'] / 1000)) : null,
        'lastSuccessAt' => $state['lastSuccessAt'] ? iso((int) ($state['lastSuccessAt'] / 1000)) : null,
        'errors' => $state['errors'],
        'count' => count($state['courses']),
    ];
}

/** Données publiques d'un écran : uniquement ce qui s'affiche, aucun secret. */
function for_screen(array $screen): array
{
    $state = schedule_get();
    $settings = settings_load();
    $levels = array_flip($screen['levels']);
    $ttl = $settings['modifiedBadgeHours'] * 3600000;
    $now = now_ms();
    $courses = [];
    foreach ($state['courses'] as $c) {
        $match = !$c['groups'];
        foreach ($c['groups'] as $g) {
            if (!$g['level'] || isset($levels[$g['level']])) {
                $match = true;
                break;
            }
        }
        if (!$match) {
            continue;
        }
        $m = $state['modifiedAt'][$c['id']] ?? null;
        $c['modified'] = $m !== null && $ttl > 0 && $now - $m < $ttl;
        $courses[] = $c;
    }
    $ann = $settings['announcement'];
    return [
        'generatedAt' => iso(time()),
        'serverNow' => $now,
        'tzOffsetMinutes' => (int) (date('Z') / 60),
        'lastSuccessAt' => $state['lastSuccessAt'] ? iso((int) ($state['lastSuccessAt'] / 1000)) : null,
        'stale' => count($state['errors']) > 0,
        'screen' => ['id' => $screen['id'], 'name' => $screen['name']],
        'settings' => [
            'campusName' => $settings['campusName'],
            'pageSeconds' => $settings['pageSeconds'],
            'rowsPerPage' => $settings['rowsPerPage'],
            'theme' => $settings['theme'],
            'refreshMinutes' => $settings['refreshMinutes'],
            'announcement' => ($ann['enabled'] && $ann['text'] !== '') ? $ann : null,
        ],
        'courses' => $courses,
    ];
}
