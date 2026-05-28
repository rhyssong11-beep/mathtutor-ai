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
GROQ_API_KEY = os.getenv("GROQ_API_KEY") # 진짜 Groq API 키 (gsk_...)

# 필수 정보 확인
if not all([SUPABASE_URL, SUPABASE_KEY, GEMINI_API_KEY, GROQ_API_KEY]):
    print("❌ 에러: .env 파일에 필요한 설정 정보(Supabase URL/Key, Gemini/Groq API Key)가 부족합니다.")
    sys.exit(1)

# 2. 클라이언트 초기화 (클라우드 사물함 및 AI 비서 호출 준비)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# google.generativeai SDK 설정
genai.configure(api_key=GEMINI_API_KEY)

# Groq 클라이언트 설정 (LPU 번개 번역기)
groq_client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1"
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
    """예비 비서인 Gemini 2.5 Flash를 사용하여 초정밀 태그를 얻습니다."""
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
        if "429" in err_msg or "Quota exceeded" in err_msg:
            raise ValueError(f"RATE_LIMIT: 구글 한도 초과 발생 ({err_msg})")
        print(f"⚠️ Gemini 태깅 일시 에러: {e}")
        return None

def get_math_tags_via_groq(image_path):
    """메인 비서인 Groq(Llama 4 Scout Vision)를 사용하여 초정밀 태그를 얻습니다."""
    try:
        with open(image_path, "rb") as image_file:
            base64_image = base64.b64encode(image_file.read()).decode('utf-8')
            
        chat_completion = groq_client.chat.completions.create(
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
            model="meta-llama/llama-4-scout-17b-16e-instruct",
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
        err_msg = str(e)
        # Groq 역시 한도 초과(429)나 오류 시 예외 상위 전달
        if "permission" in err_msg or "credits" in err_msg or "429" in err_msg or "limit" in err_msg:
            raise ValueError(f"GROQ_ERROR: Groq API 장애 또는 한도 초과 ({err_msg})")
        print(f"⚠️ Groq 태깅 일시 실패: {e}")
        return None

def upload_image_to_storage_by_id(file_path, question_id):
    """이미지 파일을 영문 고유 ID명(UUID.png)으로 Storage 버킷 'question-images'에 업로드합니다."""
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
                time.sleep(5)
                
    return f"{SUPABASE_URL}/storage/v1/object/public/question-images/{question_id}.png"

def process_single_question_with_retry(file_path):
    """단일 문제를 분석, 업로드, DB 저장합니다. (xAI Grok을 우선 호출하며, 장애 시 Gemini로 우회)"""
    parts = file_path.split(os.sep)
    file_name = parts[-1]
    exam_name = parts[-2]
    
    clean_exam = unicodedata.normalize('NFC', exam_name)
    clean_file = unicodedata.normalize('NFC', file_name)
    
    for db_attempt in range(3):
        try:
            existing = supabase.table("questions").select("id").eq("exam_name", clean_exam).eq("file_name", clean_file).execute()
            if existing.data:
                print(f"⏭️ 건너뜀 (이미 저장됨): {clean_exam} -> {clean_file}")
                return "skipped"
            break
        except Exception as db_err:
            print(f"⚠️ DB 조회 오류 (시도 {db_attempt+1}/3): {db_err}")
            if db_attempt == 2:
                time.sleep(10)
                return False
            time.sleep(3)
            
    print(f"📖 처리 중: {clean_exam} -> {clean_file}")
    
    tags = None
    question_id = str(uuid.uuid4())
    
    while True:
        try:
            # 🚨 1순위 메인 비서: Groq 호출!
            print("🔮 1번 비서 Groq (Llama 4 Scout) 호출 중...")
            tags = get_math_tags_via_groq(file_path)
            if tags:
                break
                
            # 🚨 2순위 예비 비서: Gemini 호출!
            print("🔄 1번 비서 실패로 인해, 2번 비서 Gemini 2.5 Flash로 교대합니다...")
            tags = get_math_tags_via_gemini(file_path)
            if tags:
                break
                
            print("⚠️ 두 AI 비서가 모두 대답하지 못했습니다. 10초 후 재시도합니다.")
            time.sleep(10)
        except ValueError as val_err:
            err_msg = str(val_err)
            if "GROQ_ERROR" in err_msg:
                # Groq 사용 불가 시 경고를 출력하고 Gemini로 강제 우회 시도
                print(f"⏳ Groq 경고: {err_msg}")
                print("🔄 Groq 사용이 불가능하여, 예비 비서인 구글 Gemini로 긴급 우회 호출합니다...")
                try:
                    tags = get_math_tags_via_gemini(file_path)
                    if tags:
                        break
                except Exception as gemini_err:
                    print(f"⚠️ Gemini 우회 호출도 실패: {gemini_err}")
                
                print("⚠️ 모든 비서 작동 불가. 60초 대기 후 이어서 재시도합니다.")
                time.sleep(60)
            elif "RATE_LIMIT" in err_msg:
                print(f"⏳ 구글 한도 초과 감지! 60초 동안 대기 후 이어서 작업합니다...")
                time.sleep(60)
        except Exception as net_err:
            print(f"⚠️ 네트워크 오류: {net_err}. 10초 후 재시도합니다...")
            time.sleep(10)

    # 3. 이미지 업로드
    public_url = upload_image_to_storage_by_id(file_path, question_id)
    
    # 4. DB 저장
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
        
        result = None
        while not result:
            result = process_single_question_with_retry(file_path)
            if not result:
                print("🔄 작업 오류로 10초 후 재실행합니다...")
                time.sleep(10)
                
        if result == "skipped":
            continue
            
        success_count += 1
            
        elapsed = time.time() - start_time
        if elapsed < 5.0:
            time.sleep(5.0 - elapsed)
            
    print("\n==========================================")
    print("🎉 모든 기출문제 업로드 및 태깅 작업 완료!")
    print(f"📊 최종 결과 - 성공: {success_count}개, 실패: {fail_count}개")
    print("==========================================")

if __name__ == "__main__":
    main()
