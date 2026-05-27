import os
import sys
import glob
import time
import json
import base64
import uuid
import urllib.parse
import unicodedata
from PIL import Image
from dotenv import load_dotenv
from supabase import create_client, Client
import google.generativeai as genai
from openai import OpenAI

# 1. 환경 변수 로드 (.env 메모장 읽기)
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY") # xAI (Grok) API 키

# 필수 정보 확인
if not all([SUPABASE_URL, SUPABASE_KEY, GEMINI_API_KEY, GROQ_API_KEY]):
    print("❌ 에러: .env 파일에 필요한 설정 정보(Supabase URL/Key, Gemini/Grok API Key)가 부족합니다.")
    sys.exit(1)

# 2. 클라이언트 초기화 (클라우드 사물함 및 AI 비서 호출 준비)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# google.generativeai SDK 설정
genai.configure(api_key=GEMINI_API_KEY)

# xAI (Grok) 클라이언트 설정 (크레딧 부족 시 에러 방지를 위해 기본 세팅 유지)
xai_client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.x.ai/v1"
)

# 3. AI 분석을 위한 프롬프트 (정밀 꼬리표 추출 지침서)
PROMPT = """
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
2. ```json 이나 ``` 같은 마크다운 코드 블록 기호는 절대 붙이지 말고 순수한 텍스트로만 반환하세요.
3. 문제 외형(ㄱㄴㄷ 합답형, 빈칸 채우기 등)에 대한 태그는 유사도 비교에 전혀 의미가 없으므로 제외하세요.
"""

def get_math_tags_via_gemini(image_path):
    """메인 비서인 Gemini 2.5 Flash를 사용하여 초정밀 태그를 얻습니다."""
    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        img = Image.open(image_path)
        
        response = model.generate_content([PROMPT, img])
        text = response.text.strip()
        
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
            
        return json.loads(text.strip())
    except Exception as e:
        err_msg = str(e)
        # 429 Quota Exceeded (요청 초과) 에러가 감지되면, 예외 상위로 명시적으로 전달
        if "429" in err_msg or "Quota exceeded" in err_msg:
            raise ValueError(f"RATE_LIMIT: 구글 한도 초과 발생 ({err_msg})")
        print(f"⚠️ Gemini 태깅 일시 에러: {e}")
        return None

def get_math_tags_via_xai(image_path):
    """예비 비서인 xAI(Grok 2 Vision)를 사용하여 초정밀 태그를 얻습니다."""
    try:
        with open(image_path, "rb") as image_file:
            base64_image = base64.b64encode(image_file.read()).decode('utf-8')
            
        chat_completion = xai_client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{base64_image}",
                            },
                        },
                    ],
                }
            ],
            model="grok-2-vision-1212",
            temperature=0.1
        )
        
        text = chat_completion.choices[0].message.content.strip()
        
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
            
        return json.loads(text.strip())
    except Exception as e:
        print(f"⚠️ xAI(Grok) 태깅 실패 (크레딧 충전 필요): {e}")
        return None

def upload_image_to_storage_by_id(file_path, question_id):
    """이미지 파일을 영문 고유 ID명(UUID.png)으로 Storage 버킷 'question-images'에 업로드합니다. (네트워크 지연 시 3회 재시도)"""
    storage_path = f"{question_id}.png"
    
    for attempt in range(3):
        try:
            with open(file_path, 'rb') as f:
                res = supabase.storage.from_("question-images").upload(
                    file=f,
                    path=storage_path,
                    file_options={"cache-control": "3600", "upsert": "true"}
                )
            return f"{SUPABASE_URL}/storage/v1/object/public/question-images/{question_id}.png"
        except Exception as e:
            print(f"⚠️ 이미지 업로드 시도 {attempt+1}/3 실패: {e}")
            if attempt < 2:
                time.sleep(5) # 네트워크 불안정 시 5초 후 재시도
                
    return f"{SUPABASE_URL}/storage/v1/object/public/question-images/{question_id}.png"

def process_single_question_with_retry(file_path):
    """단일 문제를 분석, 업로드, DB 저장합니다. (네트워크 단절 및 API 한도 초과 시 끈질긴 무한 재시도 루프 작동)"""
    parts = file_path.split(os.sep)
    file_name = parts[-1]
    exam_name = parts[-2]
    
    clean_exam = unicodedata.normalize('NFC', exam_name)
    clean_file = unicodedata.normalize('NFC', file_name)
    
    # 1. DB에 이미 등록되어 있는지 확인 (네트워크 끊김 대비 3회 재시도)
    for db_attempt in range(3):
        try:
            existing = supabase.table("questions").select("id").eq("exam_name", clean_exam).eq("file_name", clean_file).execute()
            if existing.data:
                print(f"⏭️ 건너뜀 (이미 저장됨): {clean_exam} -> {clean_file}")
                return True
            break
        except Exception as db_err:
            print(f"⚠️ DB 조회 오류 (시도 {db_attempt+1}/3): {db_err}")
            if db_attempt == 2:
                # 3회 연속 실패 시 인터넷 단절로 간주하고 10초 대기 후 함수 다시 실행
                time.sleep(10)
                return False
            time.sleep(3)
            
    print(f"📖 처리 중: {clean_exam} -> {clean_file}")
    
    # 2. AI 태깅 (Gemini 429 Quota 에러 시 60초 대기 후 무한 재시도)
    tags = None
    question_id = str(uuid.uuid4())
    
    while True:
        try:
            tags = get_math_tags_via_gemini(file_path)
            if tags:
                break # 태깅 성공 시 루프 탈출!
                
            # 일반적인 에러(인식 오류 등)의 경우 Grok으로 우회
            print("🔄 Gemini가 일시 실패하여, xAI (Grok) 비서로 교대 시도합니다...")
            tags = get_math_tags_via_xai(file_path)
            if tags:
                break
                
            print("⚠️ 두 AI 비서가 모두 대답하지 못했습니다. 10초 후 재시도합니다.")
            time.sleep(10)
        except ValueError as val_err:
            # 🚨 429 Quota Exceeded 한도 초과 감지 시
            print(f"⏳ 구글 무료 한도 초과 감지! AI 비서가 쉬는 중입니다. 60초 동안 대기 후 이어서 작업합니다...")
            time.sleep(60) # 1분 쉬어주기
        except Exception as net_err:
            # 일반 네트워크 오류
            print(f"⚠️ 네트워크 일시 차단: {net_err}. 10초 후 재시도합니다...")
            time.sleep(10)

    # 3. 이미지 업로드
    public_url = upload_image_to_storage_by_id(file_path, question_id)
    
    # 4. DB 저장 (네트워크 단절 대비 3회 재시도)
    data = {
        "id": question_id,
        "exam_name": clean_exam,
        "file_name": clean_file,
        "image_url": public_url,
        "tags": tags
    }
    
    for insert_attempt in range(3):
        try:
            supabase.table("questions").insert(data).execute()
            print(f"✅ 저장 완료: {tags['subject']} > {tags['chapter']} | 난이도: {tags['difficulty']}")
            return True
        except Exception as e:
            print(f"❌ DB 저장 오류 (시도 {insert_attempt+1}/3): {e}")
            if insert_attempt == 2:
                time.sleep(10)
                return False
            time.sleep(3)

def main():
    base_dir = "/Users/yunikon/Downloads/extracted_questions"
    # 모든 png 파일 찾기
    image_files = glob.glob(os.path.join(base_dir, "**", "*.png"), recursive=True)
    total_files = len(image_files)
    
    print(f"📂 총 {total_files}개의 기출문제 이미지를 스캔했습니다.")
    print("🚀 자동 태깅 및 클라우드 업로드 작업을 시작합니다...")
    
    success_count = 0
    fail_count = 0
    
    for idx, file_path in enumerate(image_files, 1):
        print(f"\n--- [{idx}/{total_files} | 성공 {success_count} / 실패 {fail_count}] ---")
        
        start_time = time.time()
        
        # 끈질긴 업로드 수행 (성공할 때까지 재시도하므로 무조건 True를 반환하게 됨)
        success = False
        while not success:
            success = process_single_question_with_retry(file_path)
            if not success:
                print("🔄 작업 오류로 10초 후 재실행합니다...")
                time.sleep(10)
                
        success_count += 1
            
        # 무료 API 한도(RPM)를 고려해 최소 5초의 안전 텀을 둡니다. (Rate Limit 예방)
        elapsed = time.time() - start_time
        if elapsed < 5.0:
            time.sleep(5.0 - elapsed)
            
    print("\n==========================================")
    print("🎉 모든 기출문제 업로드 및 태깅 작업 완료!")
    print(f"📊 최종 결과 - 성공: {success_count}개, 실패: {fail_count}개")
    print("==========================================")

if __name__ == "__main__":
    main()
