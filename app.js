// ==========================================
// 수학 문제 유사 기출 추천 서비스 (MathTutor AI)
// 메인 비즈니스 로직 자바스크립트 (app.js)
// ==========================================

import { getConfig, saveConfig, resetConfig } from './config.js';

// 1. 전역 상태 변수들
let selectedFile = null;
let selectedFileBase64 = null;
let selectedFileMime = "";
let currentConfig = getConfig();
let supabaseClient = null;
let guidelineText = ""; // 👴 120B 훈장님이 작성하신 수학 분류 지침서 저장소

// 기출 도서관 데이터 로컬 캐싱용 저장소
// (클라우드에서 한 번만 읽어와서 로컬에서 검색하므로 엄청 빠르고 요금이 안 나갑니다.)
let cachedLibraryQuestions = [];
let selectedSubjectFilter = "all";

// AI 지침서 (태그 추출용 프롬프트)
const PROMPT = `
이 이미지는 고등학교 수학 시험 기출문제입니다.
문제를 직접 풀지 말고, 이 문제의 수학적 본질을 잘 나타내는 태그(꼬리표)를 아래 JSON 형식으로 정확히 분석해서 반환해 주세요.

출력 JSON 형식:
{
  "subject": "수학 과목명 (예: 수학I, 수학II, 미적분, 확률과통계, 기하 중 하나)",
  "chapter": "구체적인 단원명 (대단원 및 중단원)",
  "concepts": ["사용되는 핵심 공식이나 구체적인 개념 2~4개"],
  "difficulty": "예상 난이도 및 배점 (예: 2점(하), 3점(중), 쉬운 4점(상), 어려운 4점(최상))"
}

🚨 주의사항:
1. 반드시 순수한 JSON 데이터만 한글로 출력해 주세요.
2. \`\`\`json 이나 \`\`\` 같은 마크다운 코드 블록 기호는 절대 붙이지 말고 순수한 텍스트로만 반환하세요.
3. 문제 외형(ㄱㄴㄷ 합답형, 빈칸 채우기 등)에 대한 태그는 유사도 비교에 전혀 의미가 없으므로 제외하세요.
`;

// 2. 화면 구성 요소들 (DOM Elements)
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const previewContainer = document.getElementById('previewContainer');
const previewImg = document.getElementById('previewImg');
const removeBtn = document.getElementById('removeBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const loadingBox = document.getElementById('loadingBox');
const resultTagsArea = document.getElementById('resultTagsArea');
const uploadedTags = document.getElementById('uploadedTags');
const emptyMessage = document.getElementById('emptyMessage');
const recommendList = document.getElementById('recommendList');

// [탭 전환 요소]
const navHomeBtn = document.getElementById('navHomeBtn');
const navLibraryBtn = document.getElementById('navLibraryBtn');
const homeTabSection = document.getElementById('homeTabSection');
const libraryTabSection = document.getElementById('libraryTabSection');

// [기출 도서관 요소]
const librarySearchInput = document.getElementById('librarySearchInput');
const libraryCount = document.getElementById('libraryCount');
const subjectFilterContainer = document.getElementById('subjectFilterContainer');
const libraryGrid = document.getElementById('libraryGrid');

// [설정 모달 관련 요소]
const configTrigger = document.getElementById('configTrigger');
const configModal = document.getElementById('configModal');
const closeConfigModal = document.getElementById('closeConfigModal');
const cfgSupabaseUrl = document.getElementById('cfgSupabaseUrl');
const cfgSupabaseKey = document.getElementById('cfgSupabaseKey');
const cfgGeminiKey = document.getElementById('cfgGeminiKey');
const cfgXaiKey = document.getElementById('cfgXaiKey');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const resetConfigBtn = document.getElementById('resetConfigBtn');

// [상세 비교/보기 모달 관련 요소]
const compareModal = document.getElementById('compareModal');
const closeCompareModal = document.getElementById('closeCompareModal');
const modalMainTitle = document.getElementById('modalMainTitle');
const modalCompareGrid = document.getElementById('modalCompareGrid');
const compareUploadedImg = document.getElementById('compareUploadedImg');
const compareMatchedImg = document.getElementById('compareMatchedImg');
const compareMatchTitle = document.getElementById('compareMatchTitle');
const compareMatchedTags = document.getElementById('compareMatchedTags');

const modalSingleGrid = document.getElementById('modalSingleGrid');
const singleQuestionImg = document.getElementById('singleQuestionImg');
const singleQuestionTags = document.getElementById('singleQuestionTags');

// 3. 앱 시작 시 초기화
async function autoLoadEnvKeys() {
    try {
        const response = await fetch('/.env');
        if (!response.ok) return;
        const text = await response.text();
        
        // 간단한 .env 파서 (텍스트 줄별 분석)
        const env = {};
        text.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const parts = trimmed.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim();
                env[key] = val;
            }
        });
        
        let changed = false;
        // 로컬 브라우저 저장소(localStorage)에 정보가 비어있을 때만 .env 파일에서 똑똑하게 가져오기
        if (env.SUPABASE_URL && !localStorage.getItem("MATH_SUPABASE_URL")) {
            localStorage.setItem("MATH_SUPABASE_URL", env.SUPABASE_URL);
            changed = true;
        }
        if (env.SUPABASE_KEY && !localStorage.getItem("MATH_SUPABASE_KEY")) {
            localStorage.setItem("MATH_SUPABASE_KEY", env.SUPABASE_KEY);
            changed = true;
        }
        if (env.GEMINI_API_KEY && !localStorage.getItem("MATH_GEMINI_KEY")) {
            localStorage.setItem("MATH_GEMINI_KEY", env.GEMINI_API_KEY);
            changed = true;
        }
        if (env.GROQ_API_KEY && !localStorage.getItem("MATH_XAI_KEY")) {
            localStorage.setItem("MATH_XAI_KEY", env.GROQ_API_KEY);
            changed = true;
        }
        
        if (changed) {
            console.log("🔑 로컬 .env 설정 파일에서 비밀 열쇠들을 자동으로 읽어와 브라우저에 등록했습니다!");
            currentConfig = getConfig();
        }
    } catch (e) {
        console.log("ℹ️ 로컬 .env 자동 로드 패스 (프로덕션 환경이거나 설정 파일 없음)");
    }
}

async function autoLoadGuideline() {
    try {
        const response = await fetch('/scripts/math_guideline.txt');
        if (response.ok) {
            guidelineText = await response.text();
            console.log("👴 수학 훈장님(GPT-OSS 120b)의 분류 지침서를 웹서비스에 탑재 완료했습니다.");
        }
    } catch (e) {
        console.warn("⚠️ 분류 지침서 동적 로드 실패 (기본 설정을 사용합니다):", e);
    }
}

async function initApp() {
    await autoLoadEnvKeys();
    await autoLoadGuideline();
    initSupabase();
    setupEventListeners();
    fillConfigForm();
}

// Supabase 클라이언트 연결 설정
function initSupabase() {
    if (currentConfig.supabaseUrl && currentConfig.supabaseKey) {
        supabaseClient = supabase.createClient(currentConfig.supabaseUrl, currentConfig.supabaseKey);
        console.log("⚡ Supabase 클라우드 사물함 연결 성공!");
    } else {
        console.error("❌ Supabase 연결 설정이 불완전합니다.");
    }
}

// 설정창에 기존 키 채우기
function fillConfigForm() {
    cfgSupabaseUrl.value = currentConfig.supabaseUrl || "";
    cfgSupabaseKey.value = currentConfig.supabaseKey || "";
    cfgGeminiKey.value = currentConfig.geminiApiKey || "";
    cfgXaiKey.value = currentConfig.xaiApiKey || "";
}

// 4. 이벤트 리스너 설정
function setupEventListeners() {
    // 톱니바퀴 설정창 모달 제어
    configTrigger.addEventListener('click', () => configModal.style.display = 'flex');
    closeConfigModal.addEventListener('click', () => configModal.style.display = 'none');
    
    saveConfigBtn.addEventListener('click', () => {
        saveConfig(cfgSupabaseUrl.value, cfgSupabaseKey.value, cfgGeminiKey.value, cfgXaiKey.value);
        currentConfig = getConfig();
        initSupabase();
        configModal.style.display = 'none';
        alert("💾 설정이 정상적으로 저장되었습니다!");
    });
    
    resetConfigBtn.addEventListener('click', () => {
        if(confirm("설정을 기본값으로 리셋하시겠습니까?")) {
            resetConfig();
            currentConfig = getConfig();
            fillConfigForm();
            initSupabase();
            alert("🔄 기본값으로 초기화되었습니다.");
        }
    });

    // [탭 전환 이벤트 바인딩]
    navHomeBtn.addEventListener('click', () => switchTab('home'));
    navLibraryBtn.addEventListener('click', () => switchTab('library'));

    // [기출 도서관 실시간 필터링 이벤트]
    librarySearchInput.addEventListener('input', applyLibraryFilters);
    
    // 과목 필터 칩 선택
    const chips = subjectFilterContainer.querySelectorAll('.filter-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', (e) => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedSubjectFilter = chip.getAttribute('data-subject');
            applyLibraryFilters();
        });
    });

    // 이미지 파일 업로드 드롭존
    uploadZone.addEventListener('click', () => fileInput.click());
    
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });
    
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetUploadState();
    });

    analyzeBtn.addEventListener('click', runAnalysis);
    closeCompareModal.addEventListener('click', () => compareModal.style.display = 'none');
}

// 5. 탭 전환 제어 로직 (리모컨 스위칭)
function switchTab(tabName) {
    if (tabName === 'home') {
        navHomeBtn.classList.add('active');
        navLibraryBtn.classList.remove('active');
        homeTabSection.classList.add('active');
        libraryTabSection.classList.remove('active');
        homeTabSection.style.display = 'grid';
        libraryTabSection.style.display = 'none';
    } else if (tabName === 'library') {
        navHomeBtn.classList.remove('active');
        navLibraryBtn.classList.add('active');
        homeTabSection.classList.remove('active');
        libraryTabSection.classList.add('active');
        homeTabSection.style.display = 'none';
        libraryTabSection.style.display = 'flex';
        
        // 기출문제 탭으로 전환될 때, 실시간으로 DB에서 전체 목록 로드
        loadAllLibraryQuestions();
    }
}

// 6. 기출문제 보관소 전체 데이터 로드 (클라우드에서 긁어오기)
async function loadAllLibraryQuestions() {
    if (!supabaseClient) {
        libraryGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:2rem; color:#ff5555;">
            ❌ 설정이 올바르지 않아 기출문제를 불러올 수 없습니다. 우측 상단 톱니바퀴를 눌러 정보를 입력해 주세요.
        </div>`;
        return;
    }

    // 로딩바 띄우기
    libraryGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:4rem 0;">
        <div class="spinner" style="margin: 0 auto 1.5rem auto;"></div>
        <p style="color: var(--text-secondary);">클라우드 기출 서가에서 문제를 불러오고 있습니다...</p>
    </div>`;

    try {
        const { data: questions, error } = await supabaseClient
            .from('questions')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        cachedLibraryQuestions = questions || [];
        if (libraryCount) {
            libraryCount.innerText = `(총 ${cachedLibraryQuestions.length}개)`;
        }
        applyLibraryFilters(); // 불러온 직후 필터(기본 '전체')를 입혀 나열합니다.
    } catch (err) {
        console.error("❌ 기출문제 로드 실패:", err);
        libraryGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:2rem; color:#ff5555;">
            ❌ 기출문제를 클라우드에서 불러오는 데 실패했습니다.
        </div>`;
    }
}

// 6-1. 기출문제 실시간 복합 필터링 및 렌더링
function applyLibraryFilters() {
    const searchText = librarySearchInput.value.toLowerCase().trim();
    
    // 두 조건(과목 필터 + 검색 텍스트)을 모두 통과하는 기출문제 필터링
    const filtered = cachedLibraryQuestions.filter(q => {
        const tags = q.tags || {};
        
        // 1. 과목 조건 검사
        let matchSubject = true;
        if (selectedSubjectFilter !== "all") {
            matchSubject = (tags.subject === selectedSubjectFilter);
        }
        
        // 2. 텍스트 검색 조건 검사 (파일명, 단원명, 과목명, 핵심 단어 중 포함된 것)
        let matchSearch = true;
        if (searchText) {
            const fileName = q.file_name.toLowerCase();
            const chapter = (tags.chapter || "").toLowerCase();
            const subject = (tags.subject || "").toLowerCase();
            const concepts = (tags.concepts || []).join(" ").toLowerCase();
            
            matchSearch = fileName.includes(searchText) || 
                          chapter.includes(searchText) || 
                          subject.includes(searchText) ||
                          concepts.includes(searchText);
        }
        
        return matchSubject && matchSearch;
    });

    renderLibraryGrid(filtered);
}

// 6-2. 기출문제 그리드 렌더링
function renderLibraryGrid(questionsList) {
    libraryGrid.innerHTML = "";

    if (questionsList.length === 0) {
        libraryGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:4rem 2rem; color:var(--text-secondary);">
            🔍 검색 조건과 일치하는 기출문제가 없습니다.
        </div>`;
        return;
    }

    questionsList.forEach(q => {
        const card = document.createElement('div');
        card.className = "question-card";
        
        const tags = q.tags || {};
        
        card.innerHTML = `
            <div class="card-header">
                <span>${q.exam_name}</span>
            </div>
            <div class="card-img-wrapper">
                <img src="${q.image_url}" alt="기출문제 이미지" class="card-img" onerror="this.src='https://placehold.co/400x300/f8f9fa/7b2cbf?text=No+Image'">
            </div>
            <div>
                <div style="font-size: 0.9rem; font-weight:600; margin-bottom:0.5rem; color:var(--text-primary);">
                    ${q.file_name.replace(".png", "")}
                </div>
                <div class="tag-container" style="gap: 0.25rem;">
                    <span class="tag subject" style="font-size:0.75rem; padding:0.2rem 0.4rem;">${tags.subject || "미분류"}</span>
                    <span class="tag" style="font-size:0.75rem; padding:0.2rem 0.4rem;">${tags.chapter || "미지정"}</span>
                    <span class="tag difficulty" style="font-size:0.75rem; padding:0.2rem 0.4rem;">${tags.difficulty || "배점미정"}</span>
                </div>
            </div>
        `;
        
        // 도서관에서 기출문제를 누르면 단독 상세보기 모드로 모달 열기
        card.addEventListener('click', () => openSingleViewModal(q));
        
        libraryGrid.appendChild(card);
    });
}

// 7. 파일 읽기 및 미리보기 처리
function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        alert("❌ 이미지 파일(jpg, png 등)만 업로드할 수 있습니다.");
        return;
    }
    
    selectedFile = file;
    selectedFileMime = file.type;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        selectedFileBase64 = e.target.result.split(',')[1];
        previewImg.src = e.target.result;
        
        uploadZone.style.display = 'none';
        previewContainer.style.display = 'block';
        analyzeBtn.disabled = false;
    };
    reader.readAsDataURL(file);
}

// 파일 업로드 상태 리셋
function resetUploadState() {
    selectedFile = null;
    selectedFileBase64 = null;
    selectedFileMime = "";
    fileInput.value = "";
    previewImg.src = "";
    uploadZone.style.display = 'flex';
    previewContainer.style.display = 'none';
    analyzeBtn.disabled = true;
    resultTagsArea.style.display = 'none';
    uploadedTags.innerHTML = "";
    
    recommendList.innerHTML = "";
    recommendList.style.display = 'none';
    emptyMessage.style.display = 'block';
}

// 8. 브라우저 실시간 AI 태깅 호출
async function runAnalysis() {
    if (!selectedFileBase64) return;
    
    analyzeBtn.disabled = true;
    loadingBox.style.display = 'flex';
    resultTagsArea.style.display = 'none';
    recommendList.style.display = 'none';
    emptyMessage.style.display = 'none';
    
    let tags = null;
    
    try {
        console.log("🔮 1번 메인 비서 Groq (Llama 4 Scout) 호출 중...");
        tags = await callGroqVisionAPI(selectedFileBase64);
        if (tags) {
            const confidence = parseInt(tags.confidence) || 100;
            const isAmbiguous = tags.is_ambiguous === true || tags.is_ambiguous === 'true';
            if (isAmbiguous || confidence < 70) {
                console.log(`✍️ 조수가 불확실해합니다. (확신도: ${confidence}점, 모호함: ${isAmbiguous})`);
                console.log("👴 수학 훈장님(GPT-OSS 120b)에게 빨간펜 최종 검수를 요청합니다...");
                tags = await callGpt120bAPI(tags);
            }
        }
    } catch (err) {
        console.warn("⚠️ Groq Llama 4 API 실패:", err);
    }
    
    if (!tags) {
        try {
            console.log("🔄 Groq 실패로 인한 2번 예비 비서 Gemini 2.5 Flash 호출 중...");
            tags = await callGeminiVisionAPI(selectedFileBase64, selectedFileMime);
        } catch (err) {
            console.error("❌ Gemini API 호출도 실패했습니다:", err);
        }
    }
    
    if (!tags) {
        alert("❌ 인공지능 비서들이 태그 분석에 모두 실패했습니다. API 키 설정이나 인터넷 연결을 확인해 주세요.");
        loadingBox.style.display = 'none';
        analyzeBtn.disabled = false;
        emptyMessage.style.display = 'block';
        return;
    }
    
    loadingBox.style.display = 'none';
    analyzeBtn.disabled = false;
    renderUploadedTags(tags);
    
    // 닮은꼴 기출 검색 가동
    await searchSimilarQuestions(tags);
}

// Gemini API Direct HTTP Call
async function callGeminiVisionAPI(base64Data, mimeType) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentConfig.geminiApiKey}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: PROMPT },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    }
                ]
            }]
        })
    });
    
    if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error ? errJson.error.message : "HTTP Error");
    }
    
    const result = await response.json();
    let text = result.candidates[0].content.parts[0].text.trim();
    
    if (text.startsWith("```json")) text = text.substring(7);
    if (text.startsWith("```")) text = text.substring(3);
    if (text.endsWith("```")) text = text.substring(0, text.length - 3);
    
    return JSON.parse(text.trim());
}

// Groq (Llama 4 Scout Vision) API Direct HTTP Call
async function callGroqVisionAPI(base64Data) {
    const url = `https://api.groq.com/openai/v1/chat/completions`;
    
    const groqPrompt = `
이 이미지는 고등학교 수학 시험 기출문제입니다.
문제를 직접 풀지 말고, 이 문제의 수학적 본질을 잘 나타내는 태그(꼬리표)를 아래 JSON 형식으로 정확히 분석해서 반환해 주세요.

반드시 아래 훈장님이 집필하신 '분류 지침서'를 철저히 참고하여 분류를 진행하세요.

[분류 지침서]
${guidelineText || "고등학교 수학 교육과정(수학I, 수학II, 미적분, 확률과통계, 기하) 기준에 따라 정확하게 태깅해 주세요."}

출력 JSON 형식:
{
  "subject": "수학 과목명 (예: 수학I, 수학II, 미적분, 확률과통계, 기하 중 하나)",
  "chapter": "구체적인 단원명 (대단원 및 중단원)",
  "concepts": ["사용되는 핵심 공식이나 구체적인 개념 2~4개"],
  "difficulty": "예상 난이도 및 배점 (예: 2점(하), 3점(중), 쉬운 4점(상), 어려운 4점(최상))",
  "problem_text": "수학 문제 이미지에서 판독해 낸 수식과 한글 문제 전문(OCR)",
  "confidence": 85,
  "is_ambiguous": false
}

🚨 주의사항:
1. 반드시 순수한 JSON 데이터만 한글로 출력해 주세요.
2. \`\`\`json 이나 \`\`\` 같은 마크다운 코드 블록 기호는 절대 붙이지 말고 순수한 텍스트로만 반환하세요.
3. 문제 외형(ㄱㄴㄷ 합답형, 빈칸 채우기 등)에 대한 태그는 유사도 비교에 전혀 의미가 없으므로 제외하세요.
`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentConfig.xaiApiKey}`
        },
        body: JSON.stringify({
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: groqPrompt },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/png;base64,${base64Data}`
                        }
                    }
                ]
            }],
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            temperature: 0.1
        })
    });
    
    if (!response.ok) {
        throw new Error("Groq HTTP Error");
    }
    
    const result = await response.json();
    let text = result.choices[0].message.content.strip ? result.choices[0].message.content.strip() : result.choices[0].message.content.trim();
    
    if (text.startsWith("```json")) text = text.substring(7);
    if (text.startsWith("```")) text = text.substring(3);
    if (text.endsWith("```")) text = text.substring(0, text.length - 3);
    
    return JSON.parse(text.trim());
}

// GPT-OSS 120b (수학 훈장님) 최종 검수 API Direct HTTP Call
async function callGpt120bAPI(ambiguousTags) {
    const url = `https://api.groq.com/openai/v1/chat/completions`;
    
    const prompt120b = `
너는 1200억 개의 뇌세포를 지닌 최고의 수학 훈장님이자 교육과정 설계 전문가이다.
견습생 조수 비서가 고등학교 수학 기출문제 이미지로부터 추출한 아래 수학 문제의 텍스트 전문과, 조수가 임시로 지정해 둔 꼬리표(태그) 정보가 있다.

조수가 확신하지 못하거나(Confidence 점수 낮음) 혹은 단원이 모호하다고 판단한 상황이다.
이 문제의 텍스트 전문을 읽고 교육과정에 가장 정확히 부합하도록 최종 태깅 결과를 정제해서 다시 반환해 다오.

[조수가 판독한 문제 텍스트 전문]
${ambiguousTags.problem_text || '텍스트 판독 실패'}

[조수가 임시로 붙여둔 꼬리표]
- 과목: ${ambiguousTags.subject}
- 단원: ${ambiguousTags.chapter}
- 핵심 개념: ${ambiguousTags.concepts}
- 예상 난이도: ${ambiguousTags.difficulty}

출력 JSON 형식:
{
  "subject": "수학 과목명 (예: 수학I, 수학II, 미적분, 확률과통계, 기하 중 하나)",
  "chapter": "구체적인 단원명 (대단원 및 중단원)",
  "concepts": ["사용되는 핵심 공식이나 구체적인 개념 2~4개"],
  "difficulty": "예상 난이도 및 배점 (예: 2점(하), 3점(중), 쉬운 4점(상), 어려운 4점(최상))"
}

🚨 주의사항:
1. 반드시 순수한 JSON 데이터만 한글로 출력해 주세요.
2. \`\`\`json 이나 \`\`\` 같은 마크다운 코드 블록 기호는 절대 붙이지 말고 순수한 텍스트로만 반환하세요.
`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentConfig.xaiApiKey}`
        },
        body: JSON.stringify({
            messages: [{
                role: "user",
                content: prompt120b
            }],
            model: "openai/gpt-oss-120b",
            temperature: 0.2
        })
    });
    
    if (!response.ok) {
        throw new Error("120b API HTTP Error");
    }
    
    const result = await response.json();
    let text = result.choices[0].message.content.trim();
    
    if (text.startsWith("```json")) text = text.substring(7);
    if (text.startsWith("```")) text = text.substring(3);
    if (text.endsWith("```")) text = text.substring(0, text.length - 3);
    
    const finalTags = JSON.parse(text.trim());
    finalTags.problem_text = ambiguousTags.problem_text || "";
    finalTags.confidence = 100;
    finalTags.is_ambiguous = false;
    
    console.log("👴 [3단계 훈장님 최종 판정 완료]", finalTags);
    return finalTags;
}

// 내 문제 분석 태그 렌더링
function renderUploadedTags(tags) {
    resultTagsArea.style.display = 'block';
    uploadedTags.innerHTML = "";
    
    const subjectTag = document.createElement('span');
    subjectTag.className = "tag subject";
    subjectTag.innerText = tags.subject;
    uploadedTags.appendChild(subjectTag);
    
    const chapterTag = document.createElement('span');
    chapterTag.className = "tag";
    chapterTag.innerText = tags.chapter;
    uploadedTags.appendChild(chapterTag);
    
    if (tags.concepts) {
        tags.concepts.forEach(c => {
            const tag = document.createElement('span');
            tag.className = "tag";
            tag.innerText = c;
            uploadedTags.appendChild(tag);
        });
    }
    
    const diffTag = document.createElement('span');
    diffTag.className = "tag difficulty";
    diffTag.innerText = tags.difficulty;
    uploadedTags.appendChild(diffTag);
}

// 닮은꼴 기출문제 정밀 매칭 검색 (가중치 방식)
async function searchSimilarQuestions(uploadedTagsData) {
    if (!supabaseClient) {
        alert("Supabase 클라이언트가 초기화되지 않았습니다.");
        return;
    }
    
    try {
        const { data: questions, error } = await supabaseClient
            .from('questions')
            .select('*');
            
        if (error) throw error;
        
        if (!questions || questions.length === 0) {
            recommendList.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 2rem; color: var(--text-secondary);">
                📚 클라우드 기출 서가에 등록된 문제가 아직 없습니다.
            </div>`;
            recommendList.style.display = 'grid';
            return;
        }
        
        const scoredQuestions = questions.map(q => {
            let score = 0;
            const qTags = q.tags || {};
            
            if (qTags.subject && qTags.subject === uploadedTagsData.subject) {
                score += 20;
            }
            
            if (qTags.chapter && qTags.chapter === uploadedTagsData.chapter) {
                score += 30;
            } else if (qTags.chapter && uploadedTagsData.chapter && 
                       (qTags.chapter.includes(uploadedTagsData.chapter) || uploadedTagsData.chapter.includes(qTags.chapter))) {
                score += 15;
            }
            
            if (qTags.concepts && uploadedTagsData.concepts) {
                const intersect = qTags.concepts.filter(c => uploadedTagsData.concepts.includes(c));
                score += (intersect.length * 15);
            }
            
            if (qTags.difficulty && qTags.difficulty === uploadedTagsData.difficulty) {
                score += 10;
            }
            
            return { question: q, score: score };
        });
        
        const topMatches = scoredQuestions
            .filter(item => item.score > 10)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(item => item.question);
            
        renderRecommendList(topMatches, uploadedTagsData);
    } catch (err) {
        console.error("🔍 유사 기출 매칭 실패:", err);
        recommendList.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 2rem; color: #ff5555;">
            ❌ 기출문제를 불러오고 비교하는 데 실패했습니다.
        </div>`;
        recommendList.style.display = 'grid';
    }
}

// 추천 리스트 그리기
function renderRecommendList(matches, uploadedTagsData) {
    recommendList.innerHTML = "";
    
    if (matches.length === 0) {
        recommendList.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 4rem 2rem; color: var(--text-secondary);">
            🔍 분석된 수학 개념과 일치하는 유사 기출문제를 찾지 못했습니다.
        </div>`;
        recommendList.style.display = 'grid';
        return;
    }
    
    matches.forEach((q, index) => {
        const card = document.createElement('div');
        card.className = "question-card";
        
        const medals = ["🥇 1순위 추천", "🥈 2순위 추천", "🥉 3순위 추천"];
        const tags = q.tags || {};
        
        card.innerHTML = `
            <div class="card-header">
                <span>${medals[index] || "추천 기출"}</span>
                <span>${q.exam_name}</span>
            </div>
            <div class="card-img-wrapper">
                <img src="${q.image_url}" alt="기출문제 이미지" class="card-img" onerror="this.src='https://placehold.co/400x300/f8f9fa/7b2cbf?text=No+Image'">
            </div>
            <div>
                <div style="font-size: 0.9rem; font-weight:600; margin-bottom:0.5rem; color:var(--text-primary);">
                    ${q.file_name.replace(".png", "")}
                </div>
                <div class="tag-container" style="gap: 0.25rem;">
                    <span class="tag subject" style="font-size:0.75rem; padding:0.2rem 0.4rem;">${tags.subject || "미분류"}</span>
                    <span class="tag" style="font-size:0.75rem; padding:0.2rem 0.4rem;">${tags.chapter || "미지정"}</span>
                    <span class="tag difficulty" style="font-size:0.75rem; padding:0.2rem 0.4rem;">${tags.difficulty || "배점미정"}</span>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => openCompareModal(q, uploadedTagsData));
        recommendList.appendChild(card);
    });
    
    recommendList.style.display = 'grid';
}

// 9-1. [홈 전용] 1:1 비교 모달창 열기
function openCompareModal(matchedQuestion, uploadedTagsData) {
    // 칠판 스위칭: 비교용 그리드 켜고, 단독보기 끄기
    modalCompareGrid.style.display = 'grid';
    modalSingleGrid.style.display = 'none';
    modalMainTitle.innerHTML = `<i class="fa-solid fa-code-compare"></i> 문항 정밀 비교하기`;

    compareUploadedImg.src = previewImg.src;
    compareMatchedImg.src = matchedQuestion.image_url;
    compareMatchTitle.innerText = `${matchedQuestion.exam_name} - ${matchedQuestion.file_name.replace(".png", "")}`;
    
    compareMatchedTags.innerHTML = "";
    const tags = matchedQuestion.tags || {};
    
    const subjectTag = document.createElement('span');
    subjectTag.className = "tag subject";
    subjectTag.innerText = tags.subject || "미분류";
    compareMatchedTags.appendChild(subjectTag);
    
    const chapterTag = document.createElement('span');
    chapterTag.className = "tag";
    chapterTag.innerText = tags.chapter || "미지정";
    compareMatchedTags.appendChild(chapterTag);
    
    if (tags.concepts) {
        tags.concepts.forEach(c => {
            const tag = document.createElement('span');
            tag.className = "tag";
            tag.innerText = c;
            compareMatchedTags.appendChild(tag);
        });
    }
    
    const diffTag = document.createElement('span');
    diffTag.className = "tag difficulty";
    diffTag.innerText = tags.difficulty || "배점미정";
    compareMatchedTags.appendChild(diffTag);
    
    compareModal.style.display = 'flex';
}

// 9-2. [도서관 전용] 기출문제 단독 상세보기 모달창 열기
function openSingleViewModal(question) {
    // 칠판 스위칭: 비교용 그리드 끄고, 단독보기 켜기
    modalCompareGrid.style.display = 'none';
    modalSingleGrid.style.display = 'flex';
    modalMainTitle.innerHTML = `<i class="fa-solid fa-book-open"></i> 기출문제 상세 보기`;

    singleQuestionImg.src = question.image_url;
    
    // 단독 상세 모달 타이틀 및 태그 채우기
    compareMatchTitle.innerText = ""; // 비교 타이틀 비우기
    singleQuestionTags.innerHTML = "";
    
    const tags = question.tags || {};
    
    // 시험지 및 파일명 정보를 알려주는 카드 타이틀 추가
    const titleTag = document.createElement('div');
    titleTag.style = "width: 100%; text-align: center; font-weight:700; font-size:1.1rem; color: var(--text-primary); margin-bottom: 0.5rem;";
    titleTag.innerText = `[${question.exam_name}] ${question.file_name.replace(".png", "")}`;
    singleQuestionTags.appendChild(titleTag);
    
    const tagWrapper = document.createElement('div');
    tagWrapper.className = "tag-container";
    tagWrapper.style.justifyContent = "center";
    
    const subjectTag = document.createElement('span');
    subjectTag.className = "tag subject";
    subjectTag.innerText = tags.subject || "미분류";
    tagWrapper.appendChild(subjectTag);
    
    const chapterTag = document.createElement('span');
    chapterTag.className = "tag";
    chapterTag.innerText = tags.chapter || "미지정";
    tagWrapper.appendChild(chapterTag);
    
    if (tags.concepts) {
        tags.concepts.forEach(c => {
            const tag = document.createElement('span');
            tag.className = "tag";
            tag.innerText = c;
            tagWrapper.appendChild(tag);
        });
    }
    
    const diffTag = document.createElement('span');
    diffTag.className = "tag difficulty";
    diffTag.innerText = tags.difficulty || "배점미정";
    tagWrapper.appendChild(diffTag);
    
    singleQuestionTags.appendChild(tagWrapper);
    
    compareModal.style.display = 'flex';
}

// 앱 실행
document.addEventListener('DOMContentLoaded', initApp);
