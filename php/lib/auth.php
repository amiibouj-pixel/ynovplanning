<?php
/** Back-office : session, mot de passe bcrypt, anti brute-force, CSRF, liste d'IP. Port de src/auth.js. */
declare(strict_types=1);

function admin_ip_allowed(): bool
{
    $allowed = (array) cfg('admin_allowed_ips');
    if (!$allowed) {
        return true;
    }
    $ip = client_ip();
    foreach ($allowed as $a) {
        if (substr($a, -1) === '*' ? strpos($ip, substr($a, 0, -1)) === 0 : $ip === $a) {
            return true;
        }
    }
    return false;
}

function admin_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $dir = DATA_DIR . '/sessions';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    session_save_path($dir);
    session_name('ynov_admin');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', '28800');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/admin', 'httponly' => true, 'samesite' => 'Strict', 'secure' => is_https()]);
    session_start();
    // Expiration après 8 h d'inactivité
    if (isset($_SESSION['seen']) && time() - $_SESSION['seen'] > 28800) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['seen'] = time();
}

function is_admin(): bool
{
    return ($_SESSION['admin'] ?? false) === true;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_ok(): bool
{
    $token = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    return $token !== '' && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
}

/* ---------- Anti brute-force : 8 échecs / 15 min / IP ---------- */
function login_attempts(bool $record = false): int
{
    $file = DATA_DIR . '/login-attempts.json';
    $all = read_json($file, []);
    $ip = hash('sha256', client_ip());
    $since = time() - 900;
    foreach ($all as $k => $list) {
        $all[$k] = array_values(array_filter((array) $list, fn($t) => $t > $since));
        if (!$all[$k]) {
            unset($all[$k]);
        }
    }
    if ($record) {
        $all[$ip][] = time();
    }
    write_json($file, $all);
    return count($all[$ip] ?? []);
}

function check_credentials(string $user, string $password): bool
{
    $hash = (string) cfg('admin_password_hash');
    if ($hash === '') {
        return false;
    }
    $userOk = safe_equals($user, (string) cfg('admin_user'));
    // bcrypt ($2a$/$2b$/$2y$), compatible avec le hash généré par `npm run hash-password`
    $passOk = password_verify($password, $userOk ? $hash : '$2y$12$abcdefghijklmnopqrstuuK5J0p3Uq7m0q3oM9ZpW1yH5xY6c8xQe');
    return $userOk && $passOk;
}
