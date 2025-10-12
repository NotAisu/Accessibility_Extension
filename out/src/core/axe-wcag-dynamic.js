"use strict";
// Dynamische Ableitung aller axe-core RuleIDs zu ihren WCAG Success Criteria Tags
// Nutzt Runtime: axe._audit.rules[].tags mit Mustern wcag\d{3,4}
// Multi-SC wird unterstützt.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAxeWcagMap = getAxeWcagMap;
exports.getAllScForRule = getAllScForRule;
exports.getPrimaryScForRule = getPrimaryScForRule;
exports.isAxeRule = isAxeRule;
let CACHE = null;
function digitsToSc(d) {
    if (d.length === 3)
        return `${d[0]}.${d[1]}.${d[2]}`; // 143 -> 1.4.3
    if (d.length === 4)
        return `${d[0]}.${d[1]}.${d.slice(2)}`; // 1412 -> 1.4.12
    return d;
}
// Primär-Overrides für Multi-SC Regeln (fachliche Priorisierung)
const PRIMARY_OVERRIDE = {
    'area-alt': '2.4.4',
    'input-image-alt': '1.1.1',
    'link-name': '2.4.4',
    'aria-hidden-body': '1.3.1',
    'meta-refresh-no-exceptions': '2.2.4',
    'scrollable-region-focusable': '2.1.1'
};
function getAxeWcagMap() {
    if (CACHE)
        return CACHE;
    let axe;
    try {
        axe = require('axe-core');
    }
    catch {
        return CACHE = { axeVersion: 'unknown', rules: {} };
    }
    const raw = Array.isArray(axe._audit?.rules) ? axe._audit.rules : [];
    const rules = {};
    for (const r of raw) {
        const id = r && r.id;
        if (!id)
            continue;
        const tags = Array.isArray(r.tags) ? r.tags : [];
        const scDigits = tags.map(t => t.match(/^wcag(\d{3,4})$/)?.[1]).filter(Boolean);
        const scList = Array.from(new Set(scDigits.map(digitsToSc))).sort((a, b) => a.localeCompare(b, 'en'));
        if (scList.length) {
            const override = PRIMARY_OVERRIDE[id];
            if (override && scList.includes(override)) {
                rules[id] = { primary: override, all: [override, ...scList.filter(s => s !== override)] };
            }
            else {
                rules[id] = { primary: scList[0], all: scList };
            }
        }
        else {
            rules[id] = { primary: '', all: [] };
        }
    }
    CACHE = { axeVersion: axe.version || 'unknown', rules };
    return CACHE;
}
function getAllScForRule(ruleId) {
    return getAxeWcagMap().rules[ruleId]?.all || [];
}
function getPrimaryScForRule(ruleId) {
    return getAxeWcagMap().rules[ruleId]?.primary || '';
}
function isAxeRule(ruleId) {
    return Object.prototype.hasOwnProperty.call(getAxeWcagMap().rules, ruleId);
}
//# sourceMappingURL=axe-wcag-dynamic.js.map