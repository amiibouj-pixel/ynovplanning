<?php
/** Réglages (data/settings.json) : validation par liste blanche, écriture atomique. Port de src/store.js. */
declare(strict_types=1);

const LEVELS = ['B1', 'B2', 'B3', 'M1', 'M2', 'BTS'];

function settings_defaults(): array
{
    return [
        'campusName' => 'Montpellier',
        'groupPrefix' => 'Montpellier |',
        'demoMode' => true,
        'hpApi' => [
            'enabled' => false,
            'flavor' => 'official',
            'baseUrl' => 'https://hp26.ynov.com/MON/hpsw/api/v1/',
            'coursesPath' => '/api/rest/cours?dateDebut={date}&dateFin={date}',
            'authMode' => 'basic',
            'headerName' => 'X-API-Key',
            'username' => '',
            'apiKeyEnc' => '',
        ],
        'sources' => [],
        'refreshMinutes' => 2,
        'pageSeconds' => 12,
        'rowsPerPage' => 6,
        'modifiedBadgeHours' => 3,
        'theme' => 'light',
        'announcement' => ['enabled' => false, 'text' => '', 'tone' => 'info'],
        'screens' => [['id' => 'general', 'name' => 'Hall, tous les cours', 'levels' => LEVELS]],
    ];
}

function clamp_int($v, int $min, int $max, int $fallback): int
{
    if (!is_numeric($v)) {
        return $fallback;
    }
    return max($min, min($max, (int) $v));
}

function clean_str($v, int $max, $fallback)
{
    if (!is_string($v)) {
        return $fallback;
    }
    return mb_substr(trim((string) preg_replace('/[\x00-\x1F\x7F]/u', ' ', $v)), 0, $max);
}

function valid_url($u): bool
{
    return is_string($u) && (bool) preg_match('#^https?://[^\s]+$#i', $u) && filter_var($u, FILTER_VALIDATE_URL) !== false;
}

function slugify($v): string
{
    $s = mb_strtolower((string) $v);
    $s = strtr($s, ['à' => 'a', 'â' => 'a', 'ä' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'î' => 'i', 'ï' => 'i',
        'ô' => 'o', 'ö' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c']);
    $s = trim((string) preg_replace('/[^a-z0-9-]+/', '-', $s), '-');
    return substr($s, 0, 40);
}

/** $current = null : restauration depuis le disque (on garde la clé chiffrée telle quelle). */
function settings_sanitize(array $in, ?array $current): array
{
    $base = $current ?? settings_defaults();
    $d = settings_defaults();
    $s = [];
    $s['campusName'] = clean_str($in['campusName'] ?? null, 60, $base['campusName']) ?: $base['campusName'];
    $s['groupPrefix'] = clean_str($in['groupPrefix'] ?? null, 60, $base['groupPrefix']);
    $s['demoMode'] = is_bool($in['demoMode'] ?? null) ? $in['demoMode'] : $base['demoMode'];
    $s['refreshMinutes'] = clamp_int($in['refreshMinutes'] ?? null, 1, 120, (int) $base['refreshMinutes']);
    $s['pageSeconds'] = clamp_int($in['pageSeconds'] ?? null, 5, 120, (int) $base['pageSeconds']);
    $s['rowsPerPage'] = clamp_int($in['rowsPerPage'] ?? null, 3, 10, (int) $base['rowsPerPage']);
    $s['modifiedBadgeHours'] = clamp_int($in['modifiedBadgeHours'] ?? null, 0, 48, (int) $base['modifiedBadgeHours']);
    $theme = $in['theme'] ?? null;
    $s['theme'] = in_array($theme, ['light', 'dark'], true) ? $theme : $base['theme'];

    $hp = is_array($in['hpApi'] ?? null) ? $in['hpApi'] : [];
    $prev = array_merge($d['hpApi'], is_array($base['hpApi'] ?? null) ? $base['hpApi'] : []);
    $s['hpApi'] = [
        'enabled' => is_bool($hp['enabled'] ?? null) ? $hp['enabled'] : (bool) $prev['enabled'],
        'flavor' => in_array($hp['flavor'] ?? null, ['official', 'soap', 'generic'], true) ? $hp['flavor'] : ($prev['flavor'] ?: 'official'),
        'baseUrl' => array_key_exists('baseUrl', $hp) ? (valid_url($hp['baseUrl']) ? clean_str($hp['baseUrl'], 500, '') : '') : $prev['baseUrl'],
        'coursesPath' => array_key_exists('coursesPath', $hp) ? clean_str($hp['coursesPath'], 500, $prev['coursesPath']) : $prev['coursesPath'],
        'authMode' => in_array($hp['authMode'] ?? null, ['bearer', 'header', 'basic', 'query'], true) ? $hp['authMode'] : $prev['authMode'],
        'headerName' => array_key_exists('headerName', $hp) ? (string) preg_replace('/[^A-Za-z0-9_-]/', '', (string) clean_str($hp['headerName'], 60, '')) : $prev['headerName'],
        'username' => array_key_exists('username', $hp) ? clean_str($hp['username'], 120, '') : $prev['username'],
        'apiKeyEnc' => (string) ($prev['apiKeyEnc'] ?? ''),
    ];
    if (is_string($hp['apiKey'] ?? null) && trim($hp['apiKey']) !== '') {
        $s['hpApi']['apiKeyEnc'] = secret_encrypt(mb_substr(trim($hp['apiKey']), 0, 1000));
    }
    if (($hp['clearApiKey'] ?? false) === true) {
        $s['hpApi']['apiKeyEnc'] = '';
    }
    if ($current === null && is_string($hp['apiKeyEnc'] ?? null)) {
        $s['hpApi']['apiKeyEnc'] = $hp['apiKeyEnc'];
    }

    $sources = is_array($in['sources'] ?? null) ? $in['sources'] : $base['sources'];
    $s['sources'] = [];
    foreach (array_slice($sources, 0, 50) as $src) {
        $url = clean_str($src['url'] ?? null, 2000, '');
        if ($url && valid_url($url)) {
            $s['sources'][] = ['name' => clean_str($src['name'] ?? null, 60, ''), 'url' => $url];
        }
    }

    $ann = is_array($in['announcement'] ?? null) ? $in['announcement'] : $base['announcement'];
    $s['announcement'] = [
        'enabled' => !empty($ann['enabled']),
        'text' => clean_str($ann['text'] ?? '', 280, ''),
        'tone' => ($ann['tone'] ?? '') === 'alert' ? 'alert' : 'info',
    ];

    $screens = is_array($in['screens'] ?? null) ? $in['screens'] : $base['screens'];
    $s['screens'] = [];
    $seen = [];
    foreach (array_slice($screens, 0, 30) as $sc) {
        $id = slugify($sc['id'] ?? '') ?: slugify($sc['name'] ?? '');
        if (!$id || isset($seen[$id])) {
            continue;
        }
        $seen[$id] = true;
        $levels = is_array($sc['levels'] ?? null) ? $sc['levels'] : LEVELS;
        $s['screens'][] = [
            'id' => $id,
            'name' => clean_str($sc['name'] ?? null, 60, 'Écran'),
            'levels' => array_values(array_intersect($levels, LEVELS)),
        ];
    }
    if (!$s['screens']) {
        $s['screens'] = $d['screens'];
    }
    return $s;
}

function settings_load(): array
{
    if (isset($GLOBALS['SETTINGS_CACHE'])) {
        return $GLOBALS['SETTINGS_CACHE'];
    }
    $raw = read_json(DATA_DIR . '/settings.json', null);
    $GLOBALS['SETTINGS_CACHE'] = $raw ? settings_sanitize($raw, null) : settings_defaults();
    return $GLOBALS['SETTINGS_CACHE'];
}

function settings_save(array $input): array
{
    $next = settings_sanitize($input, settings_load());
    write_json(DATA_DIR . '/settings.json', $next);
    $GLOBALS['SETTINGS_CACHE'] = $next;
    return $next;
}

/** Réglages pour le back-office : jamais la clé, seulement « configurée ». */
function settings_public(): array
{
    $s = settings_load();
    $s['hpApi']['apiKeySet'] = $s['hpApi']['apiKeyEnc'] !== '' || cfg('hp_api_key') !== '';
    $s['hpApi']['apiKeyFromEnv'] = cfg('hp_api_key') !== '';
    unset($s['hpApi']['apiKeyEnc']);
    return $s;
}

function hp_api_key(): string
{
    return cfg('hp_api_key') ?: secret_decrypt((string) settings_load()['hpApi']['apiKeyEnc']);
}
