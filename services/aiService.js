const { query } = require('../db');
const axios = require('axios');

/**
 * Generates MCQs using the active AI provider.
 * Now with robust OpenRouter auto-detection.
 */
const generateMCQInitial = async (topic, count = 5, language = 'English') => {
    try {
        const providerRes = await query('SELECT * FROM ai_providers WHERE is_active = TRUE LIMIT 1');
        if (providerRes.rows.length === 0 || !providerRes.rows[0].api_key) {
            console.warn('No active AI provider found. Falling back to mock.');
            return fallbackMock(topic, count, language);
        }

        const provider = providerRes.rows[0];
        const { api_key, model_name, base_url } = provider;

        // --- ROBUST OPENROUTER DETECTION ---
        const isORKey = api_key?.startsWith('sk-or-');
        let effectiveBaseUrl = base_url;
        // Check if it's already an OpenAI-compatible URL
        let isOpenAI = base_url.includes('openrouter.ai') || base_url.includes('openai.com') || base_url.includes('api.openai.com') || isORKey;

        // Force OpenRouter endpoint if key is OR but base_url isn't
        if (isORKey && !base_url.includes('openrouter.ai')) {
            effectiveBaseUrl = 'https://openrouter.ai/api/v1';
        }

        const prompt = `CRITICAL INSTRUCTION: You MUST write the ENTIRE output in the following language: ${language}. If you write in English when ${language} is requested, you will fail.
        
        Generate exactly ${count} multiple-choice questions (MCQs) about the topic: "${topic}". 
        The output must be a valid JSON array of objects. Each object must have:
        - "question": (string in ${language})
        - "options": (array of 4 strings in ${language})
        - "correct_option": (integer, 0-3)
        - "explanation": (string in ${language})
        - "subject": (string) "${topic}"
        - "chapter": (string)
        
        CRITICAL FORMATTING RULES:
        1. Return ONLY a valid JSON array. Do not include any markdown formatting (like \`\`\`json).
        2. Ensure valid JSON syntax: NO trailing commas, NO unescaped quotes inside strings, and NO missing brackets.
        3. Do not include any other text before or after the JSON array.`;

        let response;
        if (isOpenAI) {
            const endpoint = `${effectiveBaseUrl}/chat/completions`.replace(/([^:])\/\//g, '$1/');
            console.log(`[AI-MCQ] Endpoint: ${endpoint}, Model: ${model_name}`);
            response = await axios.post(endpoint, {
                model: model_name,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.5, // Lower temperature for faster, more deterministic output
                top_p: 0.9      // Slightly restrict sampling for speed
            }, {
                headers: {
                    'Authorization': `Bearer ${api_key}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://examredy.in',
                    'X-Title': 'ExamRedy Admin'
                },
                timeout: 25000 // 25 seconds max before timing out to prevent infinite hangs
            });
        } else {
            const endpoint = `${effectiveBaseUrl}/${model_name}:generateContent?key=${api_key}`;
            console.log(`[AI-MCQ] Gemini Endpoint: ${endpoint.substring(0, 45)}...`);
            response = await axios.post(endpoint, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    response_mime_type: "application/json",
                    temperature: 0.5
                }
            }, {
                timeout: 25000
            });
        }

        const responseText = isOpenAI
            ? response.data?.choices?.[0]?.message?.content
            : response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) throw new Error('AI Provider returned an empty response');

        let cleanText = responseText;

        // Extract just the array part to ignore conversational text at the start or end
        const startIdx = cleanText.indexOf('[');
        const endIdx = cleanText.lastIndexOf(']');
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            cleanText = cleanText.substring(startIdx, endIdx + 1);
        }

        // Remove markdown tags and trailing commas from the JSON string
        cleanText = cleanText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        cleanText = cleanText.replace(/,(?=\s*[\]}])/g, '');

        let parsedData;
        try {
            parsedData = JSON.parse(cleanText);
        } catch (parseError) {
            console.error('Initial JSON Parse Failed, attempting aggressive cleanup. Error:', parseError.message);
            try {
                // Aggressive cleanup for common LLM control character issues (like unescaped newlines in strings, tab chars, etc.)
                const aggressiveClean = cleanText.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
                parsedData = JSON.parse(aggressiveClean);
            } catch (e2) {
                throw new Error('AI response was not valid JSON. Parse Error: ' + parseError.message + '\\nResponse starts with: ' + cleanText.substring(0, 100));
            }
        }

        const mcqs = Array.isArray(parsedData) ? parsedData : (parsedData.mcqs || parsedData.questions || Object.values(parsedData).find(v => Array.isArray(v)) || []);
        return mcqs.slice(0, count);

    } catch (error) {
        const errorDetail = error.response?.data?.error?.message || error.response?.data?.message || (typeof error.response?.data === 'string' ? error.response.data : null) || error.message;
        console.error('AI Service Error:', JSON.stringify(error.response?.data || error.message));
        return fallbackMock(topic, count, `[FIX-V1] ${errorDetail}`);
    }
};

const fallbackMock = (topic, count, language, errorMsg = '') => {
    return Array.from({ length: count }).map((_, i) => ({
        question: `[MOCK - ${language}] ${topic} practice question ${i + 1}?`,
        options: ["Option 1", "Option 2", "Option 3", "Option 4"],
        correct_option: 0,
        explanation: `This is a fallback mock explanation for ${topic} in ${language}. ${errorMsg}`,
        subject: topic,
        chapter: 'General'
    }));
};

const fetchAIStructure = async (type, context) => {
    const providerRes = await query('SELECT * FROM ai_providers WHERE is_active = TRUE LIMIT 1');
    if (providerRes.rows.length === 0 || !providerRes.rows[0].api_key) {
        throw new Error('No active AI provider found. Please configure one in Neural Hub.');
    }

    const provider = providerRes.rows[0];
    const { api_key, model_name, base_url } = provider;

    // Detect key type: OpenRouter (sk-or-), OpenAI (sk-), Gemini (AIza)
    const isORKey = api_key?.startsWith('sk-or-');
    const isGeminiKey = api_key?.startsWith('AIza');
    let effectiveBaseUrl = base_url || '';
    let isOpenAI = isORKey || api_key?.startsWith('sk-') ||
        effectiveBaseUrl.includes('openrouter.ai') ||
        effectiveBaseUrl.includes('openai.com');

    // Force correct endpoints based on key type
    if (isORKey && !effectiveBaseUrl.includes('openrouter.ai')) {
        effectiveBaseUrl = 'https://openrouter.ai/api/v1';
        isOpenAI = true;
    }
    if (isGeminiKey) {
        isOpenAI = false;
        if (!effectiveBaseUrl.includes('googleapis.com')) {
            effectiveBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
        }
    }

    const prompt = `List exactly 10 ${type} for: "${context}".
Return ONLY a valid JSON array of objects with a "name" key.
Example: [{"name":"Item 1"},{"name":"Item 2"}]
Do NOT include markdown, code blocks, or any explanation. Return ONLY the JSON array.`;

    let response;
    try {
        if (isOpenAI) {
            const endpoint = `${effectiveBaseUrl}/chat/completions`.replace(/([^:])\/\//g, '$1/');
            console.log(`[AI-STRUCT] OpenAI Endpoint: ${endpoint}, Model: ${model_name}`);
            response = await axios.post(endpoint, {
                model: model_name,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
            }, {
                headers: {
                    'Authorization': `Bearer ${api_key}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://examredy.in',
                    'X-Title': 'ExamRedy Admin'
                },
                timeout: 30000
            });
        } else {
            // Gemini endpoint: base_url/model_name:generateContent?key=...
            const geminiModel = model_name || 'gemini-1.5-flash';
            const geminiBase = effectiveBaseUrl.replace(/\/$/, '');
            const endpoint = `${geminiBase}/${geminiModel}:generateContent?key=${api_key}`;
            console.log(`[AI-STRUCT] Gemini Endpoint: ${endpoint.substring(0, 60)}...`);
            response = await axios.post(endpoint, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json', temperature: 0.3 }
            }, { timeout: 30000 });
        }
    } catch (httpError) {
        const status = httpError.response?.status;
        const errMsg = httpError.response?.data?.error?.message ||
            httpError.response?.data?.message ||
            httpError.message;
        const hint = status === 401 ? ' (Invalid API Key)' :
            status === 403 ? ' (Access Denied / Wrong model)' :
                status === 429 ? ' (Rate limit exceeded)' :
                    status === 404 ? ` (Model "${model_name}" not found)` : '';
        throw new Error(`AI API Error ${status || ''}: ${errMsg}${hint}`);
    }

    const responseText = isOpenAI
        ? response.data?.choices?.[0]?.message?.content
        : response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) throw new Error('AI returned empty response. Check model configuration.');

    // Clean and parse
    const cleanText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsedData;
    try {
        parsedData = JSON.parse(cleanText);
    } catch {
        // Try extracting JSON from within the text
        const match = cleanText.match(/(\[.*\]|\{.*\})/s);
        if (match) {
            parsedData = JSON.parse(match[1]);
        } else {
            throw new Error('AI response was not valid JSON. Try a different model.');
        }
    }

    let data = Array.isArray(parsedData)
        ? parsedData
        : (Object.values(parsedData).find(val => Array.isArray(val)) || []);

    const mapped = data.map(item => {
        if (typeof item === 'string') return { name: item.trim() };
        if (typeof item === 'object' && item !== null) {
            const name = item.name || item.title || item.label || Object.values(item).find(v => typeof v === 'string');
            return { name: (name || '').trim() };
        }
        return { name: String(item).trim() };
    }).filter(item => item.name && item.name.length > 0);

    if (mapped.length === 0) {
        throw new Error('AI returned data but no valid items could be extracted.');
    }

    return mapped;
};


// Curated real education boards for Indian states — used as AI context + fallback
const INDIA_STATE_BOARDS = {
    'west bengal': ['WBBSE (West Bengal Board of Secondary Education)', 'WBCHSE (West Bengal Council of Higher Secondary Education)', 'CBSE', 'ICSE (CISCE)', 'Rabindra Open Schooling'],
    'maharashtra': ['Maharashtra State Board (MSBSHSE)', 'CBSE', 'ICSE (CISCE)', 'IB (International Baccalaureate)', 'NIOS'],
    'uttar pradesh': ['UPMSP (UP Board)', 'CBSE', 'ICSE (CISCE)', 'NIOS'],
    'tamil nadu': ['Tamil Nadu State Board (TNBSE)', 'Samacheer Kalvi Board', 'CBSE', 'ICSE (CISCE)'],
    'karnataka': ['KSEEB (Karnataka Board)', 'PUC Board Karnataka', 'CBSE', 'ICSE (CISCE)'],
    'rajasthan': ['RBSE (Rajasthan Board)', 'CBSE', 'ICSE (CISCE)', 'NIOS'],
    'gujarat': ['GSEB (Gujarat Board)', 'CBSE', 'ICSE (CISCE)'],
    'bihar': ['BSEB (Bihar Board)', 'CBSE', 'ICSE (CISCE)', 'NIOS'],
    'madhya pradesh': ['MPBSE (MP Board)', 'CBSE', 'ICSE (CISCE)'],
    'kerala': ['DHSE Kerala (Kerala Board)', 'CBSE', 'ICSE (CISCE)', 'NIOS'],
    'andhra pradesh': ['BSEAP (AP Board)', 'CBSE', 'ICSE (CISCE)'],
    'telangana': ['BSETS / TSBIE (Telangana Board)', 'CBSE', 'ICSE (CISCE)'],
    'haryana': ['HBSE (Haryana Board)', 'CBSE', 'ICSE (CISCE)'],
    'punjab': ['PSEB (Punjab Board)', 'CBSE', 'ICSE (CISCE)'],
    'delhi': ['CBSE', 'ICSE (CISCE)', 'Delhi Board (DBSE)', 'NIOS'],
    'assam': ['SEBA (Assam Board Class 10)', 'AHSEC (Assam Board Class 12)', 'CBSE', 'ICSE (CISCE)'],
    'odisha': ['BSE Odisha', 'CHSE Odisha', 'CBSE', 'ICSE (CISCE)'],
    'jharkhand': ['JAC (Jharkhand Board)', 'CBSE', 'ICSE (CISCE)'],
    'chhattisgarh': ['CGBSE (Chhattisgarh Board)', 'CBSE', 'ICSE (CISCE)'],
    'himachal pradesh': ['HPBOSE (HP Board)', 'CBSE', 'ICSE (CISCE)'],
    'uttarakhand': ['UBSE (Uttarakhand Board)', 'CBSE', 'ICSE (CISCE)'],
    'goa': ['GBSHSE (Goa Board)', 'CBSE', 'ICSE (CISCE)'],
    'manipur': ['BSEM (Manipur Board)', 'COHSEM', 'CBSE'],
    'meghalaya': ['MBOSE (Meghalaya Board)', 'CBSE'],
    'tripura': ['TBSE (Tripura Board)', 'CBSE'],
    'nagaland': ['NBSE (Nagaland Board)', 'CBSE'],
    'arunachal pradesh': ['APDHTE', 'CBSE'],
    'sikkim': ['SSLC Sikkim', 'CBSE'],
    'mizoram': ['MBSE (Mizoram Board)', 'CBSE'],
    'jammu and kashmir': ['JKBOSE (J&K Board)', 'CBSE'],
    'ladakh': ['CBSE'],
};

const getCuratedBoards = (stateName) => {
    const key = stateName?.toLowerCase().trim();
    for (const [state, boards] of Object.entries(INDIA_STATE_BOARDS)) {
        if (key?.includes(state) || state.includes(key)) {
            return boards.map(name => ({ name }));
        }
    }
    // Generic fallback for unknown states
    return [
        { name: 'CBSE' },
        { name: 'ICSE (CISCE)' },
        { name: 'NIOS' },
        { name: `${stateName} State Board` },
    ];
};

const fallbackMockStructure = (type, context, errorMsg = '') => {
    // Never save debug errors as actual data
    console.error(`[AI Fallback] type=${type}, context=${context}, error=${errorMsg}`);
    return []; // Return empty — admin can retry or manual add
};

const generateSchoolBoards = async (stateName) => {
    const curated = getCuratedBoards(stateName);
    const curatedList = curated.map(b => b.name).join(', ');

    const prompt = `You are a school education expert for India.
For the state/UT "${stateName}", list ALL official and commonly used school education boards.

Known boards typically used in India include: ${curatedList}
For "${stateName}" specifically, confirm which of the above are actually operative and add any additional state-specific boards.

Return ONLY a valid JSON array of objects with a "name" key.
Example: [{"name":"CBSE"},{"name":"WBBSE"},{"name":"ICSE (CISCE)"}]
Rules:
- Include only REAL, officially recognized boards
- Include both central boards (CBSE, ICSE, NIOS) and state board(s)  
- Do NOT include placeholders, duplicates, or made-up names
- Return 3 to 8 real boards maximum
Return ONLY JSON. NO MARKDOWN.`;

    try {
        const result = await fetchAIStructure('school boards', prompt);
        // Validate: filter out anything that looks like an error or placeholder
        const valid = result.filter(b =>
            b.name &&
            !b.name.includes('DEBUG') &&
            !b.name.includes('Error') &&
            !b.name.includes('Sample') &&
            !b.name.includes('FIX-V1') &&
            b.name.length > 2
        );
        // If AI returned nothing valid, use curated data
        return valid.length > 0 ? valid : curated;
    } catch {
        return curated;
    }
};

const generateSchoolSubjects = async (boardName, className, streamName) => {
    const prompt = `You are an Indian school curriculum expert.
For ${boardName}, Class ${className}, Stream: ${streamName || 'General'} (India):
List ALL official compulsory subjects from the authorized syllabus (NCERT/State Board).

Return ONLY a valid JSON array of objects with a "name" key.
Example: [{"name":"Mathematics"},{"name":"Physics"},{"name":"English"}]
Rules:
- Use exact official subject names
- Include 5-10 core subjects
- No placeholders or duplicates
Return ONLY JSON. NO MARKDOWN.`;
    return await fetchAIStructure('subjects', prompt);
};

const generateSchoolChapters = async (subjectName, boardName, className) => {
    const prompt = `You are an Indian school curriculum expert.
List ALL official textbook chapters for:
- Subject: ${subjectName}
- Board: ${boardName}  
- Class: ${className}
- Country: India

Return ONLY a valid JSON array of objects with a "name" key.
Example: [{"name":"Real Numbers"},{"name":"Polynomials"},{"name":"Triangles"}]
Rules:
- Use exact chapter names from the official NCERT or state board textbook
- Do NOT use placeholders like "Chapter 1"
- Include all major chapters (8-18 expected)
Return ONLY JSON. NO MARKDOWN.`;
    return await fetchAIStructure('chapters', prompt);
};

module.exports = { generateMCQInitial, fetchAIStructure, generateSchoolBoards, generateSchoolSubjects, generateSchoolChapters };

