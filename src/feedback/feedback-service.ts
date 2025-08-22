import * as vscode from 'vscode';
import { MetricsService, FeedbackType } from '../metrics/metrics-service';

export interface FeedbackOptions {
    quickFixId?: string;
    violationId?: string;
    title: string;
    message: string;
    showThumbsUpDown?: boolean;
    showCustomInput?: boolean;
}

interface FeedbackCommandArgs {
    quickFixId?: string;
    violationId?: string;
    feedback: 'positive' | 'negative';
    ruleId: string;
}

export class FeedbackService {
    private static instance: FeedbackService;
    private metricsService: MetricsService;
    private aiDiagnosticCollection?: vscode.DiagnosticCollection;
    private givenFeedbackForDiagnostics: Set<string> = new Set(); // instanceId based now

    private constructor(metricsService: MetricsService) {
        this.metricsService = metricsService;
    }

    public static getInstance(metricsService?: MetricsService): FeedbackService {
        if (!FeedbackService.instance && metricsService) {
            FeedbackService.instance = new FeedbackService(metricsService);
        }
        return FeedbackService.instance;
    }

    public setAIDiagnosticCollection(collection: vscode.DiagnosticCollection) {
        this.aiDiagnosticCollection = collection;
    }

    /**
     * Shows a feedback dialog for quick fix operations
     */
    public async showQuickFixFeedback(quickFixId: string, ruleId: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const showFeedback = config.get<boolean>('feedback.showQuickFixFeedback', true);
        
        if (!showFeedback) return;

        try {
            const result = await vscode.window.showInformationMessage(
                `How would you rate this fix for rule "${ruleId}"?`,
                {
                    modal: false,
                    detail: 'Your feedback helps improve AI suggestions'
                },
                '👍 Good Fix',
                '👎 Poor Fix',
                'Skip'
            );

            if (result === '👍 Good Fix') {
                this.metricsService.recordQuickFixFeedback(quickFixId, 'positive');
                this.showThankYouMessage();
            } else if (result === '👎 Poor Fix') {
                this.metricsService.recordQuickFixFeedback(quickFixId, 'negative');
                this.showThankYouMessage();
            }
        } catch (error) {
            console.error('Error showing quick fix feedback:', error);
        }
    }

    /**
     * Shows a feedback dialog for AI analyzer violations
     */
    public async showViolationFeedback(violationId: string, ruleId: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const showFeedback = config.get<boolean>('feedback.showViolationFeedback', true);
        
        if (!showFeedback) return;

        try {
            const result = await vscode.window.showInformationMessage(
                `Was this AI detection for rule "${ruleId}" correct?`,
                {
                    modal: false,
                    detail: 'Help us improve violation detection accuracy'
                },
                '✅ Correct',
                '❌ False Positive',
                'Skip'
            );

            if (result === '✅ Correct') {
                this.metricsService.recordViolationFeedback(true);
                this.showThankYouMessage();
            } else if (result === '❌ False Positive') {
                this.metricsService.recordViolationFeedback(false);
                this.showThankYouMessage();
            }
        } catch (error) {
            console.error('Error showing violation feedback:', error);
        }
    }

    /**
     * Shows a non-intrusive feedback notification
     */
    public async showQuickFeedback(options: FeedbackOptions): Promise<FeedbackType | undefined> {
        try {
            const buttons = options.showThumbsUpDown ? ['👍', '👎'] : ['OK'];
            
            const result = await vscode.window.showInformationMessage(
                options.title,
                {
                    modal: false,
                    detail: options.message
                },
                ...buttons,
                'Skip'
            );

            if (result === '👍') {
                if (options.quickFixId) {
                    this.metricsService.recordQuickFixFeedback(options.quickFixId, 'positive');
                } else if (options.violationId) {
                    this.metricsService.recordViolationFeedback(true);
                }
                return 'positive';
            } else if (result === '👎') {
                if (options.quickFixId) {
                    this.metricsService.recordQuickFixFeedback(options.quickFixId, 'negative');
                } else if (options.violationId) {
                    this.metricsService.recordViolationFeedback(false);
                }
                return 'negative';
            }

            return undefined;
        } catch (error) {
            console.error('Error showing quick feedback:', error);
            return undefined;
        }
    }

    /**
     * Shows a thank you message for positive feedback
     */
    private showThankYouMessage(): void {
        const messages = [
            'Thanks for the feedback! 🎉',
            'Great! Your input helps improve the AI. 👍',
            'Excellent! Thanks for helping us learn. ⭐',
            'Perfect! Your feedback is valuable. 💯'
        ];
        
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        
        // Use a subtle notification that doesn't interrupt workflow
        vscode.window.setStatusBarMessage(randomMessage, 3000);
    }

    /**
     * Shows inline feedback buttons in hover/code action context
     */
    public createInlineFeedbackButtons(quickFixId: string, ruleId: string): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        
        // Create command URIs for feedback
        const positiveUri = vscode.Uri.parse(`command:accessibility-extension.giveFeedback?${encodeURIComponent(JSON.stringify({
            quickFixId,
            feedback: 'positive',
            ruleId
        }))}`);
        
        const negativeUri = vscode.Uri.parse(`command:accessibility-extension.giveFeedback?${encodeURIComponent(JSON.stringify({
            quickFixId,
            feedback: 'negative',
            ruleId
        }))}`);

        markdown.appendMarkdown(`\n\n---\n**Rate this fix:** `);
        markdown.appendMarkdown(`[👍 Good](${positiveUri} "This fix was helpful") | `);
        markdown.appendMarkdown(`[👎 Poor](${negativeUri} "This fix needs improvement")`);
        
        return markdown;
    }

    /**
     * Creates a feedback command for use in code actions and hovers
     */
    public createFeedbackCommand(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    disposables.push(vscode.commands.registerCommand('accessibility-extension.giveFeedback', async (args: FeedbackCommandArgs) => {
            try {
                const { quickFixId, violationId, feedback, ruleId } = args;
                
                if (quickFixId && feedback) {
                    this.metricsService.recordQuickFixFeedback(quickFixId, feedback);
                    this.showThankYouMessage();
                } else if (violationId && feedback) {
                    // feedback param includes instanceId encoded? We expect args.violationId to still be violationId; need instanceId separately in command args in future if required.
                    const key = args.violationId + ':' + (args as any).instanceId;
                    if (this.givenFeedbackForDiagnostics.has(key)) {
                        vscode.window.setStatusBarMessage('Feedback wurde bereits abgegeben.', 2500);
                        return;
                    }
                    const isCorrect = feedback === 'positive';
                    this.metricsService.recordViolationFeedback(isCorrect);
                    this.givenFeedbackForDiagnostics.add(key);
                    this.showThankYouMessage();
                    // Flag in Diagnostic setzen
                    this.markFeedbackGiven(violationId);
                    if (!isCorrect) {
                        // False Positive -> entsprechende Diagnostic entfernen
                        this.removeAIDiagnosticByViolationId(violationId);
                    }
                }
            } catch (error) {
                console.error('Error processing feedback command:', error);
            }
        }));
        // Dismiss command
        disposables.push(vscode.commands.registerCommand('accessibility-extension.dismissAIDiagnostic', async (rawArgs: any) => {
            try {
                const { violationId } = rawArgs || {};
                if (violationId) {
                    this.removeAIDiagnosticByViolationId(violationId);
                    vscode.window.setStatusBarMessage('AI diagnostic dismissed.', 2500);
                }
            } catch (error) {
                console.error('Error dismissing AI diagnostic:', error);
            }
        }));
        return { dispose: () => disposables.forEach(d => d.dispose()) };
    }

    /**
     * Creates a hover provider that shows feedback options for diagnostics
     */
    public createFeedbackHoverProvider(): vscode.HoverProvider {
        const self = this;
        return {
            provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
                // Get diagnostics at current position
                const diagnostics = vscode.languages.getDiagnostics(document.uri);
                const relevantDiagnostic = diagnostics.find(diag => diag.range.contains(position));
                
                if (!relevantDiagnostic || !relevantDiagnostic.code) {
                    return null;
                }

                try {
                    // Check if this is an AI-generated diagnostic
                    const codeData = typeof relevantDiagnostic.code === 'string' 
                        ? JSON.parse(relevantDiagnostic.code) 
                        : relevantDiagnostic.code;
                    
                    if (codeData.isAIGenerated) {
                        const markdown = new vscode.MarkdownString();
                        markdown.isTrusted = true;
                        
                        markdown.appendMarkdown(`**AI Accessibility Detection**\n\n`);
                        markdown.appendMarkdown(`${relevantDiagnostic.message}\n\n`);
                        
                        // Add feedback buttons for AI violations
                        // Versuche persistente violationId aus diagnostic.code zu lesen; fallback generieren
                        let violationId: string | undefined;
                        try {
                            violationId = codeData.violationId;
                        } catch {}
                        if (!violationId) {
                            violationId = `violation_${position.line}_${relevantDiagnostic.range.start.character}`;
                        }
                        const instanceId = codeData.instanceId || violationId;
                        const key = violationId + ':' + instanceId;
                        const alreadyGiven = self.givenFeedbackForDiagnostics.has(key);
                        
                        const correctUri = vscode.Uri.parse(`command:accessibility-extension.giveFeedback?${encodeURIComponent(JSON.stringify({
                            violationId,
                            instanceId,
                            feedback: 'positive',
                            ruleId: codeData.ruleId
                        }))}`);
                        
                        const incorrectUri = vscode.Uri.parse(`command:accessibility-extension.giveFeedback?${encodeURIComponent(JSON.stringify({
                            violationId,
                            instanceId,
                            feedback: 'negative',
                            ruleId: codeData.ruleId
                        }))}`);

                        const dismissUri = vscode.Uri.parse(`command:accessibility-extension.dismissAIDiagnostic?${encodeURIComponent(JSON.stringify({
                            violationId,
                            instanceId
                        }))}`);

                        if (alreadyGiven) {
                            markdown.appendMarkdown(`---\n_Feedback bereits gegeben._`);
                        } else {
                            markdown.appendMarkdown(`---\n**Is this detection correct?** `);
                            markdown.appendMarkdown(`[✅ Yes](${correctUri} "This violation is correct") | `);
                            markdown.appendMarkdown(`[❌ No](${incorrectUri} "This is a false positive") | `);
                            markdown.appendMarkdown(`[🗑️ Dismiss](${dismissUri} "Remove this underline only")`);
                        }
                        
                        return new vscode.Hover(markdown);
                    }
                } catch (error) {
                    // Ignore parsing errors
                }

                return null;
            }
        };
    }

    private removeAIDiagnosticByViolationId(violationId: string) {
        if (!this.aiDiagnosticCollection) return;
        this.aiDiagnosticCollection.forEach((uri, diagnostics) => {
            const remaining = diagnostics.filter(diag => {
                try {
                    if (typeof diag.code === 'string') {
                        const data = JSON.parse(diag.code);
                        return data.violationId !== violationId;
                    }
                } catch {}
                return true;
            });
            if (remaining.length !== diagnostics.length) {
                this.aiDiagnosticCollection!.set(uri, remaining);
            }
        });
    }

    private markFeedbackGiven(violationId: string) {
        if (!this.aiDiagnosticCollection) return;
        this.aiDiagnosticCollection.forEach((uri, diagnostics) => {
            let changed = false;
            diagnostics.forEach(diag => {
                if (typeof diag.code === 'string') {
                    try {
                        const data = JSON.parse(diag.code);
                        if (data.violationId === violationId && !data.feedbackGiven) {
                            data.feedbackGiven = true;
                            diag.code = JSON.stringify(data);
                            changed = true;
                        }
                    } catch {}
                }
            });
            if (changed) {
                this.aiDiagnosticCollection!.set(uri, diagnostics);
            }
        });
    }
  }