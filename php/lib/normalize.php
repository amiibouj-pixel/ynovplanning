<?php
/** HyperPlanning brut -> cours propres (niveau, filière, couleur, salle…). Port de src/normalize.js. */
declare(strict_types=1);

/** Code couleur des filières = tokens ynov.com (--c-formation-*), "ink" = couleur du texte sur l'aplat. */
function filieres(): array
{
    return [
        ['key' => 'bts', 'label' => 'BTS Tech', 'color' => '#3d68d1', 'ink' => '#ffffff', 'univers' => 'tech', 'match' => '/SIO|CIEL|YLEVEL|SLAM|SISR/'],
        ['key' => 'cyber', 'label' => 'Cybersécurité', 'color' => '#5affb6', 'ink' => '#0a0006', 'univers' => 'tech', 'match' => '/CYBER|CSINFRA/'],
        ['key' => 'ia', 'label' => 'IA & Data', 'color' => '#859cff', 'ink' => '#0a0006', 'univers' => 'tech', 'match' => '/^IA|DIGIA|IADAT|IADEV|DATA/'],
        ['key' => 'info', 'label' => 'Informatique', 'color' => '#5ec5ea', 'ink' => '#0a0006', 'univers' => 'tech', 'match' => '/INFOR|DEV/'],
        ['key' => 'archi', 'label' => 'Architecture', 'color' => '#3ca55b', 'ink' => '#0a0006', 'univers' => 'archi', 'match' => '/ARCHI|AINT|BIM/'],
        ['key' => 'audiovisuel', 'label' => 'Audiovisuel', 'color' => '#ffdb2d', 'ink' => '#0a0006', 'univers' => 'creative', 'match' => '/AVI|AUDIO/'],
        ['key' => '3d', 'label' => '3D & Jeu vidéo', 'color' => '#c259ff', 'ink' => '#0a0006', 'univers' => 'creative', 'match' => '/3D|ANIM|GAME/'],
        ['key' => 'marketing', 'label' => 'Marketing & Com', 'color' => '#e38338', 'ink' => '#0a0006', 'univers' => 'creative', 'match' => '/MKT|MARK|COM/'],
        ['key' => 'design', 'label' => 'Création & Design', 'color' => '#89dc8f', 'ink' => '#0a0006', 'univers' => 'creative', 'match' => '/CREA|DESIGN|UX/'],
        ['key' => '2d', 'label' => 'Illustration', 'color' => '#ff5aff', 'ink' => '#0a0006', 'univers' => 'creative', 'match' => '/2D|ILLU/'],
    ];
}

function filiere_of(string $program): array
{
    $p = mb_strtoupper($program);
    foreach (filieres() as $f) {
        if (preg_match($f['match'], $p)) {
            return $f;
        }
    }
    return ['key' => 'autre', 'label' => 'Autre', 'color' => '#dbdbdb', 'ink' => '#0a0006', 'univers' => 'corpo'];
}

/** "Montpellier | CREADD B2" -> program CREADD, level B2 */
function parse_group(string $raw, string $prefix): array
{
    $label = trim($raw);
    if ($prefix !== '' && stripos($label, $prefix) === 0) {
        $label = trim(substr($label, strlen($prefix)));
    }
    $label = (string) preg_replace('/^[|\-–:\s]+/u', '', $label);

    $level = null;
    $levelLabel = null;
    $rest = $label;
    $rules = [
        ['/\bBTS\s?([12])\b/i', fn($m) => ['BTS', 'BTS ' . $m[1]]],
        ['/\bMAST(?:ER)?\s?([12])\b/i', fn($m) => ['M' . $m[1], 'M' . $m[1]]],
        ['/\bM([12])\b/', fn($m) => ['M' . $m[1], 'M' . $m[1]]],
        ['/\bB([123])\b/i', fn($m) => ['B' . $m[1], 'B' . $m[1]]],
        ['/\bBACHELOR\s?([123])\b/i', fn($m) => ['B' . $m[1], 'B' . $m[1]]],
    ];
    foreach ($rules as [$re, $fn]) {
        if (preg_match($re, $label, $m)) {
            [$level, $levelLabel] = $fn($m);
            $rest = (string) preg_replace($re, ' ', $label, 1);
            break;
        }
    }
    if (!$level && preg_match('/\bBTS\b/i', $label)) {
        $level = 'BTS';
        $levelLabel = 'BTS';
        $rest = (string) preg_replace('/\bBTS\b/i', ' ', $label, 1);
    }
    $program = trim((string) preg_replace('/\s+/', ' ', $rest)) ?: $label;
    $f = filiere_of($program);
    return [
        'label' => $label, 'program' => $program, 'level' => $level, 'levelLabel' => $levelLabel,
        'filiere' => $f['key'], 'filiereLabel' => $f['label'], 'univers' => $f['univers'], 'color' => $f['color'], 'ink' => $f['ink'],
    ];
}

/** "Monsieur LEVEQUE Geoffrey" -> "Geoffrey Leveque" ; "Madame RABAUD" -> "Mme Rabaud" */
function format_teacher(string $raw): string
{
    if ($raw === '') {
        return '';
    }
    $cap = fn($w) => mb_convert_case(mb_strtolower($w), MB_CASE_TITLE);
    $out = [];
    foreach (preg_split('/\s*[,;]\s*/u', $raw) as $one) {
        $civ = preg_match('/^(Monsieur|Madame|M\.|Mme|Mr)\s+/iu', $one, $m) ? $m[1] : '';
        $parts = preg_split('/\s+/u', trim((string) preg_replace('/^(Monsieur|Madame|M\.|Mme|Mr)\s+/iu', '', $one)));
        $parts = array_values(array_filter($parts, 'strlen'));
        $upper = array_values(array_filter($parts, fn($w) => mb_strlen($w) > 1 && $w === mb_strtoupper($w) && preg_match('/\p{L}/u', $w)));
        $others = array_values(array_diff($parts, $upper));
        if (!$others && $upper) {
            $short = preg_match('/^(madame|mme)/i', $civ) ? 'Mme ' : ($civ ? 'M. ' : '');
            $out[] = $short . implode(' ', array_map($cap, $upper));
        } elseif (!$upper) {
            $out[] = implode(' ', $parts);
        } else {
            $out[] = implode(' ', $others) . ' ' . implode(' ', array_map($cap, $upper));
        }
    }
    return implode(', ', array_filter($out));
}

function parse_rooms(string $raw): array
{
    $rooms = [];
    foreach (preg_split('/\s*(?:,|;|\n)\s*/u', $raw) as $r) {
        $r = trim((string) preg_replace(['/^Salle\s+/iu', '/\.$/'], '', $r));
        if ($r !== '') {
            $rooms[] = $r;
        }
    }
    return $rooms;
}

function strip_accents(string $s): string
{
    return strtr($s, ['à' => 'a', 'â' => 'a', 'ä' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'î' => 'i', 'ï' => 'i',
        'ô' => 'o', 'ö' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'É' => 'e', 'È' => 'e', 'À' => 'a']);
}

/** DESCRIPTION HyperPlanning : lignes "Clé : valeur". */
function parse_description(string $desc): array
{
    $map = ['matiere' => 'subject', 'enseignant' => 'teacher', 'intervenant' => 'teacher', 'professeur' => 'teacher',
        'promotion' => 'groups', 'classe' => 'groups', 'td' => 'groups', 'groupe' => 'groups', 'public' => 'groups',
        'salle' => 'rooms', 'type' => 'type', 'memo' => 'note', 'remarque' => 'note'];
    $out = [];
    foreach (preg_split('/\r?\n/', $desc) as $line) {
        if (!preg_match('/^\s*([^:]{2,30}?)\s*:\s*(.+)$/u', $line, $m)) {
            continue;
        }
        $key = trim((string) preg_replace(['/\(s\)/', '/s$/'], '', strip_accents(mb_strtolower($m[1]))));
        $field = $map[$key] ?? null;
        if ($field) {
            $out[$field] = isset($out[$field]) ? $out[$field] . ', ' . trim($m[2]) : trim($m[2]);
        }
    }
    return $out;
}

/** Événement commun {uid, summary, description, location, start, end (timestamps), status} -> cours. */
function to_course(array $ev, array $settings): array
{
    $d = parse_description((string) ($ev['description'] ?? ''));
    $summaryParts = preg_split('/\s+-\s+/u', (string) ($ev['summary'] ?? ''));
    $subject = $d['subject'] ?? ($summaryParts[0] ?: 'Cours');
    $roomsRaw = $d['rooms'] ?? (string) ($ev['location'] ?? '');
    $groupsRaw = isset($d['groups']) ? preg_split('/\s*,\s*/u', $d['groups']) : [];
    $remoteRe = '/DISTANCIEL|DISTANCE|REMOTE|EN LIGNE|VISIO|TEAMS|ZOOM|^EAD/i';
    $remote = (bool) preg_match($remoteRe, $roomsRaw) || (bool) preg_match($remoteRe, $d['type'] ?? '');
    $cancelled = strtoupper((string) ($ev['status'] ?? '')) === 'CANCELLED'
        || preg_match('/annul/i', (string) ($ev['summary'] ?? '')) || preg_match('/annul/i', $d['note'] ?? '');

    return [
        'uid' => (string) ($ev['uid'] ?? ''),
        'start' => iso((int) $ev['start']),
        'end' => iso((int) $ev['end']),
        'subject' => trim($subject),
        'type' => $d['type'] ?? '',
        'teacher' => format_teacher($d['teacher'] ?? ''),
        'groups' => array_values(array_map(fn($g) => parse_group($g, (string) $settings['groupPrefix']), array_filter($groupsRaw, 'strlen'))),
        'rooms' => $remote ? [] : parse_rooms($roomsRaw),
        'remote' => $remote,
        'cancelled' => (bool) $cancelled,
    ];
}
