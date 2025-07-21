import * as vscode from 'vscode';
import { MetricsService} from '../metrics/metrics-service';

export interface LLMProvider {
    name: string;
    isConfigured(): Promise<boolean>;
    testConnection(): Promise<boolean>;
    getAccessibilityFix(prompt: string): Promise<string>;
    getAvailableModels?(): Promise<string[]>;
}

export class LLMService {
    private providers: Map<string, LLMProvider> = new Map();
    private secretStorage: vscode.SecretStorage;
    private metricsService?: MetricsService;
    
    constructor(secretStorage: vscode.SecretStorage) {
        this.secretStorage = secretStorage;
        this.initializeProviders();
    }

    public setMetricsService(metricsService: MetricsService): void {
        this.metricsService = metricsService;
    }
    
    private initializeProviders(): void {
        this.providers.set('local', new LocalLLMProvider());
        this.providers.set('github-copilot', new GitHubCopilotProvider());
        this.providers.set('custom-api', new CustomAPIProvider(this.secretStorage));
    }
    
    public async getCurrentProvider(): Promise<LLMProvider> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const providerName = config.get<string>('aiProvider', 'local');
        const provider = this.providers.get(providerName);
        
        if (!provider) {
            throw new Error(`Unknown provider: ${providerName}`);
        }
        
        return provider;
    }
    
    public async getAccessibilityFix(prompt: string): Promise<{ result: string; quickFixId: string }> {
        const startTime = Date.now();
        const provider = await this.getCurrentProvider();
        
        if (!(await provider.isConfigured())) {
            throw new Error(`${provider.name} is not properly configured. Please check your settings.`);
        }

        try {
            const result = await provider.getAccessibilityFix(prompt);
            const responseTime = Date.now() - startTime;
            
            // Record metrics if service is available
            let quickFixId = '';
            if (this.metricsService) {
                quickFixId = this.metricsService.recordQuickFixAttempt();
            }
            
            return { result, quickFixId };
        } catch (error) {
            // Record failed attempt
            if (this.metricsService) {
                // Just record attempt, no complex tracking needed
            }
            throw error;
        }
    }

    // Separate method for AI analysis that doesn't count as QuickFix attempt
    public async getAIAnalysis(prompt: string): Promise<string> {
        const provider = await this.getCurrentProvider();
        
        if (!(await provider.isConfigured())) {
            throw new Error(`${provider.name} is not properly configured. Please check your settings.`);
        }

        try {
            const result = await provider.getAccessibilityFix(prompt);
            return result;
        } catch (error) {
            throw error;
        }
    }

    public async testConnection(): Promise<boolean> {
        try {
            const provider = await this.getCurrentProvider();
            return await provider.testConnection();
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }
    
    public getAvailableProviders(): string[] {
        return Array.from(this.providers.keys());
    }

    public async getAvailableModels(): Promise<string[]> {
        try {
            const provider = await this.getCurrentProvider();
            if (provider.getAvailableModels) {
                return await provider.getAvailableModels();
            }
            return [];
        } catch (error) {
            console.error('Failed to get available models:', error);
            return [];
        }
    }

    public getSecretStorage(): vscode.SecretStorage {
        return this.secretStorage;
    }
}

class LocalLLMProvider implements LLMProvider {
    name = 'Local LLM';
    
    async isConfigured(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const endpoint = config.get<string>('localLLM.endpoint', '');
        const model = config.get<string>('localLLM.model', '');
        return !!endpoint && !!model;
    }
    
    async testConnection(): Promise<boolean> {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const endpoint = config.get<string>('localLLM.endpoint', '') + '/v1/models';
            
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async getAccessibilityFix(prompt: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const endpoint = config.get<string>('localLLM.endpoint', '') + '/v1/chat/completions';
        const model = config.get<string>('localLLM.model', '');
        
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: "You are an accessibility expert. Fix HTML code to be WCAG compliant. Return ONLY the corrected HTML code without any explanations, markdown formatting, or additional text. Examples: <img src='test.jpg'> becomes <img src='test.jpg' alt='description'>, <button></button> becomes <button aria-label='button name'>text</button>"
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 512
                })
            });

            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
            }
            
            let data;
            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }
            
            const extractedText = this.extractTextFromResponse(data);
            
            if (!extractedText) {
                throw new Error('No valid text content found in LLM response');
            }
            
            return this.extractCodeFromText(extractedText);
        } catch (error) {
            throw new Error(`Local LLM request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    
    private extractTextFromResponse(data: any): string | undefined {
        if (typeof data === 'string') {
            return data;
        }
        
        if (!data) {
            return undefined;
        }
        
        // Gängige API-Felder prüfen
        const possibleFields = [
            'text', 'content', 'answer', 'response', 'result', 'output', 'completion', 'generated_text'
        ];
        
        for (const field of possibleFields) {
            if (data[field] && typeof data[field] === 'string') {
                return data[field];
            }
        }
        
        // Verschachtelte Strukturen prüfen
        if (data.message) {
            if (typeof data.message === 'string') {
                return data.message;
            } else if (data.message.content) {
                return data.message.content;
            }
        }
        
        // OpenAI-Format prüfen
        if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
            const choice = data.choices[0];
            
            if (choice.text) return choice.text;
            if (choice.content) return choice.content;
            if (choice.message?.content) return choice.message.content;
            if (choice.delta?.content) return choice.delta.content;
        }
        
        // Fallback: Alle String-Properties durchsuchen
        for (const key in data) {
            if (typeof data[key] === 'string' && data[key].trim().length > 0) {
                return data[key];
            }
        }
        
        return undefined;
    }
    
    private extractCodeFromText(text: string): string {
        // HTML-Code zwischen ```html und ``` extrahieren
        const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/;
        const htmlMatch = text.match(htmlCodeBlockRegex);
        
        if (htmlMatch && htmlMatch[1]) {
            return htmlMatch[1].trim();
        }
        
        // Generischen Code zwischen ``` und ``` extrahieren
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        const genericMatch = text.match(codeBlockRegex);
        
        if (genericMatch && genericMatch[1]) {
            return genericMatch[1].trim();
        }
        
        // Prüfen, ob der Text selbst gültiges HTML ist
        if (text.includes('<') && text.includes('>')) {
            // Vereinfachte Validierung für HTML-Tags
            const htmlTagRegex = /<[^>]+>[\s\S]*<\/[^>]+>/;
            const tagMatch = text.match(htmlTagRegex);
            
            if (tagMatch) {
                return text.trim();
            }
        }
        
        // Saubere Fallback-Lösung
        return text.trim();
    }
}

class CustomAPIProvider implements LLMProvider {
    name = 'Custom API';
    
    constructor(private secretStorage: vscode.SecretStorage) {}
    
    async isConfigured(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const endpoint = config.get<string>('customAPI.endpoint', '');
        const apiKey = await this.secretStorage.get('accessibility.customAPI.apiKey');
        return !!endpoint && !!apiKey;
    }
    
    async testConnection(): Promise<boolean> {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const endpoint = config.get<string>('customAPI.endpoint', '');
            const apiKey = await this.secretStorage.get('accessibility.customAPI.apiKey');
            
            if (!apiKey || !endpoint) {
                return false;
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    model: config.get<string>('customAPI.model', 'gpt-4o-mini'),
                    messages: [{ role: 'user', content: 'test' }],
                    max_tokens: 5
                })
            });
            
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async getAccessibilityFix(prompt: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('accessibility');
        const apiKey = await this.secretStorage.get('accessibility.customAPI.apiKey');
        const endpoint = config.get<string>('customAPI.endpoint', '');
        const model = config.get<string>('customAPI.model', 'gpt-4o-mini');
        const customHeaders = config.get<object>('customAPI.headers', {});
        
        if (!apiKey) {
            throw new Error('API key not configured. Please set it in the AI Accessibility settings.');
        }

        try {
            const headers = {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                ...customHeaders
            };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ 
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: "You are an accessibility expert. Fix HTML code to be WCAG compliant. Return ONLY the corrected HTML code without any explanations, markdown formatting, or additional text."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 512
                })
            });

            if (!response.ok) {
                throw new Error(`Custom API responded with ${response.status}: ${await response.text()}`);
            }
            
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;
            
            if (!content) {
                throw new Error('No content found in Custom API response');
            }
            
            return this.extractCodeFromText(content);
        } catch (error) {
            throw new Error(`Custom API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async setApiKey(apiKey: string): Promise<void> {
        await this.secretStorage.store('accessibility.customAPI.apiKey', apiKey);
    }

    async getApiKey(): Promise<string | undefined> {
        return await this.secretStorage.get('accessibility.customAPI.apiKey');
    }
    
    private extractCodeFromText(text: string): string {
        const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/;
        const htmlMatch = text.match(htmlCodeBlockRegex);
        
        if (htmlMatch && htmlMatch[1]) {
            return htmlMatch[1].trim();
        }
        
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        const genericMatch = text.match(codeBlockRegex);
        
        if (genericMatch && genericMatch[1]) {
            return genericMatch[1].trim();
        }
        
        if (text.includes('<') && text.includes('>')) {
            return text.trim();
        }
        
        return text.trim();
    }
}

class GitHubCopilotProvider implements LLMProvider {
    name = 'GitHub Copilot';
    
    async isConfigured(): Promise<boolean> {
        // GitHub Copilot wird durch die Extension verwaltet
        return vscode.extensions.getExtension('GitHub.copilot') !== undefined;
    }
    
    async testConnection(): Promise<boolean> {
        try {
            // Versuche verfügbare Modelle abzurufen
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            return models.length > 0;
        } catch (error) {
            return false;
        }
    }

    async getAvailableModels(): Promise<string[]> {
        try {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const availableModels = models.map(model => model.family || model.id || 'unknown');
            
            // Erweiterte Modellliste mit gefilterten verfügbaren Modellen
            const targetModels = [
                'gpt-4o',
                'gpt-4.1', 
                'gpt-4o-mini',
                'claude-3.5-sonnet',
                'claude-3.7-haiku', 
                'claude-4.0',
                'gemini-2.0-flash',
                'gemini-2.5-pro',
                'o3-mini',
                'o4-mini',
                'o1-preview',
                'o1-mini'
            ];
            
            // Nur verfügbare Modelle zurückgeben, fallback auf alle verfügbaren
            const intersection = targetModels.filter(model => 
                availableModels.some(available => 
                    available.toLowerCase().includes(model.toLowerCase()) ||
                    model.toLowerCase().includes(available.toLowerCase())
                )
            );
            
            return intersection.length > 0 ? intersection : availableModels;
        } catch (error) {
            // Fallback: Standard-Modelle zurückgeben
            return [
                'gpt-4o', 
                'gpt-4o-mini', 
                'claude-3.5-sonnet',
                'claude-3.7-haiku',
                'gemini-2.0-flash',
                'o3-mini',
                'o1-preview',
                'o1-mini'
            ];
        }
    }

    async getAccessibilityFix(prompt: string): Promise<string> {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const selectedModel = config.get<string>('githubCopilot.model', 'gpt-4o');
            
            // Versuche erst spezifisches Modell zu finden
            let models: vscode.LanguageModelChat[] = [];
            
            // Erweiterte Modell-Query mit verschiedenen Selektoren
            const selectors = [
                { vendor: 'copilot', family: selectedModel },
                { vendor: 'copilot', id: selectedModel },
                { vendor: 'copilot', family: selectedModel.replace('-', '') },
                { vendor: 'copilot' } // Fallback: alle verfügbaren Modelle
            ];
            
            for (const selector of selectors) {
                try {
                    models = await vscode.lm.selectChatModels(selector);
                    if (models.length > 0) break;
                } catch (error) {
                    // Weiter zum nächsten Selektor
                    continue;
                }
            }

            if (models.length === 0) {
                throw new Error('No GitHub Copilot models available. Please ensure you are signed in to GitHub Copilot and have access to the Language Model API.');
            }

            const model = models[0];
            
            const messages = [
                vscode.LanguageModelChatMessage.User(
                    "You are an accessibility expert. Fix HTML code to be WCAG compliant. Return ONLY the corrected HTML code without any explanations, markdown formatting, or additional text. " + prompt
                )
            ];

            const response = await model.sendRequest(messages, {
                justification: 'Fixing HTML code for accessibility compliance according to WCAG standards'
            });

            let result = '';
            for await (const fragment of response.text) {
                result += fragment;
            }

            return this.extractCodeFromText(result.trim());
        } catch (error) {
            if (error instanceof vscode.LanguageModelError) {
                throw new Error(`GitHub Copilot request failed: ${error.message} (Code: ${error.code})`);
            }
            throw new Error(`GitHub Copilot request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    
    private extractCodeFromText(text: string): string {
        // HTML-Code zwischen ```html und ``` extrahieren
        const htmlCodeBlockRegex = /```html\s*([\s\S]*?)\s*```/;
        const htmlMatch = text.match(htmlCodeBlockRegex);
        
        if (htmlMatch && htmlMatch[1]) {
            return htmlMatch[1].trim();
        }
        
        // Generischen Code zwischen ``` und ``` extrahieren
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        const genericMatch = text.match(codeBlockRegex);
        
        if (genericMatch && genericMatch[1]) {
            return genericMatch[1].trim();
        }
        
        // Prüfen, ob der Text selbst gültiges HTML ist
        if (text.includes('<') && text.includes('>')) {
            return text.trim();
        }
        
        return text.trim();
    }
}
