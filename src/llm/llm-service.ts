import * as vscode from 'vscode';

export class LLMService {
    private readonly apiEndpoint: string = 'http://127.0.0.1:1234/v1/chat/completions';
    private readonly model: string = 'deepseek/deepseek-r1-0528-qwen3-8b';

    public async getAccessibilityFix(prompt: string): Promise<string> {
        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: this.model,
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
            throw new Error(`LLM request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
