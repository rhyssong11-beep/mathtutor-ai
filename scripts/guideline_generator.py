import os
import sys
from openai import OpenAI
from dotenv import load_dotenv

# 1. 설정 로드 (.env 수첩 읽기)
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    print("❌ 에러: .env 파일에 GROQ_API_KEY 설정이 없습니다.")
    sys.exit(1)

# 2. Groq 클라이언트 생성
client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1"
)

# 3. 훈장님(120B)에게 전달할 질문서 작성
PROMPT = """
너는 1200억 개의 뇌세포를 지닌 최고의 수학 훈장님이자 교육과정 설계 전문가이다.
우리는 고등학교 수학 기출문제 이미지들을 읽고 자동으로 과목, 대단원/중단원, 핵심 개념, 그리고 난이도를 자동으로 태깅(꼬리표 달기)하는 AI 시스템을 운영 중이다.

시력이 좋지만 아직 교육과정에 미숙한 조수 비서(Vision AI)가 수학 문제의 텍스트와 그림을 보고 정확하게 태그를 분류할 수 있도록, 아주 구체적이고 체계적인 '수학 분류 지침서(가이드라인)'를 집필해 다오.

지침서에는 아래 사항들이 반드시 포함되어야 한다:

1. **분류 대상 과목 및 대/중단원 트리**:
   - 수학I (지수함수와 로그함수, 삼각함수, 수열)
   - 수학II (함수의 극한과 연속, 다항함수의 미분법, 다항함수의 적분법)
   - 미적분 (수열의 극한, 여러 가지 함수의 미분법, 여러 가지 함수의 적분법)
   - 확률과 통계 (경우의 수, 확률, 통계)
   - 기하 (이차곡선, 평면벡터, 공간도형과 공간좌표)

2. **난이도 및 배점 분류 기준**:
   - 2점(하): 기본 계산이나 공식 대입만으로 10초 이내에 풀리는 문제
   - 3점(중): 개념을 1~2개 융합했거나 간단한 계산 능력이 필요한 수준
   - 쉬운 4점(상): 단원 통합형이거나 출제 의도를 해석해야 풀리는 4점짜리 문제
   - 어려운 4점(최상): 수능 및 모의고사 15번, 22번, 30번 등 고도의 추론과 여러 단계의 수식을 요구하는 킬러/준킬러 문제

3. **과목별 대표 문항 예시 (Few-shot 예제) 총 5개 이상**:
   - 조수가 참고할 수 있도록 각 과목당 대표적인 형태의 문제 묘사와, 그에 매칭되는 정밀 JSON 태그 예시를 적어다오.

지침서의 어조는 단호하고 명쾌해야 하며, 조수가 헷갈리지 않게 한글로 정밀하게 써다오.
"""

def main():
    print("👴 훈장님(GPT-OSS 120b)에게 수학 분류 지침서 집필을 요청합니다...")
    
    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": PROMPT
                }
            ],
            model="openai/gpt-oss-120b",
            temperature=0.3
        )
        
        guideline_content = chat_completion.choices[0].message.content
        
        # 파일 저장 경로 설정
        output_path = os.path.join(os.path.dirname(__file__), "math_guideline.txt")
        
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(guideline_content)
            
        print(f"✅ 지침서 집필 완료! 파일이 생성되었습니다: {output_path}")
        print("\n--- [지침서 앞부분 미리보기] ---")
        lines = guideline_content.split("\n")
        print("\n".join(lines[:15]))
        print("-------------------------------")
        
    except Exception as e:
        print(f"❌ 훈장님 지침서 집필 실패: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
