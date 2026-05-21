const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Call the Gemini Text API to enhance a raw prompt based on a visual style preset.
 * @param {string} apiKey 
 * @param {string} rawPrompt 
 * @param {string} stylePreset 
 * @returns {Promise<string>} Enhanced prompt
 */
export async function enhancePromptAPI(apiKey, rawPrompt, stylePreset) {
    if (!apiKey) throw new Error('API Key is required to enhance prompt.');

    const model = 'gemini-2.5-flash';
    const url = `${BASE_URL}/${model}:generateContent?key=${apiKey}`;

    const systemInstruction = `You are a professional AI image generation prompt engineer.
Your task is to take a simple raw prompt and expand it into a detailed, descriptive, and visually stunning prompt optimized for Google's image generation models (Nano Banana).

Apply the visual style preset: "${stylePreset}".

In your enhancement, describe:
1. The subject matter, layout, and composition.
2. The mood, atmosphere, and color palette matching the style.
3. Specific lighting instructions (e.g. dramatic shadows, neon glows, volumetric light).
4. Artistic mediums, textures, and rendering styles.

CRITICAL RULES:
- Output ONLY the final enhanced prompt.
- Do NOT include any intro (like "Here is your prompt:") or outro.
- Do NOT wrap in quotes or code blocks.
- Keep the length between 60 to 120 words.`;

    const requestBody = {
        contents: [
            {
                role: 'user',
                parts: [{ text: `Raw prompt: "${rawPrompt}"` }]
            }
        ],
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 250
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || 'API request failed');
        }

        const data = await response.json();
        const enhancedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!enhancedText) {
            throw new Error('No enhancement output returned from Gemini');
        }

        return enhancedText.trim();
    } catch (error) {
        console.error('Error enhancing prompt:', error);
        throw error;
    }
}

/**
 * Call the Gemini Image API to generate an image.
 * @param {string} apiKey 
 * @param {string} modelName 
 * @param {string} prompt 
 * @param {string} aspectRatio 
 * @returns {Promise<string>} Base64 image data URL (PNG)
 */
export async function generateImageAPI(apiKey, modelName, prompt, aspectRatio) {
    if (!apiKey) throw new Error('API Key is required to generate images.');

    const url = `${BASE_URL}/${modelName}:generateContent?key=${apiKey}`;

    // Append aspect ratio description to prompt if not already present
    let formattedPrompt = prompt;
    if (aspectRatio === '16:9') {
        formattedPrompt += ', widescreen composition, 16:9 aspect ratio';
    } else if (aspectRatio === '9:16') {
        formattedPrompt += ', portrait composition, tall orientation, 9:16 aspect ratio';
    } else {
        formattedPrompt += ', square composition, 1:1 aspect ratio';
    }

    const requestBody = {
        contents: [
            {
                role: 'user',
                parts: [{ text: formattedPrompt }]
            }
        ],
        generationConfig: {
            responseModalities: ["IMAGE"]
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || 'Image generation failed');
        }

        const data = await response.json();
        
        // Traverse response candidates for inlineData parts
        let imagePart = null;
        const candidates = data.candidates || [];
        for (const candidate of candidates) {
            const parts = candidate.content?.parts || [];
            for (const part of parts) {
                if (part.inlineData) {
                    imagePart = part.inlineData;
                    break;
                }
            }
            if (imagePart) break;
        }

        if (!imagePart) {
            // Check if there is text instead (some error message from the model, safety blocks etc.)
            const textPart = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textPart) {
                throw new Error(`Model response: ${textPart}`);
            }
            throw new Error('No image was returned. It is possible the prompt was flagged by safety filters.');
        }

        const mimeType = imagePart.mimeType || 'image/png';
        const base64Data = imagePart.data;

        return `data:${mimeType};base64,${base64Data}`;
    } catch (error) {
        console.error('Error generating image:', error);
        throw error;
    }
}

/**
 * Call the Hugging Face Inference API to generate an image.
 * Supports polling for cold starts (HTTP 503).
 * @param {string} token - Hugging Face API token
 * @param {string} modelId - Hugging Face model repository ID
 * @param {string} prompt - Image prompt
 * @param {function} onProgress - Progress reporting callback
 * @returns {Promise<string>} Base64 image data URL
 */
export async function generateImageHuggingFaceAPI(token, modelId, prompt, onProgress) {
    if (!token) throw new Error('Hugging Face Token is required. Set it up in the Setup tab.');
    if (!modelId) throw new Error('Hugging Face Model ID is required.');

    const url = `https://api-inference.huggingface.co/models/${modelId}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const requestBody = {
        inputs: prompt
    };

    let attempts = 0;
    const maxAttempts = 30; // 30 attempts * 5 seconds = 150 seconds max timeout

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            if (response.ok) {
                const blob = await response.blob();
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('Failed to read Hugging Face response blob as DataURL.'));
                    reader.readAsDataURL(blob);
                });
            }

            // Model loading (503 Service Unavailable)
            if (response.status === 503) {
                let estimatedTime = 20;
                try {
                    const errData = await response.json();
                    estimatedTime = errData.estimated_time || estimatedTime;
                } catch (e) {
                    // Ignore JSON parsing errors
                }
                
                if (onProgress) {
                    onProgress(`Model is loading in Hugging Face... estimated wait: ${Math.round(estimatedTime)}s (Attempt ${attempts})`);
                }
                
                // Sleep for 5 seconds before retrying
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            // Other failures
            let errMsg = 'Hugging Face API request failed';
            try {
                const errData = await response.json();
                errMsg = errData.error || errData.message || errMsg;
                if (Array.isArray(errData.error)) {
                    errMsg = errData.error.join(', ');
                }
            } catch (e) {
                try {
                    const text = await response.text();
                    if (text) errMsg = text;
                } catch (e2) {}
            }
            throw new Error(`Hugging Face error (${response.status}): ${errMsg}`);
        } catch (error) {
            // Propagate terminal errors, or retry on transient network errors
            if (error.message.includes('Hugging Face error') || error.message.includes('Token is required')) {
                throw error;
            }
            console.warn(`Transient Hugging Face fetch error, retrying:`, error);
            if (onProgress) {
                onProgress(`Network issue, retrying generation... (Attempt ${attempts})`);
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    throw new Error('Hugging Face model failed to load in time. Please try again.');
}

