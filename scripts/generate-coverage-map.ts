// npm run generate:coverage: generates the WCAG 2.2 A/AA Coverage map in site/index.html and site/llms.txt
// from src/core/wcag-coverage.json, src/core/proof-status.json, and src/core/best-practice-rules.json.
import * as fs from 'fs';
import * as path from 'path';
import bestPracticeRules from '../src/core/best-practice-rules.json';
import proofStatus from '../src/core/proof-status.json';
import { ruleDoc } from '../src/core/rule-docs';
import { TARGET_CRITERIA, criterionName, criterionUrl } from '../src/core/wcag';
import wcagCoverage from '../src/core/wcag-coverage.json';

export const COVERAGE_LAYERS = ['Check', 'AI Review', 'Browser audit', 'Person'] as const;
export type CoverageLayer = (typeof COVERAGE_LAYERS)[number];
export type WcagLevel = 'A' | 'AA';

export const HTML_START_MARKER = '<!-- COVERAGE_MAP:START -->';
export const HTML_END_MARKER = '<!-- COVERAGE_MAP:END -->';
export const LLMS_COVERAGE_HEADING = '## Coverage Map (WCAG 2.2 A & AA)';

export interface ProvenRuleCoverage {
    languageId: string;
    languageLabel: string;
    ruleId: string;
    correct: number;
    wrong: number;
    lowerBound: number;
}

export interface BestPracticeRuleCoverage {
    languageId: string;
    languageLabel: string;
    ruleId: string;
}

export interface CoverageRow {
    criterion: string;
    name: string;
    url: string;
    level: WcagLevel;
    layer: CoverageLayer;
    provenRules: ProvenRuleCoverage[];
    bestPracticeRules: BestPracticeRuleCoverage[];
}

interface RuleProofEntry {
    correct: number;
    wrong: number;
    lowerBound: number;
    proven: boolean;
}

const LANGUAGE_LABELS: Record<string, string> = {
    html: 'HTML',
    javascriptreact: 'JSX',
    typescriptreact: 'TSX',
    vue: 'Vue',
    svelte: 'Svelte',
    angular: 'Angular',
    typescript: 'Angular (TS)',
    astro: 'Astro'
};

function languageLabel(languageId: string): string {
    return LANGUAGE_LABELS[languageId] ?? languageId;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatPercent(lowerBound: number): string {
    return `${(lowerBound * 100).toFixed(1)}%`;
}

function layerClass(layer: CoverageLayer): string {
    switch (layer) {
        case 'Check': return 'layer-check';
        case 'AI Review': return 'layer-ai';
        case 'Browser audit': return 'layer-browser';
        case 'Person': return 'layer-person';
    }
}

export function buildCoverageMap(): CoverageRow[] {
    const assignments = wcagCoverage as Record<string, { level: WcagLevel; layer: CoverageLayer }>;
    const proof = proofStatus.rules as Record<string, Record<string, RuleProofEntry | undefined> | undefined>;
    const bestPractice = bestPracticeRules as Record<string, string[] | undefined>;

    const bestPracticeSet = new Set<string>();
    const bestPracticeByCriterion = new Map<string, BestPracticeRuleCoverage[]>();
    for (const [languageId, rules] of Object.entries(bestPractice)) {
        for (const ruleId of rules ?? []) {
            bestPracticeSet.add(`${languageId}:${ruleId}`);
            const doc = ruleDoc(ruleId);
            if (!doc) continue;
            for (const item of doc.wcag) {
                const list = bestPracticeByCriterion.get(item.criterion) ?? [];
                list.push({ languageId, languageLabel: languageLabel(languageId), ruleId });
                bestPracticeByCriterion.set(item.criterion, list);
            }
        }
    }

    const provenByCriterion = new Map<string, ProvenRuleCoverage[]>();
    for (const [ruleId, langs] of Object.entries(proof)) {
        const doc = ruleDoc(ruleId);
        if (!doc || !langs) continue;
        for (const [languageId, stats] of Object.entries(langs)) {
            if (!stats?.proven || bestPracticeSet.has(`${languageId}:${ruleId}`)) continue;
            for (const item of doc.wcag) {
                const list = provenByCriterion.get(item.criterion) ?? [];
                list.push({
                    languageId,
                    languageLabel: languageLabel(languageId),
                    ruleId,
                    correct: stats.correct,
                    wrong: stats.wrong,
                    lowerBound: stats.lowerBound
                });
                provenByCriterion.set(item.criterion, list);
            }
        }
    }

    const sortProven = (items: ProvenRuleCoverage[]): ProvenRuleCoverage[] =>
        [...items].sort((a, b) => a.languageLabel.localeCompare(b.languageLabel) || a.ruleId.localeCompare(b.ruleId));

    const sortBestPractice = (items: BestPracticeRuleCoverage[]): BestPracticeRuleCoverage[] =>
        [...items].sort((a, b) => a.languageLabel.localeCompare(b.languageLabel) || a.ruleId.localeCompare(b.ruleId));

    return TARGET_CRITERIA.map(criterion => {
        const assigned = assignments[criterion];
        if (!assigned) throw new Error(`Missing coverage assignment for WCAG ${criterion}`);
        const isCheck = assigned.layer === 'Check';
        return {
            criterion,
            name: criterionName(criterion),
            url: criterionUrl(criterion),
            level: assigned.level,
            layer: assigned.layer,
            provenRules: isCheck ? sortProven(provenByCriterion.get(criterion) ?? []) : [],
            bestPracticeRules: isCheck ? sortBestPractice(bestPracticeByCriterion.get(criterion) ?? []) : []
        };
    });
}

function renderHtmlEvidenceCell(row: CoverageRow): string {
    if (row.layer !== 'Check') {
        return '<span class="cov-pending">evidence pending</span>';
    }

    const parts: string[] = [];
    if (row.provenRules.length > 0) {
        const items = row.provenRules.map(rule =>
            `<li><span class="cov-lang">${escapeHtml(rule.languageLabel)}</span> <code>${escapeHtml(rule.ruleId)}</code> <span class="cov-stats">(${rule.correct} correct, ${rule.wrong} wrong, &ge; ${formatPercent(rule.lowerBound)})</span></li>`
        );
        parts.push(`<ul class="cov-rule-list">\n                  ${items.join('\n                  ')}\n                </ul>`);
    } else {
        parts.push('<p class="cov-note">No Proven rules yet (matches stay Needs Review).</p>');
    }

    if (row.bestPracticeRules.length > 0) {
        const items = row.bestPracticeRules.map(rule =>
            `<li><span class="cov-bp-tag">Best-practice</span> <span class="cov-lang">${escapeHtml(rule.languageLabel)}</span> <code>${escapeHtml(rule.ruleId)}</code> <span class="cov-stats">(Needs Review, never Proven)</span></li>`
        );
        parts.push(`<ul class="cov-rule-list cov-bp-list">\n                  ${items.join('\n                  ')}\n                </ul>`);
    }

    return parts.join('\n                ');
}

export function renderCoverageHtml(rows: CoverageRow[]): string {
    const counts = Object.fromEntries(COVERAGE_LAYERS.map(layer => [layer, rows.filter(r => r.layer === layer).length])) as Record<CoverageLayer, number>;
    const bodyRows = rows.map(row => [
        '              <tr>',
        `                <th scope="row"><a href="${escapeHtml(row.url)}">${escapeHtml(row.criterion)} ${escapeHtml(row.name)}</a></th>`,
        `                <td><span class="cov-level">${escapeHtml(row.level)}</span></td>`,
        `                <td><span class="cov-layer ${layerClass(row.layer)}">${escapeHtml(row.layer)}</span></td>`,
        `                <td>${renderHtmlEvidenceCell(row)}</td>`,
        '              </tr>'
    ].join('\n')).join('\n');

    return [
        `        <p class="cov-summary">${rows.length} WCAG 2.2 A and AA criteria (4.1.1 Parsing is obsolete and excluded): <strong>${counts.Check} Check</strong> · <strong>${counts['AI Review']} AI Review</strong> · <strong>${counts['Browser audit']} Browser audit</strong> · <strong>${counts.Person} Person</strong>.</p>`,
        '        <div class="table-wrap">',
        '          <table class="coverage-table">',
        '            <caption>WCAG 2.2 Level A and AA coverage map by primary verification layer</caption>',
        '            <thead>',
        '              <tr>',
        '                <th scope="col">Criterion</th>',
        '                <th scope="col">Level</th>',
        '                <th scope="col">Primary layer</th>',
        '                <th scope="col">Evidence &amp; Proven rules</th>',
        '              </tr>',
        '            </thead>',
        '            <tbody>',
        bodyRows,
        '            </tbody>',
        '          </table>',
        '        </div>'
    ].join('\n');
}

function renderLlmsEvidence(row: CoverageRow): string {
    if (row.layer !== 'Check') return 'evidence pending';
    const parts: string[] = [];
    if (row.provenRules.length > 0) {
        const proven = row.provenRules
            .map(r => `${r.languageLabel}: \`${r.ruleId}\` (correct: ${r.correct}, wrong: ${r.wrong}, lowerBound: ${r.lowerBound})`)
            .join('; ');
        parts.push(`Proven: ${proven}`);
    } else {
        parts.push('Proven: none');
    }
    if (row.bestPracticeRules.length > 0) {
        const bp = row.bestPracticeRules
            .map(r => `${r.languageLabel}: \`${r.ruleId}\``)
            .join('; ');
        parts.push(`Best-practice (Needs Review): ${bp}`);
    }
    return parts.join(' | ');
}

export function renderCoverageLlms(rows: CoverageRow[]): string {
    const counts = Object.fromEntries(COVERAGE_LAYERS.map(layer => [layer, rows.filter(r => r.layer === layer).length])) as Record<CoverageLayer, number>;
    const lines = [
        LLMS_COVERAGE_HEADING,
        '',
        `All ${rows.length} WCAG 2.2 Level A and AA criteria (excluding obsolete 4.1.1 Parsing), each assigned to one primary layer (${counts.Check} Check, ${counts['AI Review']} AI Review, ${counts['Browser audit']} Browser audit, ${counts.Person} Person). Non-Check layers report \`evidence pending\`; Best-practice rules stay Needs Review and are never Proven.`,
        ''
    ];
    for (const row of rows) {
        lines.push(`- **${row.criterion} ${row.name}** (Level ${row.level}) — Primary layer: ${row.layer} — ${renderLlmsEvidence(row)}`);
    }
    return lines.join('\n');
}

export function extractHtmlCoverageSection(html: string): string {
    const start = html.indexOf(HTML_START_MARKER);
    const end = html.indexOf(HTML_END_MARKER);
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`Missing ${HTML_START_MARKER} ... ${HTML_END_MARKER} markers in site/index.html`);
    }
    return html.slice(start + HTML_START_MARKER.length, end).replace(/^\r?\n/, '').replace(/\r?\n\s*$/, '');
}

export function extractLlmsCoverageSection(llms: string): string {
    const start = llms.indexOf(LLMS_COVERAGE_HEADING);
    if (start === -1) {
        throw new Error(`Missing "${LLMS_COVERAGE_HEADING}" heading in site/llms.txt`);
    }
    const afterStart = llms.slice(start);
    const nextHeadingMatch = /\n## /.exec(afterStart.slice(LLMS_COVERAGE_HEADING.length));
    const section = nextHeadingMatch
        ? afterStart.slice(0, LLMS_COVERAGE_HEADING.length + nextHeadingMatch.index)
        : afterStart;
    return section.trimEnd();
}

export function updateCoverageFiles(rootDir: string): void {
    const rows = buildCoverageMap();

    const htmlPath = path.join(rootDir, 'site', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const start = html.indexOf(HTML_START_MARKER);
    const end = html.indexOf(HTML_END_MARKER);
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`Missing ${HTML_START_MARKER} ... ${HTML_END_MARKER} markers in site/index.html`);
    }
    const renderedHtml = renderCoverageHtml(rows);
    const updatedHtml = `${html.slice(0, start + HTML_START_MARKER.length)}\n${renderedHtml}\n        ${html.slice(end)}`;
    fs.writeFileSync(htmlPath, updatedHtml);

    const llmsPath = path.join(rootDir, 'site', 'llms.txt');
    const llms = fs.readFileSync(llmsPath, 'utf-8');
    const llmsStart = llms.indexOf(LLMS_COVERAGE_HEADING);
    if (llmsStart === -1) {
        throw new Error(`Missing "${LLMS_COVERAGE_HEADING}" heading in site/llms.txt`);
    }
    const afterStart = llms.slice(llmsStart);
    const nextHeadingMatch = /\n## /.exec(afterStart.slice(LLMS_COVERAGE_HEADING.length));
    const llmsEnd = nextHeadingMatch
        ? llmsStart + LLMS_COVERAGE_HEADING.length + nextHeadingMatch.index
        : llms.length;
    const renderedLlms = renderCoverageLlms(rows);
    const updatedLlms = `${llms.slice(0, llmsStart)}${renderedLlms}\n${llms.slice(llmsEnd)}`;
    fs.writeFileSync(llmsPath, updatedLlms);
}

if (require.main === module) {
    const root = path.join(__dirname, '..');
    updateCoverageFiles(root);
    console.log('Updated site/index.html and site/llms.txt with WCAG 2.2 A/AA Coverage map.');
}
