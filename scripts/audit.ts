// `npm audit` of the shipped dependencies: fails on a high or critical advisory, except one allowed below until its date.
// Plain `npm audit` cannot skip a single advisory.
import { execFileSync } from 'child_process';

interface Allowed {
    /** Last day the advisory is allowed, YYYY-MM-DD; after it the audit fails again. */
    until: string;
    why: string;
}

export const ALLOWED: Record<string, Allowed> = {
    // No patched picomatch exists yet. It ships only through astro-eslint-parser, which globs the bundled parser
    // options' `project` patterns, never a pattern from the checked file or the workspace
    'GHSA-fc5q-39xc-vjpf': { until: '2026-12-31', why: 'picomatch ReDoS, unreachable from the checked file' }
};

interface Advisory {
    url: string;
    title: string;
    severity: string;
}

export interface AuditReport {
    vulnerabilities: Record<string, { via: (string | Advisory)[] }>;
}

/** The high or critical advisories that fail the audit, by GHSA id. */
export function blocking(report: AuditReport, allowed: Record<string, Allowed>, today: string): string[] {
    const ids = new Map<string, string>();
    for (const { via } of Object.values(report.vulnerabilities)) {
        for (const advisory of via) {
            if (typeof advisory === 'string' || !['high', 'critical'].includes(advisory.severity)) continue;
            const id = advisory.url.split('/').pop()!.toUpperCase();
            const allowance = Object.entries(allowed).find(([key]) => key.toUpperCase() === id)?.[1];
            if (!allowance || allowance.until < today) ids.set(id, `${id} ${advisory.severity}: ${advisory.title}`);
        }
    }
    return [...ids.values()].sort();
}

if (require.main === module) {
    let output: string;
    try {
        output = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
    } catch (error) {
        // npm audit exits non-zero when it finds anything; the report is still on stdout
        output = (error as { stdout?: string }).stdout ?? '';
    }
    const found = blocking(JSON.parse(output) as AuditReport, ALLOWED, new Date().toISOString().slice(0, 10));
    for (const line of found) console.error(line);
    for (const [id, { until, why }] of Object.entries(ALLOWED)) console.log(`Allowed until ${until}: ${id} (${why})`);
    process.exit(found.length ? 1 : 0);
}
