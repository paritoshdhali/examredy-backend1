import React, { useState, useEffect } from 'react';
import api from '../services/api';
import MCQSession from '../components/MCQSession';
import PrimePopup from '../components/PrimePopup';
import AdSlot from '../components/AdSlot';

const Group = () => {
    const [step, setStep] = useState('menu'); // 'menu', 'lobby', 'active', 'results'
    const [sessionCode, setSessionCode] = useState('');
    const [inputCode, setInputCode] = useState('');
    const [participants, setParticipants] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const [battleQuestions, setBattleQuestions] = useState([]);
    const [showPopup, setShowPopup] = useState(false);
    const [isFetchingAI, setIsFetchingAI] = useState('');

    // Hierarchy States
    const [categories, setCategories] = useState([]);
    const [states, setStates] = useState([]);
    const [boards, setBoards] = useState([]);
    const [classes, setClasses] = useState([]);
    const [streams, setStreams] = useState([]);
    const [universities, setUniversities] = useState([]);
    const [degreeTypes, setDegreeTypes] = useState([]);
    const [papersStages, setPapersStages] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [chapters, setChapters] = useState([]);
    const [semesters, setSemesters] = useState([]);

    // Selection States
    const [selectedCat, setSelectedCat] = useState('');
    const [selectedState, setSelectedState] = useState('');
    const [selectedBoard, setSelectedBoard] = useState('');
    const [selectedUniversity, setSelectedUniversity] = useState('');
    const [selectedClass, setSelectedClass] = useState('');
    const [selectedStream, setSelectedStream] = useState('');
    const [selectedDegreeType, setSelectedDegreeType] = useState('');
    const [selectedPaperStage, setSelectedPaperStage] = useState('');
    const [selectedSemester, setSelectedSemester] = useState('');
    const [selectedSubject, setSelectedSubject] = useState('');
    const [selectedChapter, setSelectedChapter] = useState('');
    const [flowType, setFlowType] = useState('competitive');

    // Flow Detection
    useEffect(() => {
        if (!selectedCat || categories.length === 0) return;
        const cat = categories.find(c => String(c.id) === String(selectedCat));
        if (!cat) return;
        const name = cat.name.toLowerCase();
        if (name.includes('school')) setFlowType('school');
        else if (name.includes('university') || name.includes('college')) setFlowType('university');
        else setFlowType('competitive');
        // Reset lower cascade
        setSelectedState(''); setSelectedBoard(''); setSelectedUniversity(''); setSelectedClass('');
        setSelectedStream(''); setSelectedDegreeType(''); setSelectedPaperStage(''); setSelectedSemester(''); setSelectedSubject(''); setSelectedChapter('');
    }, [selectedCat, categories]);

    // Initial Load
    useEffect(() => {
        const loadInitial = async () => {
            try {
                const [catRes, stateRes] = await Promise.all([
                    api.get('/structure/categories'),
                    api.get('/structure/states'),
                ]);
                setCategories(catRes.data);
                setStates(stateRes.data);
            } catch (err) { console.error('Failed to load initial data', err); }
        };
        loadInitial();
    }, []);

    // Cascade Logic
    useEffect(() => {
        if (selectedState && flowType === 'school') api.get(`/structure/boards/${selectedState}`).then(res => setBoards(res.data));
        else if (selectedState && flowType === 'university') api.get(`/structure/universities/${selectedState}`).then(res => setUniversities(res.data));
    }, [selectedState, flowType]);

    useEffect(() => {
        if (selectedBoard && flowType === 'school') {
            api.get(`/structure/classes/${selectedBoard}`).then(res => setClasses(res.data));
            api.get(`/structure/streams`).then(res => setStreams(res.data));
        }
    }, [selectedBoard, flowType]);

    useEffect(() => {
        if (selectedUniversity && flowType === 'university') {
            api.get(`/structure/degree-types/${selectedUniversity}`).then(res => setDegreeTypes(res.data)).catch(() => setDegreeTypes([]));
            api.get('/structure/semesters').then(res => setSemesters(res.data)).catch(() => setSemesters([]));
        } else {
            setDegreeTypes([]);
            setSemesters([]);
        }
    }, [selectedUniversity, flowType]);

    useEffect(() => {
        if (selectedCat && flowType === 'competitive') api.get(`/structure/papers-stages/${selectedCat}`).then(res => setPapersStages(res.data));
    }, [selectedCat, flowType]);

    useEffect(() => {
        let url = `/structure/subjects?category_id=${selectedCat}`;
        let shouldFetch = false;
        if (flowType === 'school' && selectedClass) {
            url += `&board_id=${selectedBoard}&class_id=${selectedClass}`;
            if (selectedStream) url += `&stream_id=${selectedStream}`;
            shouldFetch = true;
        } else if (flowType === 'university' && selectedUniversity && selectedDegreeType && selectedSemester) {
            url += `&university_id=${selectedUniversity}&degree_type_id=${selectedDegreeType}&semester_id=${selectedSemester}`;
            shouldFetch = true;
        } else if (flowType === 'competitive' && selectedPaperStage) {
            url += `&paper_stage_id=${selectedPaperStage}`;
            shouldFetch = true;
        }
        if (shouldFetch) api.get(url).then(res => setSubjects(res.data));
    }, [selectedCat, flowType, selectedClass, selectedBoard, selectedStream, selectedUniversity, selectedDegreeType, selectedPaperStage]);

    useEffect(() => {
        if (selectedSubject) api.get(`/structure/chapters/${selectedSubject}`).then(res => setChapters(res.data));
    }, [selectedSubject]);

    const foundClass = classes.find(c => (c.class_id || c.id) == selectedClass);
    const classNum = selectedClass && foundClass ? parseInt(foundClass.name.replace(/\D/g, '')) : 0;
    const needsStream = classNum >= 11;

    // Polling for lobby and battle synchronization
    useEffect(() => {
        let interval;
        if ((step === 'lobby' || step === 'active') && sessionCode) {
            interval = setInterval(async () => {
                try {
                    const res = await api.get(`/group/${sessionCode}/status`);
                    setParticipants(res.data.participants);
                    setIsHost(res.data.isHost);

                    if (res.data.language && !res.data.isHost) {
                        setSelectedLanguage(res.data.language);
                    }
                    if (res.data.subjectId && !isHost && !selectedSubject) {
                        setSelectedSubject(res.data.subjectId);
                    }
                    if (res.data.chapterId && !isHost && !selectedChapter) {
                        setSelectedChapter(res.data.chapterId);
                    }

                    if (res.data.status === 'active' && res.data.questions.length > 0) {
                        // For synchronization: only update if the count has changed
                        if (res.data.questions.length !== battleQuestions.length) {
                            console.log("[GroupSync] New question detected. Updating local list.");
                            setBattleQuestions(res.data.questions);
                        }
                        if (step === 'lobby') setStep('active');
                    }
                } catch (err) {
                    console.error("Polling error", err);
                }
            }, 3000); // Poll every 3 seconds
        }
        return () => clearInterval(interval);
    }, [step, sessionCode, battleQuestions.length]);

    // Create a new session
    const handleCreate = async () => {
        setLoading(true);
        try {
            const res = await api.post('/group/create'); // Updated to use axios instance
            setSessionCode(res.data.code);
            setStep('lobby');
            setIsHost(true);
            setParticipants([{ username: 'You (Host)', isHost: true }]);
        } catch (err) {
            if (err.response?.data?.code === 'SESSIONS_EXHAUSTED') {
                setShowPopup(true);
            } else {
                setError('Failed to create session. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    // Join existing session
    const handleJoin = async () => {
        if (!inputCode) return;
        setLoading(true);
        try {
            await api.post('/group/join', { code: inputCode }); // Code must be in the body, not url
            setSessionCode(inputCode);
            setStep('lobby');
            setIsHost(false);
            setParticipants([{ username: 'You', isHost: false }]);
        } catch (err) {
            setError(err.response?.data?.message || 'Invalid Session Code');
        } finally {
            setLoading(false);
        }
    };

    const [selectedLanguage, setSelectedLanguage] = useState('English');

    // ── USER AI FETCH HANDLER ──
    const handleAIFetch = async (type) => {
        setIsFetchingAI(type);
        try {
            if (type === 'boards') {
                const s = states.find(x => x.id == selectedState);
                if (!s) return;
                await api.post('/structure/fetch-out-boards', { state_id: s.id, state_name: s.name });
                const res = await api.get(`/structure/boards/${selectedState}`);
                setBoards(res.data);
            } else if (type === 'classes') {
                const b = boards.find(x => x.id == selectedBoard);
                if (!b) return;
                await api.post('/structure/fetch-out-classes', { board_id: b.id, board_name: b.name });
                const res = await api.get(`/structure/classes/${selectedBoard}`);
                setClasses(res.data);
            } else if (type === 'streams') {
                const b = boards.find(x => x.id == selectedBoard);
                const c = classes.find(x => (x.class_id || x.id) == selectedClass);
                if (!b || !c) return;
                await api.post('/structure/fetch-out-streams', { board_name: b.name, class_name: c.name });
                const res = await api.get(`/structure/streams`);
                setStreams(res.data);
            } else if (type === 'universities') {
                const st = states.find(x => x.id == selectedState);
                if (!st) return;
                await api.post('/structure/fetch-out-universities', { state_id: st.id, state_name: st.name });
                const res = await api.get(`/structure/universities/${selectedState}`);
                setUniversities(res.data);
            } else if (type === 'degreeTypes') {
                const u = universities.find(x => x.id == selectedUniversity);
                if (!u) return;
                await api.post('/structure/fetch-out-degree-types', { university_id: u.id, university_name: u.name });
                const res = await api.get(`/structure/degree-types/${selectedUniversity}`);
                setDegreeTypes(res.data);
            } else if (type === 'papersStages') {
                const cat = categories.find(x => x.id == selectedCat);
                if (!cat) return;
                await api.post('/structure/fetch-out-papers-stages', { category_id: cat.id, category_name: cat.name });
                const res = await api.get(`/structure/papers-stages/${selectedCat}`);
                setPapersStages(res.data);
            } else if (type === 'subjects') {
                let payload = {};
                let url = '';
                if (flowType === 'school') {
                    const b = boards.find(x => x.id == selectedBoard);
                    const c = classes.find(x => (x.class_id || x.id) == selectedClass);
                    const st = streams.find(x => x.id == selectedStream);
                    if (!b || !c) return;
                    payload = { board_id: b.id, board_name: b.name, class_id: c.class_id || c.id, class_name: c.name, stream_id: st?.id, stream_name: st?.name };
                    url = `/structure/subjects?category_id=${selectedCat}&board_id=${selectedBoard}&class_id=${selectedClass}`;
                    if (selectedStream) url += `&stream_id=${selectedStream}`;
                } else if (flowType === 'university') {
                    const u = universities.find(x => x.id == selectedUniversity);
                    const dt = degreeTypes.find(x => x.id == selectedDegreeType);
                    if (!u || !dt) return;
                    payload = { university_id: u.id, university_name: u.name, degree_type_id: dt.id, degree_type_name: dt.name, category_id: selectedCat };
                    url = `/structure/subjects?category_id=${selectedCat}&university_id=${selectedUniversity}&degree_type_id=${selectedDegreeType}`;
                } else if (flowType === 'competitive') {
                    const ps = papersStages.find(x => x.id == selectedPaperStage);
                    const cat = categories.find(x => x.id == selectedCat);
                    if (!ps || !cat) return;
                    payload = { paper_stage_id: ps.id, paper_stage_name: ps.name, category_id: cat.id, category_name: cat.name };
                    url = `/structure/subjects?category_id=${selectedCat}&paper_stage_id=${selectedPaperStage}`;
                }
                await api.post('/structure/fetch-out-subjects', payload);
                const res = await api.get(url);
                setSubjects(res.data);
            } else if (type === 'chapters') {
                const s = subjects.find(x => x.id == selectedSubject);
                if (!s) return;
                let payload = { subject_id: s.id, subject_name: s.name };
                if (flowType === 'school') {
                    const b = boards.find(x => x.id == selectedBoard);
                    const c = classes.find(x => (x.class_id || x.id) == selectedClass);
                    if (!b || !c) return;
                    payload.board_name = b.name; payload.class_name = c.name;
                } else if (flowType === 'university') {
                    const u = universities.find(x => x.id == selectedUniversity);
                    const dt = degreeTypes.find(x => x.id == selectedDegreeType);
                    if (!u || !dt) return;
                    payload.university_name = u.name; payload.degree_type_name = dt.name;
                } else if (flowType === 'competitive') {
                    const ps = papersStages.find(x => x.id == selectedPaperStage);
                    const cat = categories.find(x => x.id == selectedCat);
                    if (!ps || !cat) return;
                    payload.paper_stage_name = ps.name; payload.category_name = cat.name;
                }
                await api.post('/structure/fetch-out-chapters', payload);
                const res = await api.get(`/structure/chapters/${selectedSubject}`);
                setChapters(res.data);
            }
        } catch (err) {
            setError(err.response?.data?.message || err.response?.data?.error || `Failed to fetch ${type} via AI`);
        } finally {
            setIsFetchingAI('');
        }
    };

    const handleStart = async () => {
        console.log("[GroupBattle] Start requested. Category:", selectedCat, "Session:", sessionCode);
        if (!selectedCat) {
            console.warn("[GroupBattle] Category not selected. Aborting.");
            return;
        }
        setLoading(true);
        setError('');
        try {
            console.log("[GroupBattle] Sending /start request to backend...");
            const res = await api.post('/group/start', {
                code: sessionCode,
                categoryId: selectedCat,
                boardId: selectedBoard,
                classId: selectedClass,
                streamId: selectedStream,
                semesterId: selectedSemester,
                universityId: selectedUniversity,
                paperStageId: selectedPaperStage,
                subjectId: selectedSubject,
                chapterId: selectedChapter,
                language: selectedLanguage
            });
            console.log("[GroupBattle] Backend responded success. Questions count:", res.data.questions?.length);
            if (res.data.questions && res.data.questions.length > 0) {
                setBattleQuestions(res.data.questions);
                setStep('active');
            } else {
                setError('No questions were generated for this selection. Try a different category or subject.');
            }
        } catch (err) {
            console.error("[GroupBattle] Start failed:", err.response?.status, err.response?.data || err.message);
            if (err.response?.data?.code === 'SESSIONS_EXHAUSTED') {
                setShowPopup(true);
            } else {
                setError(err.response?.data?.message || 'Failed to start battle. Ensure questions are available for this selection.');
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchNextQuestion = async () => {
        try {
            const res = await api.post(`/group/${sessionCode}/next`, { 
                language: selectedLanguage,
                currentCount: battleQuestions.length
            });
            setBattleQuestions(res.data.questions);
            return true;
        } catch (err) {
            console.error("Failed to fetch next question", err);
            return false;
        }
    };


    if (step === 'active') {
        return (
            <div className="min-h-screen bg-gray-50 py-12">
                <MCQSession
                    questions={battleQuestions}
                    mode="group"
                    sessionId={sessionCode}
                    onFetchNext={fetchNextQuestion}
                    onComplete={() => setStep('results')}
                />
            </div>
        );
    }

    if (step === 'results') {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col xl:flex-row gap-8 items-center justify-center p-4 w-full max-w-[1400px] mx-auto xl:py-12">
                {/* Left Ad Sidebar */}
                <div className="hidden xl:block w-[160px] shrink-0 sticky top-24">
                    <AdSlot type="left" />
                </div>

                <div className="flex-1 w-full max-w-lg mx-auto">
                    <Leaderboard sessionId={sessionCode} />
                </div>

                {/* Right Ad Sidebar */}
                <div className="hidden xl:block w-[160px] shrink-0 sticky top-24">
                    <AdSlot type="right" />
                </div>
            </div>
        );
    }

    if (step === 'lobby') {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col xl:flex-row gap-8 items-center xl:items-start justify-center p-4 w-full max-w-[1400px] mx-auto xl:py-12">
                {/* Left Ad Sidebar */}
                <div className="hidden xl:block w-[160px] shrink-0 sticky top-24">
                    <AdSlot type="left" />
                </div>

                <div className="flex-1 w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center mx-auto">
                    <div className="inline-block bg-green-100 text-green-700 px-4 py-1 rounded-full text-sm font-bold mb-6">
                        🟢 Lobby Active
                    </div>
                    <h2 className="text-3xl font-bold text-gray-900 mb-2">Waiting Room</h2>
                    <p className="text-gray-500 mb-8">Share code with friends to join.</p>

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm mb-6 font-bold border-2 border-red-100">
                            ⚠️ {error}
                        </div>
                    )}

                    <div className="bg-gray-100 rounded-2xl p-6 mb-8 border-2 border-dashed border-gray-300">
                        <p className="text-xs text-gray-400 uppercase font-bold tracking-widest mb-2">Session Code</p>
                        <div className="text-5xl font-mono font-bold text-blue-600 tracking-wider select-all">
                            {sessionCode}
                        </div>
                    </div>

                    <div className="space-y-4 mb-8">
                        <h3 className="text-left text-sm font-bold text-gray-400 uppercase">Participants ({participants.length})</h3>
                        {participants.map((p, i) => (
                            <div key={i} className="flex items-center p-3 bg-gray-50 rounded-xl">
                                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold mr-3">
                                    {p.username[0]}
                                </div>
                                <span className="font-medium text-gray-700">{p.username}</span>
                                {p.isHost && <span className="ml-auto text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">HOST</span>}
                            </div>
                        ))}
                    </div>

                    {isHost && (
                        <div className="mb-8 text-left space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Select Category</label>
                                <select value={selectedCat} onChange={e => setSelectedCat(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-blue-500">
                                    <option value="">Choose Category</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>

                            {flowType === 'school' && selectedCat && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2 sm:col-span-1">
                                        <select value={selectedState} onChange={e => setSelectedState(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none">
                                            <option value="">State</option>
                                            {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="col-span-2 sm:col-span-1">
                                        <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)} disabled={!selectedState || isFetchingAI === 'boards'} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none disabled:bg-gray-50">
                                            <option value="">{isFetchingAI === 'boards' ? 'AI fetching...' : 'Board'}</option>
                                            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                        </select>
                                        {selectedState && boards.length === 0 && (
                                            <button onClick={() => handleAIFetch('boards')} disabled={isFetchingAI === 'boards'} className="mt-1 w-full text-[10px] sm:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 rounded hover:bg-indigo-100 disabled:opacity-50">
                                                ✨ Fetch Boards
                                            </button>
                                        )}
                                    </div>
                                    <div className="col-span-2 sm:col-span-1">
                                        <select value={selectedClass} onChange={e => { setSelectedClass(e.target.value); setSelectedStream(''); setSelectedSubject(''); }} disabled={!selectedBoard || isFetchingAI === 'classes'} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none disabled:bg-gray-50">
                                            <option value="">{isFetchingAI === 'classes' ? 'AI fetching...' : 'Class'}</option>
                                            {classes.map(c => <option key={c.id} value={c.class_id || c.id}>{c.name}</option>)}
                                        </select>
                                        {selectedBoard && classes.length === 0 && (
                                            <button onClick={() => handleAIFetch('classes')} disabled={isFetchingAI === 'classes'} className="mt-1 w-full text-[10px] sm:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 rounded hover:bg-indigo-100 disabled:opacity-50">
                                                ✨ Fetch Classes
                                            </button>
                                        )}
                                    </div>
                                    {needsStream && (
                                        <div className="col-span-2 sm:col-span-1">
                                            <select value={selectedStream} onChange={e => { setSelectedStream(e.target.value); setSelectedSubject(''); }} disabled={!selectedClass || isFetchingAI === 'streams'} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none disabled:bg-gray-50">
                                                <option value="">{isFetchingAI === 'streams' ? 'AI fetching...' : 'Stream'}</option>
                                                {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                            {selectedClass && streams.length === 0 && (
                                                <button onClick={() => handleAIFetch('streams')} disabled={isFetchingAI === 'streams'} className="mt-1 w-full text-[10px] sm:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 rounded hover:bg-indigo-100 disabled:opacity-50">
                                                    ✨ Fetch Streams
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {flowType === 'university' && selectedCat && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <select value={selectedState} onChange={e => setSelectedState(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none">
                                            <option value="">State</option>
                                            {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <select value={selectedUniversity} onChange={e => setSelectedUniversity(e.target.value)} disabled={!selectedState || isFetchingAI === 'universities'} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none disabled:bg-gray-50">
                                            <option value="">{isFetchingAI === 'universities' ? 'AI fetching...' : 'University'}</option>
                                            {universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                        </select>
                                        {selectedState && universities.length === 0 && (
                                            <button onClick={() => handleAIFetch('universities')} disabled={isFetchingAI === 'universities'} className="mt-1 w-full text-[10px] sm:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 rounded hover:bg-indigo-100 disabled:opacity-50">
                                                ✨ Fetch Universities
                                            </button>
                                        )}
                                    </div>
                                    <div className="col-span-2 sm:col-span-1">
                                        <select value={selectedDegreeType} onChange={e => { setSelectedDegreeType(e.target.value); setSelectedSubject(''); }} disabled={!selectedUniversity || isFetchingAI === 'degreeTypes'} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none disabled:bg-gray-50">
                                            <option value="">{isFetchingAI === 'degreeTypes' ? 'AI fetching...' : 'Degree Type'}</option>
                                            {degreeTypes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                        {selectedUniversity && degreeTypes.length === 0 && (
                                            <button onClick={() => handleAIFetch('degreeTypes')} disabled={isFetchingAI === 'degreeTypes'} className="mt-1 w-full text-[10px] sm:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 rounded hover:bg-indigo-100 disabled:opacity-50">
                                                ✨ Fetch Degree Types
                                            </button>
                                        )}
                                    </div>
                                    <div className="col-span-2 sm:col-span-1">
                                        <select value={selectedSemester} onChange={e => setSelectedSemester(e.target.value)} disabled={!selectedDegreeType} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none disabled:bg-gray-50">
                                            <option value="">Semester</option>
                                            {semesters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {flowType === 'competitive' && selectedCat && (
                                <div className="grid grid-cols-1 gap-4">
                                    <div>
                                        <select value={selectedPaperStage} onChange={e => { setSelectedPaperStage(e.target.value); setSelectedSubject(''); }} disabled={!selectedCat || isFetchingAI === 'papersStages'} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 outline-none disabled:bg-gray-50">
                                            <option value="">{isFetchingAI === 'papersStages' ? 'AI fetching...' : 'Exam Stage'}</option>
                                            {papersStages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                        </select>
                                        {selectedCat && papersStages.length === 0 && (
                                            <button onClick={() => handleAIFetch('papersStages')} disabled={isFetchingAI === 'papersStages'} className="mt-1 w-full text-[10px] sm:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 rounded hover:bg-indigo-100 disabled:opacity-50">
                                                ✨ Fetch Exam Stages
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {selectedCat && (
                                <div className="grid grid-cols-2 gap-4 mt-4">
                                    <div className="col-span-2 sm:col-span-1">
                                        <select value={selectedSubject} onChange={e => { setSelectedSubject(e.target.value); setSelectedChapter(''); }} disabled={
                                            (flowType === 'school' && !selectedClass) ||
                                            (flowType === 'university' && !selectedSemester) ||
                                            (flowType === 'competitive' && !selectedPaperStage) ||
                                            isFetchingAI === 'subjects'
                                        } className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none disabled:bg-gray-50">
                                            <option value="">{isFetchingAI === 'subjects' ? 'AI fetching...' : 'Subject'}</option>
                                            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                        {((flowType === 'school' && selectedClass) || (flowType === 'university' && selectedSemester) || (flowType === 'competitive' && selectedPaperStage)) && subjects.length === 0 && (
                                            <button onClick={() => handleAIFetch('subjects')} disabled={isFetchingAI === 'subjects'} className="mt-1 w-full text-[10px] sm:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 rounded hover:bg-indigo-100 disabled:opacity-50">
                                                ✨ Fetch Subjects
                                            </button>
                                        )}
                                    </div>
                                    <div className="col-span-2 sm:col-span-1">
                                        <select value={selectedChapter} onChange={e => setSelectedChapter(e.target.value)} disabled={!selectedSubject || isFetchingAI === 'chapters'} className="w-full border-2 border-gray-100 rounded-xl px-2 py-3 outline-none disabled:bg-gray-50">
                                            <option value="">{isFetchingAI === 'chapters' ? 'AI fetching...' : 'Chapter (Opt)'}</option>
                                            {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                        {selectedSubject && chapters.length === 0 && (
                                            <button onClick={() => handleAIFetch('chapters')} disabled={isFetchingAI === 'chapters'} className="mt-1 w-full text-[10px] sm:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 rounded hover:bg-indigo-100 disabled:opacity-50">
                                                ✨ Fetch Chapters
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {selectedCat && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Exam Language</label>
                                    <select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)} className="w-full border-2 border-blue-50 bg-blue-50 text-blue-900 rounded-xl px-4 py-3 outline-none font-bold">
                                        <option value="English">English</option>
                                        <option value="Bengali">Bengali (বাংলা)</option>
                                        <option value="Hindi">Hindi (हिंदी)</option>
                                        <option value="Urdu">Urdu (اردو)</option>
                                        <option value="Assamese">Assamese (অসমীয়া)</option>
                                        <option value="Gujarati">Gujarati (ગુજરાતી)</option>
                                        <option value="Marathi">Marathi (मরাঠী)</option>
                                        <option value="Tamil">Tamil (தமிழ்)</option>
                                        <option value="Telugu">Telugu (తెలుగు)</option>
                                    </select>
                                    <p className="text-[10px] text-blue-400 mt-1 font-medium">* AI will generate synchronized questions in this language.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {participants.length >= 15 && (
                        <div className="mb-6 p-4 bg-orange-50 border-2 border-orange-100 rounded-2xl text-orange-700 text-sm font-bold flex items-center justify-center gap-2">
                            ⚠️ Group is full (Maximum 15 players)
                        </div>
                    )}

                    {isHost ? (
                        <button
                            onClick={handleStart}
                            disabled={loading || !selectedCat}
                            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 shadow-lg transition transform hover:-translate-y-1 disabled:opacity-50"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                                    Generating AI Competition...
                                </span>
                            ) : 'Start Competition 🚀'}
                        </button>
                    ) : (
                        <div className="bg-blue-50 text-blue-700 p-4 rounded-xl font-medium flex items-center justify-center animate-pulse">
                            Waiting for Host to start...
                        </div>
                    )}

                </div>

                {/* Right Ad Sidebar */}
                <div className="hidden xl:block w-[160px] shrink-0 sticky top-24">
                    <AdSlot type="right" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-900 flex flex-col xl:flex-row gap-8 items-center justify-center p-4 w-full">
            {/* Left Ad Sidebar */}
            <div className="hidden xl:block w-[160px] shrink-0 sticky top-24">
                <AdSlot type="left" />
            </div>

            <div className="max-w-4xl w-full grid md:grid-cols-2 gap-8">

                {/* Intro Side */}
                <div className="text-white flex flex-col justify-center">
                    <h1 className="text-5xl font-extrabold mb-6 leading-tight">
                        Compete with <br /> <span className="text-yellow-400">Friends</span>
                    </h1>
                    <p className="text-lg text-blue-100 mb-8 leading-relaxed">
                        Create a private lobby, invite your study group, and solve MCQs together in real-time. See who tops the leaderboard!
                    </p>
                    <div className="flex items-center gap-4">
                        <div className="flex -space-x-2">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="w-10 h-10 rounded-full border-2 border-blue-600 bg-gray-300" />
                            ))}
                        </div>
                        <span className="text-sm font-medium opacity-80">100+ Students online</span>
                    </div>
                </div>

                {/* Action Card */}
                <div className="bg-white rounded-3xl shadow-2xl p-8">
                    <h2 className="text-2xl font-bold text-gray-900 mb-8">Group Mode</h2>

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4">
                            {error}
                        </div>
                    )}

                    <div className="space-y-6">
                        <button
                            onClick={handleCreate}
                            disabled={loading}
                            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold flex items-center justify-center hover:bg-blue-700 transition"
                        >
                            {loading ? 'Creating...' : 'Create New Lobby'}
                        </button>

                        <div className="relative flex py-2 items-center">
                            <div className="flex-grow border-t border-gray-200"></div>
                            <span className="flex-shrink-0 mx-4 text-gray-400 text-sm">OR JOIN EXISTING</span>
                            <div className="flex-grow border-t border-gray-200"></div>
                        </div>

                        <div>
                            <input
                                type="text"
                                placeholder="ENTER CODE (e.g. A1B2)"
                                value={inputCode}
                                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 font-mono text-center text-lg uppercase tracking-widest focus:border-blue-500 focus:ring-0 outline-none transition"
                            />
                            <button
                                onClick={handleJoin}
                                disabled={!inputCode || loading}
                                className="w-full mt-4 bg-gray-900 text-white py-4 rounded-xl font-bold hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Join Lobby
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Ad Sidebar */}
            <div className="hidden xl:block w-[160px] shrink-0 sticky top-24">
                <AdSlot type="right" />
            </div>

            {showPopup && <PrimePopup onClose={() => setShowPopup(false)} />}
        </div>
    );
};

const Leaderboard = ({ sessionId }) => {
    const [results, setResults] = useState([]);

    useEffect(() => {
        const fetchLeaderboard = async () => {
            try {
                const res = await api.get(`/group/${sessionId}/leaderboard`);
                setResults(res.data);
            } catch (err) {
                console.error("Failed to fetch leaderboard");
            }
        };
        fetchLeaderboard();

        // Final polling to see if others finished
        const interval = setInterval(fetchLeaderboard, 5000);
        return () => clearInterval(interval);
    }, [sessionId]);

    return (
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-lg w-full mx-auto border border-gray-100">
            <div className="text-center mb-8">
                <div className="text-5xl mb-4">🏆</div>
                <h2 className="text-3xl font-bold text-gray-900">Final Leaderboard</h2>
            </div>

            <div className="space-y-4">
                {results.map((r, i) => (
                    <div key={i} className={`flex items-center p-4 rounded-xl border-2 ${i === 0 ? 'border-yellow-400 bg-yellow-50' : 'border-gray-100 bg-white'}`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg mr-4 ${i === 0 ? 'bg-yellow-400 text-white' : 'bg-gray-200 text-gray-600'}`}>
                            {i + 1}
                        </div>
                        <div className="flex-1 font-bold text-gray-800 text-lg">{r.username}</div>
                        <div className="font-mono font-bold text-blue-600 text-xl">{r.score} pts</div>
                    </div>
                ))}
            </div>

            <button onClick={() => window.location.href = '/practice'} className="w-full mt-8 bg-gray-100 text-gray-700 py-4 rounded-xl font-bold hover:bg-gray-200 transition">
                Back to Practice
            </button>
        </div>
    );
};

export default Group;

