import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client

# 환경 변수 로드
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ 에러: .env 설정 파일에서 Supabase 정보를 읽을 수 없습니다.")
    sys.exit(1)

# 클라이언트 연결
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def clear_questions_table():
    print("🧹 데이터베이스 청소 작업을 시작합니다...")
    try:
        # 데이터베이스의 모든 행(row)을 삭제합니다.
        # id가 null이 아닌 모든 항목을 삭제하도록 조건을 부여합니다.
        response = supabase.table("questions").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        deleted_count = len(response.data) if response.data else 0
        print(f"✅ 청소 완료! 총 {deleted_count}개의 기출문제 정보를 서랍장에서 비웠습니다.")
    except Exception as e:
        print(f"❌ 청소 중 에러 발생: {e}")

if __name__ == "__main__":
    # 안전 장치: 실행 의사 묻기
    confirm = input("⚠️ 정말로 데이터베이스의 질문 데이터를 전부 삭제하시겠습니까? (y/n): ")
    if confirm.lower() == 'y':
        clear_questions_table()
    else:
        print("🚫 취소되었습니다.")
