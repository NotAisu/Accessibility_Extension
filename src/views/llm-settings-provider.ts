import * as vscode from 'vscode';
import { LLMService } from '../llm/llm-service';
import { AISemanticAnalyzer } from '../ai/ai-semantic-analyzer';
import { CodeTutorService } from '../code-tutor/code-tutor-service';
import { MetricsService } from '../metrics/metrics-service';
import { PROMPT_STRATEGIES } from '../ai/prompt-strategies';

// WebView Message Types
interface BaseWebviewMessage {
    type: string;
}

interface ProviderChangedMessage extends BaseWebviewMessage {
    type: 'providerChanged';
    provider: string;
}

interface AnalyzerToggleMessage extends BaseWebviewMessage {
    type: 'analyzerToggled';
    enabled: boolean;
}

interface AnalysisScopeMessage extends BaseWebviewMessage {
    type: 'analysisScopeChanged';
    scope: 'visible' | 'document';
}

interface PromptStrategyMessage extends BaseWebviewMessage {
    type: 'promptStrategyChanged';
    strategy: string;
}

interface CodeTutorToggleMessage extends BaseWebviewMessage {
    type: 'codeTutorToggled';
    enabled: boolean;
}

interface SaveEndpointMessage extends BaseWebviewMessage {
    type: 'saveEndpoint';
    endpoint: string;
}

interface SaveModelMessage extends BaseWebviewMessage {
    type: 'saveModel';
    model: string;
}

interface SaveApiKeyMessage extends BaseWebviewMessage {
    type: 'saveApiKey';
    apiKey: string;
}

type WebviewMessage = 
    | BaseWebviewMessage
    | ProviderChangedMessage
    | AnalyzerToggleMessage
    | AnalysisScopeMessage
    | PromptStrategyMessage
    | CodeTutorToggleMessage
    | SaveEndpointMessage
    | SaveModelMessage
    | SaveApiKeyMessage;

/**
 * WebView Provider für AI Accessibility Settings
 */
export class LLMSettingsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiAccessibilitySettings';

    private _view?: vscode.WebviewView;
    private llmService: LLMService;
    private aiAnalyzer?: AISemanticAnalyzer;
    private codeTutorService?: CodeTutorService;
    private metricsService?: MetricsService;
    private axeDiagnosticCollection?: vscode.DiagnosticCollection;
    private aiDiagnosticCollection?: vscode.DiagnosticCollection;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        llmService: LLMService
    ) {
        this.llmService = llmService;
    }

    public setAIAnalyzer(aiAnalyzer: AISemanticAnalyzer): void {
        this.aiAnalyzer = aiAnalyzer;
    }

    public setCodeTutorService(codeTutorService: CodeTutorService): void {
        this.codeTutorService = codeTutorService;
    }

    public setMetricsService(metricsService: MetricsService): void {
        this.metricsService = metricsService;
    }

    public setDiagnosticCollections(
        axeDiagnosticCollection: vscode.DiagnosticCollection,
        aiDiagnosticCollection: vscode.DiagnosticCollection
    ): void {
        this.axeDiagnosticCollection = axeDiagnosticCollection;
        this.aiDiagnosticCollection = aiDiagnosticCollection;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Message Handler für WebView Kommunikation
        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            switch (data.type) {
                case 'providerChanged':
                    await this.handleProviderChange((data as ProviderChangedMessage).provider);
                    break;
                case 'testConnection':
                    await this.handleConnectionTest();
                    break;
                case 'analyzerToggled':
                    await this.handleAnalyzerToggle((data as AnalyzerToggleMessage).enabled);
                    break;
                case 'analysisScopeChanged':
                    await this.handleAnalysisScopeChange((data as AnalysisScopeMessage).scope);
                    break;
                case 'promptStrategyChanged':
                    await this.handlePromptStrategyChange((data as PromptStrategyMessage).strategy);
                    break;
                case 'startAnalysis':
                    await this.handleStartAnalysis();
                    break;
                case 'codeTutorToggled':
                    await this.handleCodeTutorToggle((data as CodeTutorToggleMessage).enabled);
                    break;
                case 'getInitialState':
                    await this.sendInitialState();
                    break;
                case 'saveEndpoint':
                    await this.handleEndpointSave((data as SaveEndpointMessage).endpoint);
                    break;
                case 'saveModel':
                    await this.handleModelSave((data as SaveModelMessage).model);
                    break;
                case 'saveApiKey':
                    await this.handleApiKeySave((data as SaveApiKeyMessage).apiKey);
                    break;
                case 'getAvailableModels':
                    await this.handleGetAvailableModels();
                    break;
            }
        });

        // Initial state senden
        this.sendInitialState();
    }

    private async handleProviderChange(provider: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            await config.update('aiProvider', provider, vscode.ConfigurationTarget.Global);
            
            // Connection Status aktualisieren
            await this.updateConnectionStatus();
            
            vscode.window.showInformationMessage(`AI Provider geändert zu: ${provider}`);
        } catch (error) {
            vscode.window.showErrorMessage('Failed to change AI provider');
        }
    }

    private async handleEndpointSave(endpoint: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            await config.update('localLLM.endpoint', endpoint, vscode.ConfigurationTarget.Global);
            
            vscode.window.showInformationMessage('Local LLM endpoint saved');
            await this.updateConnectionStatus();
        } catch (error) {
            vscode.window.showErrorMessage('Failed to save endpoint');
        }
    }

    private async handleModelSave(model: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const currentProvider = config.get<string>('aiProvider', 'local');
            
            if (currentProvider === 'local') {
                await config.update('localLLM.model', model, vscode.ConfigurationTarget.Global);
            } else if (currentProvider === 'github-copilot') {
                await config.update('githubCopilot.model', model, vscode.ConfigurationTarget.Global);
            } else if (currentProvider === 'custom-api') {
                await config.update('customAPI.model', model, vscode.ConfigurationTarget.Global);
            }
            
            vscode.window.showInformationMessage('Model saved');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to save model');
        }
    }

    private async handleApiKeySave(apiKey: string): Promise<void> {
        try {
            // SecretStorage für API Key verwenden
            const secretStorage = this.llmService.getSecretStorage();
            await secretStorage.store('accessibility.customAPI.apiKey', apiKey);
            
            vscode.window.showInformationMessage('API key stored securely');
            await this.updateConnectionStatus();
        } catch (error) {
            vscode.window.showErrorMessage('Failed to save API key');
        }
    }

    private async handleGetAvailableModels(): Promise<void> {
        try {
            const models = await this.llmService.getAvailableModels();
            this.sendMessage({
                type: 'availableModels',
                models: models
            });
        } catch (error) {
            console.error('Failed to get available models:', error);
            this.sendMessage({
                type: 'availableModels',
                models: []
            });
        }
    }

    private async handleConnectionTest(): Promise<void> {
        try {
            this.sendMessage({ type: 'connectionStatus', status: 'testing' });
            
            const isConnected = await this.llmService.testConnection();
            const status = isConnected ? 'connected' : 'disconnected';
            
            this.sendMessage({ type: 'connectionStatus', status });
            
            const message = isConnected ? 
                'AI provider connection successful!' : 
                'AI provider connection failed. Please check settings.';
            
            if (isConnected) {
                vscode.window.showInformationMessage(message);
            } else {
                vscode.window.showErrorMessage(message);
            }
        } catch (error) {
            this.sendMessage({ type: 'connectionStatus', status: 'error' });
            vscode.window.showErrorMessage(`Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleAnalyzerToggle(enabled: boolean): Promise<void> {
        try {
            if (this.aiAnalyzer) {
                this.aiAnalyzer.setEnabled(enabled);
                
                const message = enabled ? 
                    'AI Semantic Analyzer enabled' : 
                    'AI Semantic Analyzer disabled';
                
                vscode.window.showInformationMessage(message);
                
                // Wenn deaktiviert, alle AI-Diagnostics löschen
                if (!enabled && this.aiAnalyzer) {
                    this.aiAnalyzer.clearAll();
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to toggle AI Analyzer');
        }
    }

    private async handleAnalysisScopeChange(scope: 'visible' | 'document'): Promise<void> {
        try {
            if (this.aiAnalyzer) {
                this.aiAnalyzer.setAnalysisScope(scope);
                
                const message = scope === 'visible' ? 
                    'Analysis Scope: Visible code only' : 
                    'Analysis Scope: Entire document';
                
                // Status Bar Item für schnelle Benachrichtigung
                const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
                statusBarItem.text = `$(gear) ${message}`;
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
                statusBarItem.show();
                
                // Automatisch nach 1.5 Sekunden ausblenden
                setTimeout(() => {
                    statusBarItem.dispose();
                }, 1500);
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to change analysis scope');
        }
    }

    private async handlePromptStrategyChange(strategy: string): Promise<void> {
        try {
            if (this.aiAnalyzer) {
                this.aiAnalyzer.setPromptStrategy(strategy);
                
                const strategyObj = PROMPT_STRATEGIES.find(s => s.name === strategy);
                const message = strategyObj ? 
                    `Prompt Strategy: ${strategyObj.displayName}` : 
                    `Prompt Strategy: ${strategy}`;
                
                // Status Bar Item für schnelle Benachrichtigung
                const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
                statusBarItem.text = `$(brain) ${message}`;
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
                statusBarItem.show();
                
                // Automatisch nach 1.5 Sekunden ausblenden
                setTimeout(() => {
                    statusBarItem.dispose();
                }, 1500);
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to change prompt strategy');
        }
    }

    private async handleStartAnalysis(): Promise<void> {
        try {
            if (!this.aiAnalyzer) {
                vscode.window.showErrorMessage('AI Analyzer not available');
                return;
            }

            if (!this.aiAnalyzer.isAnalyzerEnabled()) {
                vscode.window.showWarningMessage('AI Semantic Analyzer is not enabled');
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            // Progress anzeigen
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "AI Semantic Analysis running...",
                cancellable: false
            }, async () => {
                await this.aiAnalyzer!.startAnalysis();
            });

            // Metrics Dashboard nach AI-Analyse aktualisieren
            this.updateMetricsAfterAnalysis();

            vscode.window.showInformationMessage('AI Semantic Analysis completed');
        } catch (error) {
            vscode.window.showErrorMessage(`AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Aktualisiert die Metrics nach einer AI-Analyse
     */
    private updateMetricsAfterAnalysis(): void {
        if (!this.metricsService || !this.axeDiagnosticCollection || !this.aiDiagnosticCollection) {
            console.log('📊 Metrics update skipped - missing references');
            return;
        }

        try {
            // Aktualisiere globale Violation Metrics basierend auf allen aktuellen Diagnostics
            this.metricsService.updateCurrentViolationsFromDiagnostics(
                this.axeDiagnosticCollection,
                this.aiDiagnosticCollection
            );
            console.log('📊 Metrics updated after AI analysis');
        } catch (error) {
            console.error('Failed to update metrics after AI analysis:', error);
        }
    }

    private async handleCodeTutorToggle(enabled: boolean): Promise<void> {
        try {
            if (this.codeTutorService) {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    if (enabled) {
                        await this.codeTutorService.toggleAnnotations(editor);
                        vscode.window.showInformationMessage('Code Tutor enabled');
                    } else {
                        this.codeTutorService.clearAnnotations();
                        vscode.window.showInformationMessage('Code Tutor disabled');
                    }
                } else {
                    vscode.window.showWarningMessage('No active editor found');
                }
            } else {
                vscode.window.showErrorMessage('Code Tutor service not available');
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to toggle Code Tutor');
        }
    }

    private async sendInitialState(): Promise<void> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const currentProvider = config.get<string>('aiProvider', 'local');
        const analyzerEnabled = config.get<boolean>('aiAnalyzer.enabled', false);
        const analysisScope = config.get<'visible' | 'document'>('aiAnalyzer.scope', 'visible');
        const promptStrategy = config.get<string>('aiAnalyzer.promptStrategy', 'direct-instruction');
        
        // Provider-spezifische Konfigurationen
        const localEndpoint = config.get<string>('localLLM.endpoint', 'http://127.0.0.1:1234');
        const localModel = config.get<string>('localLLM.model', 'mistralai/devstral-small-2507');
        const githubModel = config.get<string>('githubCopilot.model', 'gpt-4o');
    const customEndpoint = config.get<string>('customAPI.endpoint', 'https://openrouter.ai/api/v1/chat/completions');
    const customModel = config.get<string>('customAPI.model', 'qwen/qwen3-coder:free');
        
        // API Key aus SecretStorage holen
        const secretStorage = this.llmService.getSecretStorage();
        const hasApiKey = !!(await secretStorage.get('accessibility.customAPI.apiKey'));

        this.sendMessage({
            type: 'initialState',
            provider: currentProvider,
            analyzerEnabled: analyzerEnabled,
            analysisScope: analysisScope,
            promptStrategy: promptStrategy,
            codeTutorEnabled: false, 
            config: {
                local: {
                    endpoint: localEndpoint,
                    model: localModel
                },
                githubCopilot: {
                    model: githubModel
                },
                customAPI: {
                    endpoint: customEndpoint,
                    model: customModel,
                    hasApiKey: hasApiKey
                }
            }
        });

        // Connection Status prüfen
        await this.updateConnectionStatus();
        
        // Verfügbare Modelle laden (wenn GitHub Copilot)
        if (currentProvider === 'github-copilot') {
            await this.handleGetAvailableModels();
        }
    }

    private async updateConnectionStatus(): Promise<void> {
        try {
            const isConnected = await this.llmService.testConnection();
            const status = isConnected ? 'connected' : 'disconnected';
            this.sendMessage({ type: 'connectionStatus', status });
        } catch (error) {
            this.sendMessage({ type: 'connectionStatus', status: 'error' });
        }
    }

    private sendMessage(message: Record<string, unknown>): void {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AI Accessibility Settings</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    padding: 16px;
                    margin: 0;
                    /* Responsive base styles */
                    box-sizing: border-box;
                    min-width: 0;
                    word-wrap: break-word;
                    line-height: 1.4;
                }
                
                * {
                    box-sizing: border-box;
                }
                
                .section {
                    margin-bottom: 24px;
                    /* Responsive spacing */
                    min-width: 0;
                }
                
                h3 {
                    margin: 0 0 12px 0;
                    color: var(--vscode-editor-foreground);
                    font-size: 14px;
                    font-weight: 600;
                    /* Responsive headings */
                    word-wrap: break-word;
                }
                
                .provider-option {
                    margin: 8px 0;
                    padding: 8px;
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    cursor: pointer;
                    /* Responsive provider options */
                    min-width: 0;
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                
                .provider-option:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                
                .provider-option input[type="radio"] {
                    flex-shrink: 0;
                }
                
                .provider-option label {
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    font-weight: 500;
                    /* Allow label text to wrap */
                    word-wrap: break-word;
                    min-width: 0;
                }
                
                .config-group {
                    display: none;
                    margin: 8px 0 0 20px;
                    padding: 12px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    /* Responsive config groups */
                    min-width: 0;
                }
                
                .config-group.active {
                    display: block;
                }
                
                .config-item {
                    margin-bottom: 12px;
                    /* Responsive config items */
                    min-width: 0;
                }
                
                .config-item label {
                    display: block;
                    margin-bottom: 4px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    word-wrap: break-word;
                }
                
                .config-item input,
                .config-item select {
                    width: 100%;
                    padding: 6px 8px;
                    border: 1px solid var(--vscode-input-border);
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 2px;
                    font-size: 13px;
                    box-sizing: border-box;
                    min-height: 28px;
                    text-align: left;
                    /* Responsive inputs */
                    min-width: 0;
                }
                
                .save-button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 12px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                    margin-top: 4px;
                    /* Responsive buttons */
                    min-width: 60px;
                    word-wrap: break-word;
                }
                
                .save-button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                
                .status-section {
                    margin-top: 16px;
                    padding: 12px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    /* Responsive status section */
                    min-width: 0;
                }
                
                .status {
                    display: flex;
                    align-items: center;
                    margin-bottom: 8px;
                    /* Allow wrapping on small screens */
                    flex-wrap: wrap;
                    gap: 8px;
                }
                
                .status-icon {
                    font-size: 14px;
                    flex-shrink: 0;
                }
                
                .test-button {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    padding: 6px 12px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                    /* Responsive test button */
                    min-width: 80px;
                }
                
                .analyzer-section, .code-tutor-section {
                    margin-top: 16px;
                    padding: 12px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    /* Responsive sections */
                    min-width: 0;
                }
                
                .analyzer-toggle, .code-tutor-toggle {
                    display: flex;
                    align-items: center;
                    margin-bottom: 12px;
                    /* Allow wrapping if needed */
                    flex-wrap: wrap;
                    gap: 8px;
                }
                
                .analyzer-scope {
                    margin: 12px 0;
                    min-width: 0;
                }
                
                .toggle-section-label {
                    display: block;
                    margin-bottom: 8px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    font-weight: 600;
                }
                
                /* Toggle Switch Styles */
                .toggle-switch {
                    position: relative;
                    display: inline-block;
                    margin: 4px 0;
                }
                
                .scope-info {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 6px;
                    font-weight: 500;
                }
                
                .toggle-input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                
                .toggle-label {
                    display: block;
                    width: 44px;
                    height: 22px;
                    background-color: var(--vscode-button-secondaryBackground);
                    border-radius: 11px;
                    position: relative;
                    cursor: pointer;
                    transition: background-color 0.3s ease;
                    border: 1px solid var(--vscode-button-border);
                }
                
                .toggle-label:before {
                    content: '';
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 16px;
                    height: 16px;
                    background-color: var(--vscode-button-foreground);
                    border-radius: 50%;
                    transition: transform 0.3s ease;
                }
                
                .toggle-input:checked + .toggle-label {
                    background-color: var(--vscode-button-background);
                }
                
                .toggle-input:checked + .toggle-label:before {
                    transform: translateX(22px);
                }
                
                /* Prompt Strategy Styles */
                .prompt-strategy {
                    margin: 16px 0;
                }
                
                .prompt-strategy label {
                    display: block;
                    margin-bottom: 8px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    font-weight: 600;
                }
                
                .strategy-dropdown {
                    width: 100%;
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 3px;
                    font-size: 13px;
                    outline: none;
                    cursor: pointer;
                }
                
                .strategy-dropdown:focus {
                    border-color: var(--vscode-focusBorder);
                    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
                }
                
                .strategy-description {
                    margin-top: 6px;
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                    line-height: 1.3;
                }
                
                .scope-option label {
                    font-size: 12px;
                    cursor: pointer;
                    white-space: nowrap;
                    /* Allow text to wrap if absolutely necessary */
                    word-wrap: break-word;
                }
                
                .analysis-button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                    margin-top: 8px;
                    width: 100%;
                    /* Responsive analysis button */
                    min-height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                }
                
                .analysis-button:hover:not(:disabled) {
                    background: var(--vscode-button-hoverBackground);
                }
                
                .analysis-button:disabled {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    cursor: not-allowed;
                    opacity: 0.6;
                }
                
                .analyzer-toggle input[type="checkbox"], 
                .code-tutor-toggle input[type="checkbox"] {
                    margin-right: 8px;
                    flex-shrink: 0;
                }
                
                .connected { color: #4caf50; }
                .disconnected { color: #f44336; }
                .testing { color: #ff9800; }
                .error { color: #f44336; }
                
                .description {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 4px;
                    margin-left: 20px;
                    line-height: 1.3;
                    /* Responsive description */
                    word-wrap: break-word;
                    hyphens: auto;
                }
                
                .security-notice {
                    background: var(--vscode-editorWarning-background);
                    color: var(--vscode-editorWarning-foreground);
                    padding: 6px 8px;
                    border-radius: 3px;
                    font-size: 11px;
                    margin-top: 4px;
                    line-height: 1.3;
                    /* Responsive security notice */
                    word-wrap: break-word;
                }
                
                /* Media queries for smaller screens */
                @media (max-width: 300px) {
                    body {
                        padding: 12px;
                        font-size: 12px;
                    }
                    
                    .config-group,
                    .analyzer-section,
                    .code-tutor-section,
                    .status-section {
                        padding: 8px;
                        margin-left: 10px;
                    }
                    
                    .scope-options {
                        flex-direction: column;
                        gap: 8px;
                    }
                    
                    .scope-option label {
                        white-space: normal;
                    }
                    
                    .description {
                        margin-left: 16px;
                        font-size: 10px;
                    }
                    
                    h3 {
                        font-size: 13px;
                    }
                    
                    .provider-option {
                        padding: 6px;
                    }
                }
                
                /* Media queries for very narrow panels */
                @media (max-width: 250px) {
                    body {
                        padding: 8px;
                    }
                    
                    .config-group {
                        margin-left: 5px;
                    }
                    
                    .provider-option {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 4px;
                        padding: 4px;
                    }
                    
                    .status {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 4px;
                    }
                    
                    .analyzer-toggle,
                    .code-tutor-toggle {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 4px;
                    }
                    
                    .section {
                        margin-bottom: 16px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="section">
                <h3>🧠 AI Provider</h3>
                
                <div class="provider-option">
                    <input type="radio" id="local" name="provider" value="local">
                    <label for="local">Local LLM</label>
                </div>
                
                <div class="config-group" id="local-config">
                    <div class="config-item">
                        <label for="local-endpoint">Endpoint URL:</label>
                        <input type="text" id="local-endpoint" placeholder="http://127.0.0.1:1234">
                        <button class="save-button" onclick="saveEndpoint()">Save</button>
                    </div>
                    <div class="config-item">
                        <label for="local-model">Model:</label>
                        <input type="text" id="local-model" placeholder="mistralai/devstral-small-2507">
                        <button class="save-button" onclick="saveModel()">Save</button>
                    </div>
                    <div class="description">LM Studio, Ollama, or other OpenAI-compatible servers</div>
                </div>
                
                <div class="provider-option">
                    <input type="radio" id="copilot" name="provider" value="github-copilot">
                    <label for="copilot">GitHub Copilot</label>
                </div>
                
                <div class="config-group" id="github-copilot-config">
                    <div class="config-item">
                        <label for="copilot-model">Model:</label>
                               <select id="copilot-model" onchange="saveModel()">
            <!-- Standard Models -->
            <option value="gpt-4.1">GPT-4.1</option>
            <option value="gpt-4o">GPT-4o</option>
            <!-- Premium Models -->
            <option value="claude-3.5-sonnet">Claude Sonnet 3.5</option>
            <option value="claude-3.7-sonnet">Claude Sonnet 3.7</option>
            <option value="claude-3.7-sonnet-thinking">Claude Sonnet 3.7 Thinking</option>
            <option value="claude-4-sonnet">Claude Sonnet 4</option>
            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro (Preview)</option>
            <option value="o3-mini">o3-mini</option>
            <option value="o4-mini">o4-mini (Preview)</option>
        </select>
    </div>
    <div class="description">Available models based on your GitHub Copilot plan</div>
                </div>
                
                <div class="provider-option">
                    <input type="radio" id="custom" name="provider" value="custom-api">
                    <label for="custom">OpenRouter</label>
                </div>
                
                <div class="config-group" id="custom-api-config">
                    <div class="config-item">
                        <label for="custom-endpoint">API Endpoint (read-only):</label>
                        <input type="text" id="custom-endpoint" disabled>
                    </div>
                    <div class="config-item">
                        <label for="custom-model">Model:</label>
                        <input type="text" id="custom-model" placeholder="qwen/qwen3-coder:free">
                        <button class="save-button" onclick="saveModel()">Save</button>
                    </div>
                    <div class="config-item">
                        <label for="custom-apikey">API Key:</label>
                        <input type="password" id="custom-apikey" placeholder="sk-...">
                        <button class="save-button" onclick="saveApiKey()">Save</button>
                        <div class="security-notice" id="apikey-status">🔒 API key is stored securely in VS Code SecretStorage</div>
                    </div>
                    <div class="description">Uses OpenRouter. Set your OpenRouter API key and model. Endpoint is fixed.</div>
                </div>
            </div>
            
            <div class="status-section">
                <h3>Connection Status</h3>
                <div class="status">
                    <span class="status-icon" id="status-icon">⚪</span>
                    <span id="status-text">Checking...</span>
                </div>
                <button class="test-button" onclick="testConnection()">Test Connection</button>
            </div>
            
            <div class="analyzer-section">
                <h3>AI Semantic Analyzer</h3>
                <div class="analyzer-toggle">
                    <input type="checkbox" id="analyzer-enabled">
                    <label for="analyzer-enabled">Enable AI Semantic Analyzer</label>
                </div>
                <div class="description">Finds semantic WCAG issues that axe-core misses</div>
                
                <div class="analyzer-scope">
                    <label class="toggle-section-label">Analysis Scope:</label>
                    <div class="scope-info">Visible code</div>
                    <div class="toggle-switch">
                        <input type="checkbox" id="scope-toggle" class="toggle-input">
                        <label for="scope-toggle" class="toggle-label"></label>
                    </div>
                </div>
                
                <div class="prompt-strategy">
                    <label for="prompt-strategy-select">Prompt Strategy:</label>
                    <select id="prompt-strategy-select" class="strategy-dropdown">
                        <option value="direct-instruction">Direct Instruction - Scientifically optimized zero-shot analysis</option>
                        <option value="few-shot">Few-Shot Learning - Strategic pattern induction through examples</option>
                        <option value="chain-of-thought">Chain-of-Thought - Structured analytical reasoning process</option>
                    </select>
                    <div class="strategy-description" id="strategy-description">
                        Direct instruction with single example for quick analysis
                    </div>
                </div>
                
                <button class="analysis-button" id="start-analysis" disabled>
                    🔍 Start analysis
                </button>
            </div>
            
            <div class="code-tutor-section">
                <h3>Code Tutor</h3>
                <div class="code-tutor-toggle">
                    <input type="checkbox" id="code-tutor-enabled">
                    <label for="code-tutor-enabled">Enable Code Tutor annotations</label>
                </div>
                <div class="description">Shows accessibility tips directly in the code</div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                // Radio button event listeners
                document.querySelectorAll('input[name="provider"]').forEach(radio => {
                    radio.addEventListener('change', function() {
                        if (this.checked) {
                            vscode.postMessage({
                                type: 'providerChanged',
                                provider: this.value
                            });
                            updateConfigVisibility(this.value);
                        }
                    });
                });
                
                // Analyzer toggle
                document.getElementById('analyzer-enabled').addEventListener('change', function() {
                    const enabled = this.checked;
                    vscode.postMessage({
                        type: 'analyzerToggled',
                        enabled: enabled
                    });
                    
                    // Start Analysis Button aktivieren/deaktivieren
                    const startButton = document.getElementById('start-analysis');
                    startButton.disabled = !enabled;
                });
                
                // Analysis Scope toggle switch
                document.getElementById('scope-toggle').addEventListener('change', function() {
                    const scope = this.checked ? 'document' : 'visible';
                    const scopeInfo = document.querySelector('.scope-info');
                    if (scopeInfo) {
                        scopeInfo.textContent = this.checked ? 'Entire document' : 'Visible code';
                    }
                    vscode.postMessage({
                        type: 'analysisScopeChanged',
                        scope: scope
                    });
                });
                
                // Prompt Strategy dropdown
                document.getElementById('prompt-strategy-select').addEventListener('change', function() {
                    const strategy = this.value;
                    vscode.postMessage({
                        type: 'promptStrategyChanged',
                        strategy: strategy
                    });
                    
                    // Update strategy description
                    updateStrategyDescription(strategy);
                });
                
                function updateStrategyDescription(strategy) {
                    const descriptions = {
                        'direct-instruction': 'Scientifically optimized zero-shot approach with explicit role assignment and structured task decomposition (Brown et al., 2020)',
                        'few-shot': 'Strategic pattern induction through curated high-signal examples for optimal learning (Min et al., 2022)',
                        'chain-of-thought'
                    };
                    
                    const descElement = document.getElementById('strategy-description');
                    if (descElement) {
                        descElement.textContent = descriptions[strategy] || 'Unknown strategy';
                    }
                }
                
                // Start Analysis Button
                document.getElementById('start-analysis').addEventListener('click', function() {
                    if (!this.disabled) {
                        vscode.postMessage({
                            type: 'startAnalysis'
                        });
                    }
                });
                
                // Code Tutor toggle (single listener)
                document.getElementById('code-tutor-enabled').addEventListener('change', function() {
                    vscode.postMessage({
                        type: 'codeTutorToggled',
                        enabled: this.checked
                    });
                });
                
                // Global functions for save buttons
                function saveEndpoint() {
                    const provider = document.querySelector('input[name="provider"]:checked').value;
                    let endpoint;
                    
                    if (provider === 'local') {
                        endpoint = document.getElementById('local-endpoint').value;
                    }
                    
                    if (endpoint) {
                        vscode.postMessage({
                            type: 'saveEndpoint',
                            endpoint: endpoint
                        });
                    }
                }
                
                function saveModel() {
                    const provider = document.querySelector('input[name="provider"]:checked').value;
                    let model;
                    
                    if (provider === 'local') {
                        model = document.getElementById('local-model').value;
                    } else if (provider === 'github-copilot') {
                        model = document.getElementById('copilot-model').value;
                    } else if (provider === 'custom-api') {
                        model = document.getElementById('custom-model').value;
                    }
                    
                    if (model) {
                        vscode.postMessage({
                            type: 'saveModel',
                            model: model
                        });
                    }
                }
                
                function saveApiKey() {
                    const apiKey = document.getElementById('custom-apikey').value;
                    if (apiKey) {
                        vscode.postMessage({
                            type: 'saveApiKey',
                            apiKey: apiKey
                        });
                        document.getElementById('custom-apikey').value = ''; // Clear input for security
                    }
                }
                
                function testConnection() {
                    vscode.postMessage({ type: 'testConnection' });
                }
                
                function updateConfigVisibility(provider) {
                    // Hide all config groups
                    document.querySelectorAll('.config-group').forEach(group => {
                        group.classList.remove('active');
                    });
                    
                    // Show active config group
                    const activeConfig = document.getElementById(provider + '-config');
                    if (activeConfig) {
                        activeConfig.classList.add('active');
                    }
                    
                    // Load available models if GitHub Copilot
                    if (provider === 'github-copilot') {
                        vscode.postMessage({ type: 'getAvailableModels' });
                    }
                }
                
                // Message handler
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.type) {
                        case 'initialState':
                            // Set provider
                            const providerRadio = document.querySelector(\`input[value="\${message.provider}"]\`);
                            if (providerRadio) {
                                providerRadio.checked = true;
                                updateConfigVisibility(message.provider);
                            }
                            
                            // Set analyzer state
                            document.getElementById('analyzer-enabled').checked = message.analyzerEnabled;
                            
                            // Set analysis scope toggle
                            const scopeToggle = document.getElementById('scope-toggle');
                            const scopeInfo = document.querySelector('.scope-info');
                            if (scopeToggle) {
                                scopeToggle.checked = (message.analysisScope === 'document');
                                if (scopeInfo) {
                                    scopeInfo.textContent = (message.analysisScope === 'document') ? 'Entire document' : 'Visible code';
                                }
                            }
                            
                            // Set prompt strategy
                            const strategySelect = document.getElementById('prompt-strategy-select');
                            if (strategySelect && message.promptStrategy) {
                                strategySelect.value = message.promptStrategy;
                                updateStrategyDescription(message.promptStrategy);
                            }
                            
                            // Enable/disable start analysis button
                            const startButton = document.getElementById('start-analysis');
                            startButton.disabled = !message.analyzerEnabled;
                            
                            // Set code tutor state
                            document.getElementById('code-tutor-enabled').checked = message.codeTutorEnabled || false;
                            
                            // Set config values
                            if (message.config) {
                                const config = message.config;
                                
                                // Local LLM config
                                if (config.local) {
                                    document.getElementById('local-endpoint').value = config.local.endpoint || '';
                                    document.getElementById('local-model').value = config.local.model || '';
                                }
                                
                                // GitHub Copilot config
                                if (config.githubCopilot) {
                                    document.getElementById('copilot-model').value = config.githubCopilot.model || 'gpt-4o';
                                }
                                
                                // Custom API config
                                if (config.customAPI) {
                                    const ce = document.getElementById('custom-endpoint');
                                    ce.value = config.customAPI.endpoint || 'https://openrouter.ai/api/v1/chat/completions';
                                    ce.disabled = true;
                                    document.getElementById('custom-model').value = config.customAPI.model || '';
                                    
                                    const apiKeyStatus = document.getElementById('apikey-status');
                                    if (config.customAPI.hasApiKey) {
                                        apiKeyStatus.textContent = '🔒 API key stored';
                                        apiKeyStatus.style.color = '#4caf50';
                                    } else {
                                        apiKeyStatus.textContent = '🔒 API key is stored securely in VS Code SecretStorage';
                                        apiKeyStatus.style.color = '';
                                    }
                                }
                            }
                            break;
                            
                        case 'connectionStatus':
                            updateConnectionStatus(message.status);
                            break;
                            
                        case 'availableModels':
                            updateAvailableModels(message.models);
                            break;
                    }
                });
                
                function updateConnectionStatus(status) {
                    const statusIcon = document.getElementById('status-icon');
                    const statusText = document.getElementById('status-text');
                    
                    switch (status) {
                        case 'connected':
                            statusIcon.textContent = '🟢';
                            statusText.textContent = 'Connected';
                            statusText.className = 'connected';
                            break;
                        case 'disconnected':
                            statusIcon.textContent = '🔴';
                            statusText.textContent = 'Disconnected';
                            statusText.className = 'disconnected';
                            break;
                        case 'testing':
                            statusIcon.textContent = '🟡';
                            statusText.textContent = 'Testing connection...';
                            statusText.className = 'testing';
                            break;
                        case 'error':
                            statusIcon.textContent = '🔴';
                            statusText.textContent = 'Connection error';
                            statusText.className = 'error';
                            break;
                    }
                }
                
                function updateAvailableModels(models) {
                    const modelSelect = document.getElementById('copilot-model');
                    if (models && models.length > 0) {
                        // Update options with available models
                        modelSelect.innerHTML = '';
                        models.forEach(model => {
                            const option = document.createElement('option');
                            option.value = model;
                            option.textContent = model;
                            modelSelect.appendChild(option);
                        });
                    }
                }
                
                // Request initial state
                vscode.postMessage({ type: 'getInitialState' });
            </script>
        </body>
        </html>`;
    }
}
