import * as core from '../../src/core/analysis';

/** analyse() with every rule a Proven rule: tests of the engines check each rule's matches; the proof policy has its own tests. */
export const analyse = (document: core.AnalysisDocument, options: core.AnalysisOptions = {}) => core.analyse(document, { ...options, proven: () => true });
