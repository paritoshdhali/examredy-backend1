const { query } = require('../db');
const axios = require('axios');

/**
 * Generates MCQs using the active AI provider (primarily Google Gemini).
 */
const generateMCQInitial = async (topic, count = 5) => {
    try {
        // 1. Fetch active AI provider details
        const providerRes = await query('SELECT * FROM ai_providers WHERE is_active = TRUE LIMIT 1');

        if (providerRes.rows.length === 0 || !providerRes.rows[0].api_key) {
            console.warn('No active AI provider or API key found. Falling back to mock.');
            return fallbackMock(topic, count);
        }

        const provider = providerRes.rows[0];
        const { api_key, model_name, base_url } = provider;

        // 2. Prepare Prompt
        const prompt = `Generate exactly ${count} multiple-choice questions (MCQs) about the topic: "${topic}". 
        The output must be a valid JSON array of objects. Each object must have:
        - "question": (string) The MCQ question.
        - "options": (array of 4 strings) Four distinct options.
        - "correct_option": (integer, 0-3) The index of the correct option.
        - "explanation": (string) A detailed explanation of why the answer is correct.
        - "subject": (string) Set as "${topic}".
        - "chapter": (string) A logical chapter name related to the topic.
        
        Return ONLY the JSON array. Do not include markdown formatting like \`\`\`json.`;

        // 3. API Call to Gemini
        // Endpoint: {base_url}/{model}:generateContent?key={api_key}
        const endpoint = `${base_url}/${model_name}:generateContent?key=${api_key}`;

        const response = await axios.post(endpoint, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048,
                response_mime_type: "application/json"
            }
        });

        // 4. Parse Response
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            throw new Error('AI Provider returned an empty response');
        }

        try {
            const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedData = JSON.parse(cleanText);
            // Gemini sometimes wraps result in an object or array, normalize to array
            const mcqs = Array.isArray(parsedData) ? parsedData : (parsedData.mcqs || parsedData.questions || []);
            return mcqs.slice(0, count);
        } catch (parseError) {
            console.error('JSON Parse Error from AI:', responseText);
            throw new Error('AI output was not valid JSON: ' + parseError.message);
        }

    } catch (error) {
        console.error('AI Service Error:', error.response?.data || error.message);
        return fallbackMock(topic, count);
    }
};

/**
 * Fallback mock logic if AI fails or is not configured
 */
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
        if (providerRes.rows.length === 0 || !providerRes.rows[0].api_key) {
            throw new Error('AI Provider not configured');
        }
        const { api_key, model_name, base_url } = providerRes.rows[0];

        const prompt = `Generate a list of exactly 10 ${type} for the following context: "${context}". 
        Return the result as a valid JSON array of strings. 
        Example: ["Item 1", "Item 2", ...]
        Return ONLY the JSON.`;

        const endpoint = `${base_url}/${model_name}:generateContent?key=${api_key}`;
        const response = await axios.post(endpoint, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
        });

        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) throw new Error('Empty AI response');

        const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedData = JSON.parse(cleanText);

        let data = [];
        if (Array.isArray(parsedData)) {
            data = parsedData;
        } else if (typeof parsedData === 'object' && parsedData !== null) {
            // Smarter check: find the first array in the object (e.g., .boards, .subjects, .data)
            const firstArray = Object.values(parsedData).find(val => Array.isArray(val));
            data = firstArray || (parsedData.items || parsedData.list || []);
        }

        // Always normalize to array of objects with 'name' property
        return data.map(item => {
            if (typeof item === 'string') return { name: item };
            if (typeof item === 'object' && item !== null) {
                return { name: item.name || item.title || item.label || Object.values(item)[0] };
            }
            return { name: String(item) };
        });
    } catch (error) {
        console.error('AI Structure Fetch Error:', error.message);
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
