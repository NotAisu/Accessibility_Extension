import * as assert from 'assert';
import { AuditReport, blocking } from '../../scripts/audit';

const advisory = (id: string, severity: string) => ({ url: `https://github.com/advisories/${id}`, title: `${id} title`, severity });

const report: AuditReport = {
    vulnerabilities: {
        picomatch: { via: [advisory('GHSA-aaaa-aaaa-aaaa', 'high')] },
        tinyglobby: { via: ['picomatch'] },
        minimatch: { via: [advisory('GHSA-bbbb-bbbb-bbbb', 'moderate')] },
        other: { via: [advisory('GHSA-cccc-cccc-cccc', 'critical')] }
    }
};
const allowed = { 'GHSA-aaaa-aaaa-aaaa': { until: '2026-12-31', why: 'test' } };

describe('audit', () => {
    it('fails on high and critical advisories, but not on an allowed one or a moderate one', () => {
        assert.deepStrictEqual(blocking(report, allowed, '2026-11-17'), ['GHSA-CCCC-CCCC-CCCC critical: GHSA-cccc-cccc-cccc title']);
    });

    it('fails on an allowed advisory again after its date', () => {
        assert.deepStrictEqual(blocking(report, allowed, '2027-01-01'), [
            'GHSA-AAAA-AAAA-AAAA high: GHSA-aaaa-aaaa-aaaa title',
            'GHSA-CCCC-CCCC-CCCC critical: GHSA-cccc-cccc-cccc title'
        ]);
    });
});
