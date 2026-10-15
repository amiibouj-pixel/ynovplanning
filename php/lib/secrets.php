<?php
/** Chiffrement AES-256-GCM des secrets stockés (mot de passe / clé du Service Web HyperPlanning). */
declare(strict_types=1);

function secrets_key(): string
{
    $k = (string) cfg('secrets_key');
    if (strlen($k) < 32) {
        throw new RuntimeException("secrets_key manquante ou trop courte dans config.php");
    }
    return hash('sha256', 'ynov-planning-secrets|' . $k, true);
}

function secret_encrypt(string $plain): string
{
    $iv = random_bytes(12);
    $tag = '';
    $enc = openssl_encrypt($plain, 'aes-256-gcm', secrets_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return implode(':', ['p1', base64_encode($iv), base64_encode($tag), base64_encode((string) $enc)]);
}

function secret_decrypt(string $blob): string
{
    if ($blob === '') {
        return '';
    }
    $parts = explode(':', $blob);
    if (count($parts) !== 4 || $parts[0] !== 'p1') {
        return '';
    }
    try {
        $out = openssl_decrypt(base64_decode($parts[3]), 'aes-256-gcm', secrets_key(), OPENSSL_RAW_DATA,
            base64_decode($parts[1]), base64_decode($parts[2]));
    } catch (Throwable $e) {
        return '';
    }
    return $out === false ? '' : $out;
}
