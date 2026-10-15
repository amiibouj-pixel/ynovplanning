<?php
/*
 * Configuration : copier ce fichier en config.php et le remplir.
 * config.php n'est jamais accessible depuis le web (bloqué par .htaccess).
 */
return [
    // Identifiant du back-office
    'admin_user' => 'peda-montpellier',

    // Hash bcrypt du mot de passe. À générer sur ton ordinateur : npm run hash-password
    // (coller la valeur entre apostrophes, elle commence par $2a$ ou $2b$)
    'admin_password_hash' => '',

    // Clé de chiffrement de la clé API HyperPlanning : 64 caractères aléatoires.
    // Générer : openssl rand -hex 32
    // Ne plus jamais la changer ensuite (sinon il faudra ressaisir la clé API).
    'secrets_key' => '',

    // (Recommandé) Clé ajoutée aux URL d'écran (?key=...) pour que le planning ne soit pas public.
    'display_key' => '',

    // (Optionnel) Back-office accessible uniquement depuis ces IP. Ex : ['82.64.12.34', '10.0.*']
    'admin_allowed_ips' => [],

    // Sites autorisés à afficher l'écran en iframe (widget "Site web" d'Emity). '*' = tous.
    'display_frame_ancestors' => ['*'],

    'timezone' => 'Europe/Paris',

    // (Optionnel) Mot de passe / clé du Service Web HyperPlanning directement ici
    // au lieu de le saisir dans le back-office.
    'hp_api_key' => '',
];
