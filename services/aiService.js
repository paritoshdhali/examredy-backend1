const { query } = require('../db');
const axios = require('axios');

/**
 * Generates MCQs using the active AI provider (primarily Google Gemini).
 */
const generateMCQInitial = async (topic, count = 5) => {
    try {
        const providerRes = await query('SELECT * FROM ai_providers WHERE is_active = TRUE LIMIT 1');
        if (providerRes.rows.length === 0 || !providerRes.rows[0].api_key) {
            console.warn('No active AI provider found. Falling back to mock.');
            return fallbackMock(topic, count);
        }

        const provider = providerRes.rows[0];
        const { api_key, model_name, base_url } = provider;
        const isOpenAI = base_url.includes('openrouter.ai') || base_url.includes('openai.com') || base_url.includes('api.openai.com');

        const prompt = `Generate exactly ${count} multiple-choice questions (MCQs) about the topic: "${topic}". 
        The output must be a valid JSON array of objects. Each object must have:
        - "question": (string)
        - "options": (array of 4 strings)
        - "correct_option": (integer, 0-3)
        - "explanation": (string)
        - "subject": (string) "${topic}"
        - "chapter": (string)
        
        Return ONLY valid JSON array.`;

        let response;
        if (isOpenAI) {
            const endpoint = `${base_url}/chat/completions`.replace(/([^:])\/\//g, '$1/');
            response = await axios.post(endpoint, {
                model: model_name,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, {
                headers: { 'Authorization': `Bearer ${api_key}`, 'Content-Type': 'application/json' }
            });
        } else {
            const endpoint = `${base_url}/${model_name}:generateContent?key=${api_key}`;
            response = await axios.post(endpoint, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            });
        }

        const responseText = isOpenAI
            ? response.data?.choices?.[0]?.message?.content
            : response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) throw new Error('AI Provider returned an empty response');

        const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedData = JSON.parse(cleanText);
        const mcqs = Array.isArray(parsedData) ? parsedData : (parsedData.mcqs || parsedData.questions || Object.values(parsedData).find(v => Array.isArray(v)) || []);
        return mcqs.slice(0, count);

    } catch (error) {
        console.error('AI Service Error:', error.response?.data || error.message);
        return fallbackMock(topic, count);
    }
};

const fallbackMock = (topic, count) => {
    return Array.from({ length: count }).map((_, i) => ({
        question: `[MOCK] ${topic} practice question ${i + 1}?`,
        options: ["Option 1", "Option 2", "Option 3", "Option 4"],
        correct_option: 0,
        explanation: `This is a fallback mock explanation for ${topic}. Please check AI API configuration.`,
        subject: topic,
        chapter: 'General'
    }));
};

const fetchAIStructure = async (type, context) => {
    try {
        const providerRes = await query('SELECT * FROM ai_providers WHERE is_active = TRUE LIMIT 1');
        if (providerRes.rows.length === 0 || !providerRes.rows[0].api_key) throw new Error('AI Provider not configured');

        const provider = providerRes.rows[0];
        const { api_key, model_name, base_url } = provider;
        const isOpenAI = base_url.includes('openrouter.ai') || base_url.includes('openai.com') || base_url.includes('api.openai.com');

        const prompt = `Generate a list of exactly 10 ${type} for the following context: "${context}". 
        Return the result as a valid JSON array of strings. 
        Example: ["Item 1", "Item 2", ...]
        Return ONLY the JSON. STICK TO REAL OFFICIAL DATA.`;

        let response;
        if (isOpenAI) {
            const endpoint = `${base_url}/chat/completions`.replace(/([^:])\/\//g, '$1/');
            response = await axios.post(endpoint, {
                model: model_name,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, {
                headers: { 'Authorization': `Bearer ${api_key}`, 'Content-Type': 'application/json' }
            });
        } else {
            const endpoint = `${base_url}/${model_name}:generateContent?key=${api_key}`;
            response = await axios.post(endpoint, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            });
        }

        const responseText = isOpenAI
            ? response.data?.choices?.[0]?.message?.content
            : response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) throw new Error('Empty AI response');

        const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedData = JSON.parse(cleanText);

        let data = Array.isArray(parsedData) ? parsedData : (Object.values(parsedData).find(val => Array.isArray(val)) || parsedData.items || []);

        return data.map(item => {
            if (typeof item === 'string') return { name: item };
            if (typeof item === 'object' && item !== null) {
                return { name: item.name || item.title || item.label || Object.values(item)[0] };
            }
            return { name: String(item) };
        });
    } catch (error) {
        console.error('AI Structure Fetch Error:', error.response?.data || error.message);
        return fallbackMockStructure(type, context, error.message);
    }
};

const fallbackMockStructure = (type, context, errorMsg = 'Unknown') => {
    return [
        { name: `DEBUG_ERROR: ${errorMsg}` },
        { name: `Sample ${type} 1 (${context})` },
        { name: `Sample ${type} 2 (${context})` }
    ];
};

const generateSchoolBoards = async (stateName) => {
    const prompt = `State: ${stateName}, India. List exactly 10 REAL primary/secondary school boards (e.g., CBSE, ICSE, WBCHSE). No generic placeholders.`;
    return await fetchAIStructure('boards', prompt);
};

const generateSchoolSubjects = async (boardName, className, streamName) => {
    const prompt = `Board: ${boardName}, Class: ${className}, Stream: ${streamName || 'General'}, India. 
    List the exactly 10 REAL official compulsory subjects found in the authorized syllabus (e.g., NCERT, State Board syllabus). 
    Exclude elective or minor subjects if possible. No generic placeholders.`;
    return await fetchAIStructure('subjects', prompt);
};

const generateSchoolChapters = async (subjectName, boardName, className) => {
    const prompt = `Return a list of OFFICIALLY CORRECT textbook chapters for the subject "${subjectName}" in ${className} of the ${boardName} board in India.
    - Use real, specific chapter names from the authorized textbook syllabus for the current academic year.
    - DO NOT use placeholders like "Chapter 1".
    - Focus on core curriculum content.
    Return only a JSON array of objects with a "name" key.
    Example: [{"name": "Trigonometry"}, {"name": "Calculus"}]
    Return ONLY JSON. STRICTLY NO MARKDOWN.`;
    return await fetchAIStructure('chapters', prompt);
};

module.exports = { generateMCQInitial, fetchAIStructure, generateSchoolBoards, generateSchoolSubjects, generateSchoolChapters };
