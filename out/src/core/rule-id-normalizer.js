"use strict";
/**
 * Normalisiert ruleIds (axe-core Rule IDs, freie AI Beschreibungen, WCAG Nummern) auf einen
 * kanonischen Schlüssel für Metriken & Duplikat-Filterung.
 * Strategie:
 * 1. Trimme & lowercase
 * 2. WCAG Nummern (z.B. 1.4.3) bleiben erhalten
 * 3. Mapping von bekannten axe / umgangssprachlichen Synonymen auf WCAG Nummer
 * 4. Entferne Sonderzeichen / mehrfach Spaces
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRuleId = normalizeRuleId;
exports.normalizeRuleIds = normalizeRuleIds;
// Direkte Mapping-Tabelle: axe-core RuleId / häufige Synonyme -> WCAG 2.2 AA Erfolgs-/Referenzkriterium
// (vereinheitlicht; bei Mehrfachzuordnung wurde das am häufigsten herangezogene Kriterium gewählt)
const SYNONYM_MAP = {
    // Kontrast
    'color-contrast': '1.4.3',
    'contrast': '1.4.3',
    'low-contrast': '1.4.3',
    'colour-contrast': '1.4.3',
    // Alternativtext
    'image-alt': '1.1.1',
    'img-alt': '1.1.1',
    'missing-alt': '1.1.1',
    'alt-text': '1.1.1',
    'object-alt': '1.1.1',
    'area-alt': '1.1.1',
    'input-image-alt': '1.1.1',
    // Link / Button Namen
    'link-name': '2.4.4',
    'accessiblename': '2.4.4',
    'link-accessible-name': '2.4.4',
    'link-without-text': '2.4.4',
    'button-name': '4.1.2',
    'button-accessible-name': '4.1.2',
    'aria-input-field-name': '4.1.2',
    // ARIA / Rollen
    'aria-roles': '4.1.2',
    'invalid-aria-role': '4.1.2',
    'aria-hidden-focus': '4.1.2',
    'aria-valid-attr': '4.1.2',
    'aria-valid-attr-value': '4.1.2',
    'aria-required-attr': '4.1.2',
    'aria-required-children': '4.1.2',
    'aria-required-parent': '4.1.2',
    'aria-command-name': '4.1.2',
    'aria-meter-name': '4.1.2',
    'aria-progressbar-name': '4.1.2',
    'aria-toggle-field-name': '4.1.2',
    'aria-tooltip-name': '4.1.2',
    'role-img-alt': '1.1.1',
    // Form Labels / Struktur
    'form-label': '1.3.1',
    'label': '1.3.1',
    'missing-form-label': '1.3.1',
    'label-title-only': '1.3.1',
    'table-header': '1.3.1',
    'th-scope': '1.3.1',
    'table-headers': '1.3.1',
    'landmark-one-main': '1.3.1',
    'landmark-banner-is-top-level': '1.3.1',
    'region': '1.3.1',
    'landmark': '1.3.1',
    'landmark-main-is-top-level': '1.3.1',
    'landmark-contentinfo-is-top-level': '1.3.1',
    'heading-order': '1.3.1',
    'skip-link': '2.4.1',
    'bypass': '2.4.1',
    // Fokus / Tastatur
    'focus-order': '2.4.3',
    'tab-order': '2.4.3',
    'keyboard': '2.1.1',
    'no-keyboard-access': '2.1.1',
    // IDs / Struktur / Parsing
    'duplicate-id': '4.1.1',
    'duplicate-id-active': '4.1.1',
    'duplicate-id-aria': '4.1.1',
    'duplicate-id-aria-label': '4.1.1',
    'duplicate-id-aria-labelledby': '4.1.1',
    'duplicate-id-aria-describedby': '4.1.1',
    // Sprache / Titel / Meta
    'html-has-lang': '3.1.1',
    'html-lang-valid': '3.1.1',
    'document-title': '2.4.2',
    'frame-title': '4.1.2',
    'iframe-title': '4.1.2',
    'meta-refresh': '2.2.1',
    'meta-viewport': '1.4.10',
    // Listen / Tabellen
    'list': '1.3.1',
    'listitem': '1.3.1',
    'definition-list': '1.3.1',
    'dlitem': '1.3.1',
    'table-duplicate-name': '1.3.1',
    'scope-attr-valid': '1.3.1',
    // Select / Form specific
    'select-name': '4.1.2',
    'select-accessible-name': '4.1.2',
    'autocomplete-valid': '1.3.5',
    'checkboxgroup': '1.3.1',
    'radiogroup': '1.3.1',
    // Medien / Zeitbasiert (vereinfachte Zuordnung)
    'audio-caption': '1.2.2',
    'video-caption': '1.2.2',
    'video-description': '1.2.5'
};
const WCAG_NUMBER_REGEX = /^(\d\.\d\.\d[a-z]?)(?:\b|$)/; // 1.4.3, 1.4.3a
function normalizeRuleId(raw) {
    if (!raw)
        return '';
    let s = raw.trim().toLowerCase();
    if (!s)
        return '';
    // Entferne Klammern & doppelte Leerzeichen
    s = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    // Wenn bereits eine WCAG Nummer enthalten → extrahieren & zurück
    const numMatch = s.match(WCAG_NUMBER_REGEX);
    if (numMatch) {
        return numMatch[1];
    }
    // Sonderfälle: ersetze Nicht-Alphanumerisches (außer - und .) durch -
    s = s.replace(/[^a-z0-9.\- ]+/g, '-').replace(/\s+/g, '-');
    // Direkte Zuordnung
    if (SYNONYM_MAP[s])
        return SYNONYM_MAP[s];
    // Heuristische Ableitungen für axe-core IDs, die nicht explizit gelistet sind
    const heuristic = heuristicMap(s);
    if (heuristic)
        return heuristic;
    // Falls color contrast auseinander geschrieben
    if (s === 'color-contrast-ratio' || s === 'contrast-ratio')
        return '1.4.3';
    // Letzter Fallback: gebe den bereinigten String zurück (für spätere Analyse)
    return s;
}
/** Normalisiert alle ruleIds einer Liste in-place */
function normalizeRuleIds(items) {
    for (const it of items) {
        if (it.ruleId)
            it.ruleId = normalizeRuleId(it.ruleId);
    }
    return items;
}
// Heuristischer Fallback für nicht gemappte axe IDs (reduziert Varianz, Kennzeichnung in Thesis dokumentieren)
function heuristicMap(id) {
    if (!id)
        return '';
    if (id.startsWith('aria-'))
        return '4.1.2';
    if (id.endsWith('-name') || id.endsWith('-label') || id.includes('accessible-name'))
        return '4.1.2';
    if (id.includes('contrast'))
        return '1.4.3';
    if (id.includes('focus'))
        return '2.4.3';
    if (id.includes('keyboard'))
        return '2.1.1';
    if (id.includes('lang'))
        return '3.1.1';
    if (id.includes('title'))
        return '2.4.2';
    if (id.includes('heading') || id.includes('h1'))
        return '2.4.1';
    if (id.includes('frame'))
        return '4.1.2';
    if (id.includes('table') || id.includes('scope') || id.includes('th-'))
        return '1.3.1';
    if (id.includes('list'))
        return '1.3.1';
    if (id.includes('duplicate-id'))
        return '4.1.1';
    if (id.includes('timeout') || id.includes('refresh'))
        return '2.2.1';
    if (id.includes('caption') || id.includes('transcript'))
        return '1.2.2';
    return '';
}
//# sourceMappingURL=rule-id-normalizer.js.map