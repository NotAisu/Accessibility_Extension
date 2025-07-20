"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMSettingsProvider = void 0;
const vscode = __importStar(require("vscode"));
/**
 * WebView Provider für AI Accessibility Settings
 */
class LLMSettingsProvider {
    constructor(_extensionUri, llmService) {
        this._extensionUri = _extensionUri;
        this.llmService = llmService;
    }
    setAIAnalyzer(aiAnalyzer) {
        this.aiAnalyzer = aiAnalyzer;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // Message Handler für WebView Kommunikation
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'providerChanged':
                    await this.handleProviderChange(data.provider);
                    break;
                case 'testConnection':
                    await this.handleConnectionTest();
                    break;
                case 'analyzerToggled':
                    await this.handleAnalyzerToggle(data.enabled);
                    break;
                case 'getInitialState':
                    await this.sendInitialState();
                    break;
                case 'saveEndpoint':
                    await this.handleEndpointSave(data.endpoint);
                    break;
                case 'saveModel':
                    await this.handleModelSave(data.model);
                    break;
                case 'saveApiKey':
                    await this.handleApiKeySave(data.apiKey);
                    break;
                case 'getAvailableModels':
                    await this.handleGetAvailableModels();
                    break;
            }
        });
        // Initial state senden
        this.sendInitialState();
    }
    async handleProviderChange(provider) {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            await config.update('aiProvider', provider, vscode.ConfigurationTarget.Global);
            // Connection Status aktualisieren
            await this.updateConnectionStatus();
            vscode.window.showInformationMessage(`AI Provider geändert zu: ${provider}`);
        }
        catch (error) {
            vscode.window.showErrorMessage('Fehler beim Ändern des AI Providers');
        }
    }
    async handleEndpointSave(endpoint) {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            await config.update('localLLM.endpoint', endpoint, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Local LLM Endpoint gespeichert');
            await this.updateConnectionStatus();
        }
        catch (error) {
            vscode.window.showErrorMessage('Fehler beim Speichern des Endpoints');
        }
    }
    async handleModelSave(model) {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const currentProvider = config.get('aiProvider', 'local');
            if (currentProvider === 'local') {
                await config.update('localLLM.model', model, vscode.ConfigurationTarget.Global);
            }
            else if (currentProvider === 'github-copilot') {
                await config.update('githubCopilot.model', model, vscode.ConfigurationTarget.Global);
            }
            else if (currentProvider === 'custom-api') {
                await config.update('customAPI.model', model, vscode.ConfigurationTarget.Global);
            }
            vscode.window.showInformationMessage('Modell gespeichert');
        }
        catch (error) {
            vscode.window.showErrorMessage('Fehler beim Speichern des Modells');
        }
    }
    async handleApiKeySave(apiKey) {
        try {
            // SecretStorage für API Key verwenden
            const secretStorage = this.llmService.getSecretStorage();
            await secretStorage.store('accessibility.customAPI.apiKey', apiKey);
            vscode.window.showInformationMessage('API Key sicher gespeichert');
            await this.updateConnectionStatus();
        }
        catch (error) {
            vscode.window.showErrorMessage('Fehler beim Speichern des API Keys');
        }
    }
    async handleGetAvailableModels() {
        try {
            const models = await this.llmService.getAvailableModels();
            this.sendMessage({
                type: 'availableModels',
                models: models
            });
        }
        catch (error) {
            console.error('Failed to get available models:', error);
            this.sendMessage({
                type: 'availableModels',
                models: []
            });
        }
    }
    async handleConnectionTest() {
        try {
            this.sendMessage({ type: 'connectionStatus', status: 'testing' });
            const isConnected = await this.llmService.testConnection();
            const status = isConnected ? 'connected' : 'disconnected';
            this.sendMessage({ type: 'connectionStatus', status });
            const message = isConnected ?
                'AI Provider Verbindung erfolgreich!' :
                'AI Provider Verbindung fehlgeschlagen. Bitte Einstellungen prüfen.';
            if (isConnected) {
                vscode.window.showInformationMessage(message);
            }
            else {
                vscode.window.showErrorMessage(message);
            }
        }
        catch (error) {
            this.sendMessage({ type: 'connectionStatus', status: 'error' });
            vscode.window.showErrorMessage(`Verbindungstest fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
        }
    }
    async handleAnalyzerToggle(enabled) {
        try {
            if (this.aiAnalyzer) {
                this.aiAnalyzer.setEnabled(enabled);
                const message = enabled ?
                    'AI Semantic Analyzer aktiviert' :
                    'AI Semantic Analyzer deaktiviert';
                vscode.window.showInformationMessage(message);
                // Wenn deaktiviert, alle AI-Diagnostics löschen
                if (!enabled && this.aiAnalyzer) {
                    this.aiAnalyzer.clearAll();
                }
            }
        }
        catch (error) {
            vscode.window.showErrorMessage('Fehler beim Umschalten des AI Analyzers');
        }
    }
    async sendInitialState() {
        const config = vscode.workspace.getConfiguration('accessibility');
        const currentProvider = config.get('aiProvider', 'local');
        const analyzerEnabled = config.get('aiAnalyzer.enabled', false);
        // Provider-spezifische Konfigurationen
        const localEndpoint = config.get('localLLM.endpoint', 'http://127.0.0.1:1234');
        const localModel = config.get('localLLM.model', 'mistralai/devstral-small-2507');
        const githubModel = config.get('githubCopilot.model', 'gpt-4o');
        const customEndpoint = config.get('customAPI.endpoint', 'https://api.openai.com/v1/chat/completions');
        const customModel = config.get('customAPI.model', 'gpt-4o-mini');
        // API Key aus SecretStorage holen
        const secretStorage = this.llmService.getSecretStorage();
        const hasApiKey = !!(await secretStorage.get('accessibility.customAPI.apiKey'));
        this.sendMessage({
            type: 'initialState',
            provider: currentProvider,
            analyzerEnabled: analyzerEnabled,
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
    async updateConnectionStatus() {
        try {
            const isConnected = await this.llmService.testConnection();
            const status = isConnected ? 'connected' : 'disconnected';
            this.sendMessage({ type: 'connectionStatus', status });
        }
        catch (error) {
            this.sendMessage({ type: 'connectionStatus', status: 'error' });
        }
    }
    sendMessage(message) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }
    _getHtmlForWebview(webview) {
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
                }
                
                .section {
                    margin-bottom: 24px;
                }
                
                h3 {
                    margin: 0 0 12px 0;
                    color: var(--vscode-editor-foreground);
                    font-size: 14px;
                    font-weight: 600;
                }
                
                .provider-option {
                    margin: 8px 0;
                    padding: 8px;
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    cursor: pointer;
                }
                
                .provider-option:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                
                .provider-option input[type="radio"] {
                    margin-right: 8px;
                }
                
                .provider-option label {
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    font-weight: 500;
                }
                
                .config-group {
                    display: none;
                    margin: 8px 0 0 20px;
                    padding: 12px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                }
                
                .config-group.active {
                    display: block;
                }
                
                .config-item {
                    margin-bottom: 12px;
                }
                
                .config-item label {
                    display: block;
                    margin-bottom: 4px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
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
                }
                
                .status {
                    display: flex;
                    align-items: center;
                    margin-bottom: 8px;
                }
                
                .status-icon {
                    margin-right: 8px;
                    font-size: 14px;
                }
                
                .test-button {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    padding: 6px 12px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                }
                
                .analyzer-section {
                    margin-top: 16px;
                    padding: 12px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                }
                
                .analyzer-toggle {
                    display: flex;
                    align-items: center;
                }
                
                .analyzer-toggle input[type="checkbox"] {
                    margin-right: 8px;
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
                }
                
                .security-notice {
                    background: var(--vscode-editorWarning-background);
                    color: var(--vscode-editorWarning-foreground);
                    padding: 6px 8px;
                    border-radius: 3px;
                    font-size: 11px;
                    margin-top: 4px;
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
                    <div class="description">LM Studio, Ollama, oder andere OpenAI-kompatible Servers</div>
                </div>
                
                <div class="provider-option">
                    <input type="radio" id="copilot" name="provider" value="github-copilot">
                    <label for="copilot">GitHub Copilot</label>
                </div>
                
                <div class="config-group" id="github-copilot-config">
                    <div class="config-item">
                        <label for="copilot-model">Model:</label>
                        <select id="copilot-model" onchange="saveModel()">
                            <option value="gpt-4o">GPT-4o</option>
                            <option value="gpt-4.1">GPT-4.1</option>
                            <option value="gpt-4o-mini">GPT-4o Mini</option>
                            <option value="claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                            <option value="claude-3.7-haiku">Claude 3.7 Haiku</option>
                            <option value="claude-4.0">Claude 4.0</option>
                            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                            <option value="o3-mini">O3 Mini</option>
                            <option value="o4-mini">O4 Mini</option>
                            <option value="o1-preview">O1 Preview</option>
                            <option value="o1-mini">O1 Mini</option>
                        </select>
                    </div>
                    <div class="description">Erfordert GitHub Copilot Extension und aktive Lizenz</div>
                </div>
                
                <div class="provider-option">
                    <input type="radio" id="custom" name="provider" value="custom-api">
                    <label for="custom">Custom API</label>
                </div>
                
                <div class="config-group" id="custom-api-config">
                    <div class="config-item">
                        <label for="custom-endpoint">API Endpoint:</label>
                        <input type="text" id="custom-endpoint" placeholder="https://api.openai.com/v1/chat/completions">
                        <button class="save-button" onclick="saveEndpoint()">Save</button>
                    </div>
                    <div class="config-item">
                        <label for="custom-model">Model:</label>
                        <input type="text" id="custom-model" placeholder="gpt-4o-mini">
                        <button class="save-button" onclick="saveModel()">Save</button>
                    </div>
                    <div class="config-item">
                        <label for="custom-apikey">API Key:</label>
                        <input type="password" id="custom-apikey" placeholder="sk-...">
                        <button class="save-button" onclick="saveApiKey()">Save</button>
                        <div class="security-notice" id="apikey-status">🔒 API Key wird sicher in VS Code SecretStorage gespeichert</div>
                    </div>
                    <div class="description">OpenAI, Anthropic, Cohere und andere APIs</div>
                </div>
            </div>
            
            <div class="status-section">
                <div class="status">
                    <span class="status-icon" id="status-icon">🟡</span>
                    <span class="status-text" id="status-text">Initialisierung...</span>
                </div>
                <button class="test-button" onclick="testConnection()">Test Connection</button>
            </div>
            
            <div class="analyzer-section">
                <h3>AI Semantic Analyzer</h3>
                <div class="analyzer-toggle">
                    <input type="checkbox" id="ai-analyzer">
                    <label for="ai-analyzer">Enable AI Semantic Analysis</label>
                </div>
                <div class="description">Erkennt semantische WCAG-Verstöße, die axe-core übersieht</div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                // DOM Elements
                const localEndpoint = document.getElementById('local-endpoint');
                const localModel = document.getElementById('local-model');
                const copilotModel = document.getElementById('copilot-model');
                const customEndpoint = document.getElementById('custom-endpoint');
                const customModel = document.getElementById('custom-model');
                const customApiKey = document.getElementById('custom-apikey');
                const analyzerCheckbox = document.getElementById('ai-analyzer');
                
                // Provider Change Handler
                document.querySelectorAll('input[name="provider"]').forEach(radio => {
                    radio.addEventListener('change', function() {
                        updateConfigVisibility(this.value);
                        vscode.postMessage({
                            type: 'providerChanged',
                            provider: this.value
                        });
                    });
                });
                
                // Analyzer Toggle
                analyzerCheckbox.addEventListener('change', (e) => {
                    vscode.postMessage({
                        type: 'analyzerToggled',
                        enabled: e.target.checked
                    });
                });
                
                // Global functions for save buttons
                window.saveEndpoint = function() {
                    const activeProvider = document.querySelector('input[name="provider"]:checked').value;
                    let endpoint = '';
                    
                    if (activeProvider === 'local') {
                        endpoint = localEndpoint.value;
                    } else if (activeProvider === 'custom-api') {
                        endpoint = customEndpoint.value;
                    }
                    
                    vscode.postMessage({
                        type: 'saveEndpoint',
                        endpoint: endpoint
                    });
                };
                
                window.saveModel = function() {
                    const activeProvider = document.querySelector('input[name="provider"]:checked').value;
                    let model = '';
                    
                    if (activeProvider === 'local') {
                        model = localModel.value;
                    } else if (activeProvider === 'github-copilot') {
                        model = copilotModel.value;
                    } else if (activeProvider === 'custom-api') {
                        model = customModel.value;
                    }
                    
                    vscode.postMessage({
                        type: 'saveModel',
                        model: model
                    });
                };
                
                window.saveApiKey = function() {
                    const apiKey = customApiKey.value;
                    if (apiKey.trim()) {
                        vscode.postMessage({
                            type: 'saveApiKey',
                            apiKey: apiKey
                        });
                        customApiKey.value = ''; // Clear input for security
                    }
                };
                
                window.testConnection = function() {
                    vscode.postMessage({ type: 'testConnection' });
                };
                
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
                    
                    // Load available models for GitHub Copilot
                    if (provider === 'github-copilot') {
                        vscode.postMessage({ type: 'getAvailableModels' });
                    }
                }
                
                // Message Handler
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.type) {
                        case 'initialState':
                            // Provider auswählen
                            const providerRadio = document.getElementById(message.provider);
                            if (providerRadio) {
                                providerRadio.checked = true;
                                updateConfigVisibility(message.provider);
                            }
                            
                            // Konfiguration laden
                            if (message.config) {
                                localEndpoint.value = message.config.local.endpoint;
                                localModel.value = message.config.local.model;
                                copilotModel.value = message.config.githubCopilot.model;
                                customEndpoint.value = message.config.customAPI.endpoint;
                                customModel.value = message.config.customAPI.model;
                                
                                // API Key Status
                                const apiKeyStatus = document.getElementById('apikey-status');
                                if (message.config.customAPI.hasApiKey) {
                                    apiKeyStatus.textContent = '🔒 API Key ist konfiguriert';
                                    apiKeyStatus.style.background = 'var(--vscode-editorInfo-background)';
                                } else {
                                    apiKeyStatus.textContent = '⚠️ Kein API Key konfiguriert';
                                    apiKeyStatus.style.background = 'var(--vscode-editorWarning-background)';
                                }
                            }
                            
                            // Analyzer Checkbox setzen
                            analyzerCheckbox.checked = message.analyzerEnabled;
                            break;
                            
                        case 'connectionStatus':
                            updateConnectionStatus(message.status);
                            break;
                    }
                });
                
                function updateConnectionStatus(status) {
                    const statusIcon = document.getElementById('status-icon');
                    const statusText = document.getElementById('status-text');
                    
                    switch (status) {
                        case 'connected':
                            statusIcon.textContent = '🟢';
                            statusText.textContent = 'Verbunden';
                            statusText.className = 'connected';
                            break;
                        case 'disconnected':
                            statusIcon.textContent = '🔴';
                            statusText.textContent = 'Nicht verbunden';
                            statusText.className = 'disconnected';
                            break;
                        case 'testing':
                            statusIcon.textContent = '🟡';
                            statusText.textContent = 'Teste Verbindung...';
                            statusText.className = 'testing';
                            break;
                        case 'error':
                            statusIcon.textContent = '🔴';
                            statusText.textContent = 'Verbindungsfehler';
                            statusText.className = 'error';
                            break;
                    }
                }
                
                // Request initial state
                vscode.postMessage({ type: 'getInitialState' });
            </script>
        </body>
        </html>`;
    }
}
exports.LLMSettingsProvider = LLMSettingsProvider;
LLMSettingsProvider.viewType = 'aiAccessibilitySettings';
//# sourceMappingURL=llm-settings-provider-new.js.map