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
exports.LLMService = void 0;
const vscode = __importStar(require("vscode"));
class LLMService {
    constructor(secretStorage) {
        this.providers = new Map();
        // Sehr einfacher In-Memory Cache (Prompt -> Result)
        this.cache = new Map();
        this.CACHE_TTL_MS = 1000 * 60 * 2; // 2 Minuten sinnvoll ohne Overengineering
        this.secretStorage = secretStorage;
        this.initializeProviders();
    }
    setMetricsService(metricsService) {
        this.metricsService = metricsService;
    }
    initializeProviders() {
        this.providers.set('local', new LocalLLMProvider());
        this.providers.set('github-copilot', new GitHubCopilotProvider());
        this.providers.set('custom-api', new CustomAPIProvider(this.secretStorage));
    }
    async getCurrentProvider() {
        const config = vscode.workspace.getConfiguration('accessibility');
        const providerName = config.get('aiProvider', 'local');
        const provider = this.providers.get(providerName);
        if (!provider) {
            throw new Error(`Unknown provider: ${providerName}`);
        }
        return provider;
    }
    async getAccessibilityFix(prompt) {
        const provider = await this.getCurrentProvider();
        if (!(await provider.isConfigured())) {
            throw new Error(`${provider.name} is not properly configured. Please check your settings.`);
        }
        // Cache Check (nur wenn Prompt nicht leer)
        const cacheKey = 'fix:' + prompt;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            // Trotzdem QuickFix Attempt für Konsistenz der Metriken registrieren
            let quickFixId = '';
            if (this.metricsService)
                quickFixId = this.metricsService.recordQuickFixAttempt();
            return { result: cached, quickFixId };
        }
        // Record attempt and get tracking ID
        let quickFixId = '';
        if (this.metricsService) {
            quickFixId = this.metricsService.recordQuickFixAttempt();
        }
        try {
            const result = await provider.getAccessibilityFix(prompt);
            this.storeInCache(cacheKey, result);
            return { result, quickFixId };
        }
        catch (error) {
            console.error(`LLM Provider ${provider.name} failed:`, error);
            // Try fallback strategies
            const fallbackResult = await this.tryFallbackStrategies(prompt, provider.name);
            if (fallbackResult) {
                this.storeInCache(cacheKey, fallbackResult);
                return { result: fallbackResult, quickFixId };
            }
            throw error;
        }
    }
    // Separate method for AI analysis 
    async getAIAnalysis(prompt) {
        const provider = await this.getCurrentProvider();
        if (!(await provider.isConfigured())) {
            throw new Error(`${provider.name} is not properly configured. Please check your settings.`);
        }
        const cacheKey = 'analysis:' + prompt;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }
        try {
            const result = await provider.getAccessibilityFix(prompt);
            this.storeInCache(cacheKey, result);
            return result;
        }
        catch (error) {
            console.error(`AI Analysis failed with ${provider.name}:`, error);
            // Try fallback for analysis
            const fallbackResult = await this.tryFallbackStrategies(prompt, provider.name);
            if (fallbackResult) {
                this.storeInCache(cacheKey, fallbackResult);
                return fallbackResult;
            }
            throw error;
        }
    }
    // --- Einfache Cache Helfer ---
    getFromCache(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        if (Date.now() - entry.ts > this.CACHE_TTL_MS) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }
    storeInCache(key, value) {
        this.cache.set(key, { value, ts: Date.now() });
        // Kleines LRU-Pruning (hart begrenzt auf 50 Einträge)
        if (this.cache.size > 50) {
            const oldestKey = [...this.cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0][0];
            this.cache.delete(oldestKey);
        }
    }
    /**
     * Tries fallback strategies when primary provider fails
     */
    async tryFallbackStrategies(prompt, failedProvider) {
        const availableProviders = this.getAvailableProviders().filter(p => p !== failedProvider);
        for (const providerName of availableProviders) {
            try {
                console.log(`Trying fallback provider: ${providerName}`);
                const fallbackProvider = this.providers.get(providerName);
                if (fallbackProvider && await fallbackProvider.isConfigured()) {
                    const result = await fallbackProvider.getAccessibilityFix(prompt);
                    console.log(`Fallback successful with ${providerName}`);
                    return result;
                }
            }
            catch (fallbackError) {
                console.warn(`Fallback provider ${providerName} also failed:`, fallbackError);
                continue;
            }
        }
        // If all providers fail, try basic rule-based fallback
        return this.generateBasicFallback(prompt);
    }
    /**
     * Generates a basic rule-based fix when all LLM providers fail
     */
    generateBasicFallback(prompt) {
        const basicRules = {
            'missing alt': 'Add alt attribute: alt="Descriptive text"',
            'missing label': 'Add label: <label for="id">Label text</label>',
            'div role="button"': 'Use semantic button: <button>Button text</button>',
            'color contrast': 'Increase color contrast to meet WCAG AA standards',
            'heading hierarchy': 'Use proper heading hierarchy (h1→h2→h3)',
            'missing aria-label': 'Add aria-label="Descriptive text"'
        };
        const lowerPrompt = prompt.toLowerCase();
        for (const [pattern, fix] of Object.entries(basicRules)) {
            if (lowerPrompt.includes(pattern)) {
                console.log(`Using basic rule-based fallback for: ${pattern}`);
                return fix;
            }
        }
        return null;
    }
    async testConnection() {
        try {
            const provider = await this.getCurrentProvider();
            return await provider.testConnection();
        }
        catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }
    getAvailableProviders() {
        return Array.from(this.providers.keys());
    }
    async getAvailableModels() {
        try {
            const provider = await this.getCurrentProvider();
            if (provider.getAvailableModels) {
                return await provider.getAvailableModels();
            }
            return [];
        }
        catch (error) {
            console.error('Failed to get available models:', error);
            return [];
        }
    }
    getSecretStorage() {
        return this.secretStorage;
    }
}
exports.LLMService = LLMService;
class LocalLLMProvider {
    constructor() {
        this.name = 'Local LLM';
    }
    async isConfigured() {
        const config = vscode.workspace.getConfiguration('accessibility');
        const endpoint = config.get('localLLM.endpoint', '');
        const model = config.get('localLLM.model', '');
        return !!endpoint && !!model;
    }
    async testConnection() {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const endpoint = config.get('localLLM.endpoint', '') + '/v1/models';
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            return response.ok;
        }
        catch (error) {
            return false;
        }
    }
    async getAccessibilityFix(prompt) {
        const config = vscode.workspace.getConfiguration('accessibility');
        const endpoint = config.get('localLLM.endpoint', '') + '/v1/chat/completions';
        const model = config.get('localLLM.model', '');
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert WCAG 2.2 AA accessibility consultant. When fixing code:\n\n1. ONLY return the corrected line of code, no explanations or markdown\n2. Maintain all existing styling, classes, and IDs\n3. Preserve functionality while adding accessibility\n4. Use semantic HTML5 elements when appropriate\n5. Add proper ARIA attributes only when necessary\n6. Ensure keyboard navigation works\n7. Include proper labels and descriptions\n\nExamples:\n- Input: <div onclick='submit()'>Submit</div>\n- Output: <button onclick='submit()'>Submit</button>\n\n- Input: <img src='chart.jpg'>\n- Output: <img src='chart.jpg' alt='Monthly sales chart showing 20% growth'>\n\n- Input: <input type='email' placeholder='Email'>\n- Output: <input type='email' id='email' placeholder='Email' aria-label='Email address'>"
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
            }
            else {
                data = await response.text();
            }
            const extractedText = this.extractTextFromResponse(data);
            if (!extractedText) {
                throw new Error('No valid text content found in LLM response');
            }
            return this.extractCodeFromText(extractedText);
        }
        catch (error) {
            throw new Error(`Local LLM request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    extractTextFromResponse(data) {
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
            const value = data[field];
            if (value && typeof value === 'string') {
                return value;
            }
        }
        // Verschachtelte Strukturen prüfen
        if (data.message) {
            if (typeof data.message === 'string') {
                return data.message;
            }
            else if (data.message.content) {
                return data.message.content;
            }
        }
        // OpenAI-Format prüfen
        if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
            const choice = data.choices[0];
            if (choice.text)
                return choice.text;
            if (choice.content)
                return choice.content;
            if (choice.message?.content)
                return choice.message.content;
            if (choice.delta?.content)
                return choice.delta.content;
        }
        // Fallback: Alle String-Properties durchsuchen
        for (const key in data) {
            if (typeof data[key] === 'string' && data[key].trim().length > 0) {
                return data[key];
            }
        }
        return undefined;
    }
    extractCodeFromText(text) {
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
        return text.trim();
    }
}
class CustomAPIProvider {
    constructor(secretStorage) {
        this.secretStorage = secretStorage;
        // Umbenannt für UI Anzeige
        this.name = 'OpenRouter';
    }
    async isConfigured() {
        // Für OpenRouter reicht der API Key; Endpoint ist fest
        const apiKey = await this.secretStorage.get('accessibility.customAPI.apiKey');
        return !!apiKey;
    }
    async testConnection() {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const apiKey = await this.secretStorage.get('accessibility.customAPI.apiKey');
            const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
            if (!apiKey)
                return false;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    // Empfohlene zusätzliche Header für OpenRouter Ranking / Policy
                    'HTTP-Referer': 'https://github.com/NotAisu/Accessibility_Extension',
                    'X-Title': 'Accessibility Extension'
                },
                body: JSON.stringify({
                    model: config.get('customAPI.model', 'qwen/qwen3-coder:free'),
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 5
                })
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    async getAccessibilityFix(prompt) {
        const config = vscode.workspace.getConfiguration('accessibility');
        const apiKey = await this.secretStorage.get('accessibility.customAPI.apiKey');
        // Fester Endpoint für OpenRouter
        const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        const model = config.get('customAPI.model', 'qwen/qwen3-coder:free');
        if (!apiKey) {
            throw new Error('API key not configured. Please set it in the AI Accessibility settings.');
        }
        try {
            const headers = {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/NotAisu/Accessibility_Extension',
                'X-Title': 'Accessibility Extension'
            };
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: "system",
                            content: "You are an accessibility expert. Fix Frontend code to be WCAG compliant. Return ONLY the corrected HTML code without any explanations, markdown formatting, or additional text."
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
                throw new Error(`OpenRouter responded with ${response.status}: ${await response.text()}`);
            }
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error('No content found in OpenRouter response');
            }
            return this.extractCodeFromText(content);
        }
        catch (error) {
            throw new Error(`OpenRouter request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async setApiKey(apiKey) {
        await this.secretStorage.store('accessibility.customAPI.apiKey', apiKey);
    }
    async getApiKey() {
        return await this.secretStorage.get('accessibility.customAPI.apiKey');
    }
    extractCodeFromText(text) {
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
class GitHubCopilotProvider {
    constructor() {
        this.name = 'GitHub Copilot';
    }
    async isConfigured() {
        // GitHub Copilot wird durch die Extension verwaltet
        return vscode.extensions.getExtension('GitHub.copilot') !== undefined;
    }
    async testConnection() {
        try {
            // Versuche verfügbare Modelle abzurufen
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            return models.length > 0;
        }
        catch (error) {
            return false;
        }
    }
    async getAvailableModels() {
        try {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const availableModels = models.map(model => model.family || model.id || 'unknown');
            // Erweiterte Modellliste mit gefilterten verfügbaren Modellen
            const targetModels = [
                'gpt-4.1',
                'gpt-4o',
                'claude-3.5-sonnet',
                'claude-3.7-sonnet',
                'claude-3.7-sonnet-thinking',
                'claude-4-sonnet',
                'gemini-2.0-flash',
                'gemini-2.5-pro',
                'o3-mini',
                'o4-mini'
            ];
            // Nur verfügbare Modelle zurückgeben, fallback auf alle verfügbaren
            const intersection = targetModels.filter(model => availableModels.some(available => available.toLowerCase().includes(model.toLowerCase()) ||
                model.toLowerCase().includes(available.toLowerCase())));
            return intersection.length > 0 ? intersection : availableModels;
        }
        catch (error) {
            // Fallback: Standard-Modelle zurückgeben
            return [
                'gpt-4o',
                'gpt-4.1',
                'claude-3.5-sonnet',
                'claude-3.7-sonnet',
                'gemini-2.0-flash',
                'o3-mini',
            ];
        }
    }
    async getAccessibilityFix(prompt) {
        try {
            const config = vscode.workspace.getConfiguration('accessibility');
            const selectedModel = config.get('githubCopilot.model', 'gpt-4o');
            // Versuche erst spezifisches Modell zu finden
            let models = [];
            // Erweiterte Modell-Query mit verschiedenen Selektoren
            const selectors = [
                { vendor: 'copilot', family: selectedModel },
                { vendor: 'copilot', id: selectedModel },
                { vendor: 'copilot', family: selectedModel.replace('-', '') },
                { vendor: 'copilot' }
            ];
            for (const selector of selectors) {
                try {
                    models = await vscode.lm.selectChatModels(selector);
                    if (models.length > 0)
                        break;
                }
                catch (error) {
                    continue;
                }
            }
            if (models.length === 0) {
                throw new Error('No GitHub Copilot models available. Please ensure you are signed in to GitHub Copilot and have access to the Language Model API.');
            }
            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User("You are an accessibility expert. Fix HTML code to be WCAG compliant. Return ONLY the corrected HTML code without any explanations, markdown formatting, or additional text. " + prompt)
            ];
            const response = await model.sendRequest(messages, {
                justification: 'Fixing HTML code for accessibility compliance according to WCAG standards'
            });
            let result = '';
            for await (const fragment of response.text) {
                result += fragment;
            }
            return this.extractCodeFromText(result.trim());
        }
        catch (error) {
            if (error instanceof vscode.LanguageModelError) {
                throw new Error(`GitHub Copilot request failed: ${error.message} (Code: ${error.code})`);
            }
            throw new Error(`GitHub Copilot request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    extractCodeFromText(text) {
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
//# sourceMappingURL=llm-service.js.map