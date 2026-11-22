import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { GroundTruthCase } from './ground-truth';
import sources from './vue-iframe-sources.json';

async function pinnedText(cache: string, url: string, digest: string): Promise<string> {
    const file = path.join(cache, digest);
    let bytes: Buffer;
    if (fs.existsSync(file)) {
        bytes = fs.readFileSync(file);
    } else {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
    }
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error(`Source changed: ${url}`);
    fs.writeFileSync(file, bytes);
    return bytes.toString('utf8');
}

interface VueIframeCase {
    testCase: GroundTruthCase;
    text: string;
    licenceFile: string;
    licence: string;
}

/** A known visible native iframe loses its sole accessible-name attribute (ACT cae760). */
export async function vueIframeCases(sourcesDir: string): Promise<VueIframeCase[]> {
    const cache = path.join(sourcesDir, 'vue-iframe-cache');
    fs.mkdirSync(cache, { recursive: true });
    const result: VueIframeCase[] = [];
    for (let start = 0; start < sources.length; start += 8) {
        const group = sources.slice(start, start + 8);
        result.push(...await Promise.all(group.map(async source => {
            const { repo, commit, file, licencePath, line, titleLine, titleColumn, title } = source;
            const raw = `https://raw.githubusercontent.com/${repo}/${commit}/`;
            const [original, licence] = await Promise.all([
                pinnedText(cache, raw + encodeURI(file), source.sourceHash),
                pinnedText(cache, raw + encodeURI(licencePath), source.licenceHash)
            ]);
            const lines = original.split('\n');
            const row = lines[titleLine - 1];
            if (!row.startsWith(title, titleColumn) || !/<iframe\b/.test(lines[line - 1])) throw new Error(`Expected iframe title in ${repo}/${file}:${titleLine}`);
            lines[titleLine - 1] = (row.slice(0, titleColumn).trimEnd() + row.slice(titleColumn + title.length)).trimEnd();
            const directory = repo.replace('/', '__') + '-' + commit.slice(0, 8);
            const fixture = `iframe-without-title/${directory}/${file.replace(/\//g, '__')}`;
            const licenceFile = `licenses/${directory}`;
            return {
                testCase: {
                    file: fixture,
                    languageId: 'vue',
                    note: `https://github.com/${repo}/blob/${commit}/${encodeURI(file)}#L${line} (licence in ${licenceFile}). The exposed native iframe loses its sole naming attribute on line ${titleLine} (ACT cae760).`,
                    expect: [{ criterion: '4.1.2', line }]
                },
                text: lines.join('\n'),
                licenceFile,
                licence
            };
        })));
    }
    return result;
}
