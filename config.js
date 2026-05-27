// ==========================================
// 수학 문제 유사 기출 추천 서비스 (MathTutor AI)
// 브라우저 설정 관리 모듈 (config.js) - 보안 강화형
// ==========================================

// 1. 기본 설정 정보 (보안을 위해 기본 API 키는 공란으로 비워둡니다.)
// (최초 접속 시 우측 상단 톱니바퀴 아이콘을 눌러 API 키를 입력해 주셔야 작동합니다.)
const DEFAULT_CONFIG = {
    supabaseUrl: "https://oggakivtdumfgzwdjewc.supabase.co",
    supabaseKey: "sb_publishable_TWkKWycSA6avmbT0BuuppQ_OiePKgFT",
    geminiApiKey: "", // 🔒 보안을 위해 깃허브 업로드 전 공란 처리
    xaiApiKey: ""     // 🔒 보안을 위해 깃허브 업로드 전 공란 처리
};

// 2. 브라우저 저장소(localStorage)에서 키값 가져오기
export function getConfig() {
    return {
        supabaseUrl: localStorage.getItem("MATH_SUPABASE_URL") || DEFAULT_CONFIG.supabaseUrl,
        supabaseKey: localStorage.getItem("MATH_SUPABASE_KEY") || DEFAULT_CONFIG.supabaseKey,
        geminiApiKey: localStorage.getItem("MATH_GEMINI_KEY") || DEFAULT_CONFIG.geminiApiKey,
        xaiApiKey: localStorage.getItem("MATH_XAI_KEY") || DEFAULT_CONFIG.xaiApiKey
    };
}

// 3. 브라우저 저장소에 새로운 키값 저장하기
export function saveConfig(supabaseUrl, supabaseKey, geminiApiKey, xaiApiKey) {
    if (supabaseUrl) localStorage.setItem("MATH_SUPABASE_URL", supabaseUrl.trim());
    if (supabaseKey) localStorage.setItem("MATH_SUPABASE_KEY", supabaseKey.trim());
    if (geminiApiKey) localStorage.setItem("MATH_GEMINI_KEY", geminiApiKey.trim());
    if (xaiApiKey) localStorage.setItem("MATH_XAI_KEY", xaiApiKey.trim());
    
    console.log("💾 설정 값이 로컬 브라우저에 안전하게 저장되었습니다.");
}

// 4. 저장된 설정을 기본값으로 리셋하기
export function resetConfig() {
    localStorage.removeItem("MATH_SUPABASE_URL");
    localStorage.removeItem("MATH_SUPABASE_KEY");
    localStorage.removeItem("MATH_GEMINI_KEY");
    localStorage.removeItem("MATH_XAI_KEY");
    console.log("🔄 설정이 기본값으로 리셋되었습니다.");
}
