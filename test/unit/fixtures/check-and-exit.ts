// Checks one document and then does nothing: the process must exit on its own
import { AnalysisWorker } from '../../../src/analysis-worker';

void new AnalysisWorker(process.argv[2]).check('a.html', { languageId: 'html', text: 'ok' });
