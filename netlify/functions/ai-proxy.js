async function callRealAI(message) {
    showStatus('AI is processing your request...', 'success');
    
    try {
        const provider = apiConfig.provider || 'gemini';
        const providerConfig = AI_PROVIDERS[provider];
        
        let apiKey = null;
        if (apiConfig.apiKey) {
            apiKey = decryptApiKey(apiConfig.apiKey);
            if (!apiKey && !providerConfig.free) {
                throw new Error('Failed to decrypt API key');
            }
        }
        
        incrementUsage();
        
        // Use Netlify Functions proxy
        const response = await fetch('/.netlify/functions/ai-proxy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                provider: provider,
                apiKey: apiKey,
                message: message,
                files: files,
                currentFile: currentFile
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Proxy error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        const aiResponse = extractResponseText(data, provider);
        
        addMessage('ai', aiResponse);
        
        // Extract and apply code (same as before)
        const codeBlocks = aiResponse.match(/```(?:html|css|javascript|js)?\n?([\s\S]*?)```/gi);
        if (codeBlocks) {
            codeBlocks.forEach((block, index) => {
                const code = block.replace(/```(?:html|css|javascript|js)?\n?/, '').replace(/```$/, '');
                
                let filename;
                if (aiResponse.toLowerCase().includes('index.html') || currentFile === 'index.html') {
                    filename = 'index.html';
                } else {
                    filename = prompt(`What filename should I save code block ${index + 1} as?`, 'generated-code.html') || `generated-${index + 1}.html`;
                }
                
                updateCode(code, filename);
                if (!files[filename]) {
                    addFileTab(filename);
                }
                switchToFile(filename);
            });
        }
        
        showStatus(`${providerConfig.name} response generated!`, 'success');
        
    } catch (error) {
        addMessage('ai', `Sorry, I encountered an error: ${error.message}`);
        showStatus('AI API error', 'error');
    }
}
