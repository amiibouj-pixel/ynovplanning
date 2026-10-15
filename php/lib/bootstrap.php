<?php
/**
 * Version PHP du serveur (hébergement mutualisé IONOS, OVH… sans Node.js).
 * Même fonctionnement que server.js : écrans publics en lecture seule + back-office protégé.
 */
declare(strict_types=1);

if (PHP_VERSION_ID < 80000) {
    http_response_code(500);
    exit('PHP 8.0 minimum requis (IONOS : Espace client > Hébergement > Version PHP).');
}

define('APP_DIR', dirname(__DIR__));
define('DATA_DIR', APP_DIR . '/data');

$configFile = APP_DIR . '/config.php';
if (!is_file($configFile)) {
    http_response_code(500);
    exit('config.php manquant : copiez config.sample.php en config.php et remplissez-le.');
}
$GLOBALS['CONFIG'] = array_merge([
    'admin_user' => 'admin',
    'admin_password_hash' => '',
    'secrets_key' => '',
    'display_key' => '',
    'admin_allowed_ips' => [],
    'display_frame_ancestors' => ['*'],
    'timezone' => 'Europe/Paris',
    'hp_api_key' => '',
], require $configFile);

function cfg(string $key)
{
    return $GLOBALS['CONFIG'][$key] ?? null;
}

date_default_timezone_set(cfg('timezone') ?: 'Europe/Paris');

if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0700, true);
}

/* ---------- Utilitaires ---------- */

function now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}

/** Horodatage (secondes) -> ISO 8601 UTC, même format que Node (toISOString). */
function iso(int $ts): string
{
    return gmdate('Y-m-d\TH:i:s', $ts) . '.000Z';
}

function read_json(string $file, $default)
{
    if (!is_file($file)) {
        return $default;
    }
    $data = json_decode((string) file_get_contents($file), true);
    return is_array($data) ? $data : $default;
}

/** Écriture atomique (fichier temporaire puis renommage). */
function write_json(string $file, $data): void
{
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    @chmod($tmp, 0600);
    rename($tmp, $file);
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body_json(): array
{
    $data = json_decode((string) file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443');
}

function client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

function safe_equals(string $a, string $b): bool
{
    return hash_equals(hash('sha256', $a), hash('sha256', $b));
}

/** Requête HTTP GET (cURL) avec délai et taille maximum. */
function http_get(string $url, array $headers = [], int $timeout = 20, bool $follow = true): array
{
    if (!preg_match('#^https?://#i', $url)) {
        throw new RuntimeException('URL http(s) attendue');
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => $follow,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERAGENT => 'CoursDuJour-Ynov/1.0',
    ]);
    $body = curl_exec($ch);
    $err = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false) {
        throw new RuntimeException($err ?: 'Serveur injoignable');
    }
    if (strlen($body) > 10 * 1024 * 1024) {
        throw new RuntimeException('Réponse trop volumineuse');
    }
    return [$status, $body];
}

/* ---------- En-têtes de sécurité ---------- */

function security_headers(bool $display): void
{
    $frame = $display ? implode(' ', (array) cfg('display_frame_ancestors')) : "'none'";
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        . "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors $frame");
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex, nofollow');
    if (!$display) {
        header('X-Frame-Options: DENY');
        header('Cache-Control: no-store');
    }
}
