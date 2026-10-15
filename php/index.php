<?php
// Point d'entrée de la version PHP. Apache sert les fichiers statiques, le reste passe ici (.htaccess)
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/secrets.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/normalize.php';
require __DIR__ . '/lib/sources.php';
require __DIR__ . '/lib/soap.php';
require __DIR__ . '/lib/schedule.php';
require __DIR__ . '/lib/auth.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = '/' . trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');

function not_found(): void
{
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Not found');
}

function find_screen(string $id): array
{
    $key = (string) cfg('display_key');
    if ($key !== '' && !safe_equals((string) ($_GET['key'] ?? ''), $key)) {
        http_response_code(403);
        exit('Accès refusé');
    }
    foreach (settings_load()['screens'] as $s) {
        if ($s['id'] === $id) {
            return $s;
        }
    }
    http_response_code(404);
    exit('Écran inconnu');
}

function send_view(string $file): void
{
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/lib/views/' . $file);
    exit;
}

try {
    /* ---------------- Écrans publics ---------------- */
    if ($path === '/') {
        $first = settings_load()['screens'][0]['id'];
        header('Location: /ecran/' . rawurlencode($first) . (isset($_GET['key']) ? '?key=' . rawurlencode((string) $_GET['key']) : ''));
        exit;
    }
    if ($path === '/healthz') {
        json_out(['ok' => true, 'php' => PHP_VERSION]);
    }
    if (preg_match('#^/ecran/([a-z0-9-]+)$#', $path, $m)) {
        find_screen($m[1]);
        security_headers(true);
        header('Cache-Control: no-cache');
        header('Content-Type: text/html; charset=utf-8');
        readfile(__DIR__ . '/display/index.html');
        exit;
    }
    if (preg_match('#^/api/ecran/([a-z0-9-]+)$#', $path, $m)) {
        $screen = find_screen($m[1]);
        header('X-Robots-Tag: noindex, nofollow');
        json_out(for_screen($screen));
    }

    /* ---------------- Back-office ---------------- */
    if ($path === '/admin' || strpos($path, '/admin/') === 0) {
        if (!admin_ip_allowed()) {
            not_found();
        }
        security_headers(false);
        admin_session_start();

        if ($path === '/admin/login') {
            if ($method === 'POST') {
                if (login_attempts() >= 8) {
                    header('Location: /admin/login?e=limit');
                    exit;
                }
                if (!check_credentials((string) ($_POST['username'] ?? ''), (string) ($_POST['password'] ?? ''))) {
                    login_attempts(true);
                    header('Location: /admin/login?e=1');
                    exit;
                }
                session_regenerate_id(true);
                $_SESSION['admin'] = true;
                csrf_token();
                header('Location: /admin');
                exit;
            }
            if (is_admin()) {
                header('Location: /admin');
                exit;
            }
            send_view('login.html');
        }

        if (!is_admin()) {
            if (strpos($path, '/admin/api') === 0) {
                json_out(['error' => 'Non authentifié'], 401);
            }
            header('Location: /admin/login');
            exit;
        }

        if ($path === '/admin') {
            send_view('admin.html');
        }
        if ($method !== 'GET' && !csrf_ok()) {
            json_out(['error' => 'Jeton CSRF invalide'], 403);
        }
        if ($path === '/admin/logout' && $method === 'POST') {
            $_SESSION = [];
            session_destroy();
            setcookie('ynov_admin', '', ['expires' => time() - 3600, 'path' => '/admin']);
            json_out(['ok' => true]);
        }

        switch ($path) {
            case '/admin/api/session':
                json_out(['csrf' => csrf_token(), 'user' => cfg('admin_user'), 'displayKey' => cfg('display_key')]);

            case '/admin/api/settings':
                if ($method === 'GET') {
                    json_out(settings_public());
                }
                if ($method !== 'POST' && $method !== 'PUT') {
                    not_found();
                }
                $before = settings_load();
                $saved = settings_save(body_json());
                $changed = source_key($before) !== source_key($saved);
                $state = $changed ? schedule_refresh(true) : state_load();
                json_out(['settings' => settings_public(), 'status' => schedule_status($state)]);

            case '/admin/api/status':
                json_out(schedule_status(state_load()));

            case '/admin/api/refresh':
                if ($method !== 'POST') {
                    not_found();
                }
                json_out(schedule_status(schedule_refresh(true)));

            case '/admin/api/test-source':
                try {
                    $events = fetch_ical((string) (body_json()['url'] ?? ''));
                    json_out(['ok' => true, 'count' => count($events)]);
                } catch (Throwable $e) {
                    json_out(['ok' => false, 'error' => $e->getMessage()], 400);
                }

            case '/admin/api/test-hpapi':
                $b = body_json();
                $cfgHp = array_merge(settings_load()['hpApi'], array_intersect_key($b, array_flip(['flavor', 'baseUrl', 'coursesPath', 'authMode', 'headerName', 'username'])));
                $typed = is_string($b['apiKey'] ?? null) ? trim($b['apiKey']) : '';
                $key = $typed !== '' ? $typed : hp_api_key();
                try {
                    // pas de nouvelle clé saisie : on n'envoie la clé enregistrée qu'à l'adresse enregistrée
                    if ($typed === '' && ($cfgHp['baseUrl'] ?? '') !== settings_load()['hpApi']['baseUrl']) {
                        throw new RuntimeException('Saisissez le mot de passe pour tester une autre adresse');
                    }
                    if (!valid_url($cfgHp['baseUrl'] ?? '')) {
                        throw new RuntimeException('URL http(s) attendue');
                    }
                    $flavor = $cfgHp['flavor'] ?? 'official';
                    $r = $flavor === 'generic' ? fetch_hp_generic($cfgHp, $key)
                        : ($flavor === 'soap' ? fetch_hp_soap($cfgHp, $key, true) : fetch_hp_official($cfgHp, $key, true));
                    $sample = [];
                    foreach (array_slice($r['events'], 0, 5) as $e) {
                        preg_match_all('/^Promotion : (.+)$/m', $e['description'], $g);
                        $sample[] = ['cours' => $e['summary'], 'debut' => iso($e['start']), 'fin' => iso($e['end']), 'salle' => $e['location'],
                            'classes' => implode(', ', $g[1]), 'annule' => $e['status'] === 'CANCELLED'];
                    }
                    $first = $r['raw'][0] ?? [];
                    json_out(['ok' => true, 'received' => $r['raw'][0]['cours'] ?? count($r['raw']), 'understood' => count($r['events']),
                        'fields' => is_array($first) ? array_slice(array_keys($first), 0, 30) : [], 'sample' => $sample,
                        'operations' => $r['operations'] ?? null, 'available' => isset($r['available']) ? array_slice($r['available'], 0, 200) : null]);
                } catch (Throwable $e) {
                    json_out(['ok' => false, 'error' => $e->getMessage()], 400);
                }
        }
        not_found();
    }

    not_found();
} catch (Throwable $e) {
    error_log('[cours-du-jour] ' . $e->getMessage());
    if (strpos($path, '/api') !== false) {
        json_out(['error' => 'Erreur serveur'], 500);
    }
    http_response_code(500);
    exit('Erreur serveur');
}
