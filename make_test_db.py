"""
잇다 (Itda) - Windows 검증용 테스트 DB 생성기

실제 병원 데이터(assistant.db)를 검증 안 된 새 PC에 옮기기 전에,
가짜 데이터로 llm_queue/itda_llm_stage3.py/itda_review_app.py 전체 흐름이
Windows에서 정상 동작하는지 먼저 확인하기 위한 스크립트.

실행:
    python make_test_db.py
    -> 현재 폴더에 test_assistant.db 생성됨 (llm_queue에 가짜 메시지 20건 포함)

주의: 여기 들어있는 이름/내용은 전부 지어낸 것이며 실제 환자와 무관합니다.
"""
import os
import sqlite3
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

SCHEMA = """
CREATE TABLE IF NOT EXISTS processed_messages (
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    processed_utc TEXT NOT NULL,
    category TEXT NOT NULL,
    stage TEXT NOT NULL,
    confidence REAL,
    reason TEXT,
    PRIMARY KEY (source, event_id)
);

CREATE TABLE IF NOT EXISTS todo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL, event_id TEXT NOT NULL, sender TEXT, sender_dept TEXT,
    content TEXT NOT NULL, created_utc TEXT NOT NULL, status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS calendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL, event_id TEXT NOT NULL, sender TEXT, sender_dept TEXT,
    event_subtype TEXT, content TEXT NOT NULL, created_utc TEXT NOT NULL, status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS notice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL, event_id TEXT NOT NULL, sender TEXT, sender_dept TEXT,
    content TEXT NOT NULL, created_utc TEXT NOT NULL, status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS reference (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL, event_id TEXT NOT NULL, sender TEXT, sender_dept TEXT,
    content TEXT NOT NULL, created_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL, event_id TEXT NOT NULL, sender TEXT, sender_dept TEXT,
    content TEXT NOT NULL, created_utc TEXT NOT NULL, status TEXT DEFAULT 'queued', llm_result TEXT
);
"""

# 전부 지어낸 가짜 이름/내용 (실제 환자/직원과 무관) - todo/calendar/notice/reference/ignore 경계 케이스 골고루 포함
FAKE_MESSAGES = [
    ("홍길동님 오전에 재활 치료 한번 봐주세요~", "김민준", "작업치료"),
    ("네 저희가 확인 후 내릴게요", "이서연", "간호"),
    ("ㅋㅋㅋㅋ 그러네요", "박도윤", "물리치료"),
    ("이영희님 다음주 월요일 외박 나가십니다", "최지우", "간호"),
    ("전체 공지: 이번주 금요일 오후 회의실 점검으로 사용 불가합니다", "관리팀", "총무"),
    ("김철수님 오늘 재활 치료 전부 거부하셨습니다. 컨디션 안 좋아 보이심", "정하은", "물리치료"),
    ("잠시만요~~ 바로 끌게요", "송민재", "작업치료"),
    ("배영수님 내일 외진 몇시인지 아시는 분?", "한소율", "간호"),
    ("네 알겠습니다 확인했습니다", "오지훈", "간호"),
    ("장미란님 FES 처방 변경됐는데 오전 스케줄 한번 봐주세요", "김민준", "작업치료"),
    ("초기평가 완료했습니다 - 강태호님", "이서연", "물리치료"),
    ("헤ㅔㅎ.... 수정 후 저희가 내릴께욥", "박도윤", "작업치료"),
    ("신환 윤서아님 오늘 입원하셨고 언어치료 처방 났습니다, 스케줄 잡아주세요", "최지우", "언어치료"),
    ("에..?ㅋㅋㅋㅋㅋ그럼....시간표....ㅋㅋㅋㅋㅋㅋ", "정하은", "간호"),
    ("2월 3일(화)로 진행하도록 하겠습니다", "송민재", "작업치료"),
    ("저희도 연하전기 D/C입니다!", "한소율", "물리치료"),
    ("문지호님 퇴원 예정일 확인 부탁드립니다", "오지훈", "간호"),
    ("얍", "김민준", "작업치료"),
    ("과장님 새로 주신 명단 확인했습니다. 순서대로 진행하겠습니다", "이서연", "물리치료"),
    ("환자분 성함이 어떻게 되시죠??", "박도윤", "간호"),
]


def main():
    # 재실행해도 깨끗하게 시작하도록 기존 파일 삭제 (UNIQUE 제약 충돌 방지)
    if os.path.exists("test_assistant.db"):
        os.remove("test_assistant.db")

    conn = sqlite3.connect("test_assistant.db")
    conn.executescript(SCHEMA)

    now = "2026-08-01T00:00:00+00:00"
    for i, (content, sender, dept) in enumerate(FAKE_MESSAGES, start=1):
        event_id = f"test-{i}"
        conn.execute(
            "INSERT INTO processed_messages (source, event_id, processed_utc, category, stage, confidence, reason) "
            "VALUES ('ipmsg', ?, ?, 'llm_pending', 'llm_pending', 0.4, 'low_confidence')",
            (event_id, now),
        )
        conn.execute(
            "INSERT INTO llm_queue (source, event_id, sender, sender_dept, content, created_utc) "
            "VALUES ('ipmsg', ?, ?, ?, ?, ?)",
            (event_id, sender, dept, content, now),
        )
    conn.commit()

    n = conn.execute("SELECT COUNT(*) FROM llm_queue").fetchone()[0]
    conn.close()
    print(f"test_assistant.db 생성 완료 - llm_queue에 가짜 메시지 {n}건 (전부 지어낸 내용, 실제 환자 아님)")
    print("이제 이걸로 검증하세요:")
    print('  python itda_llm_stage3.py --model <gguf경로> --db test_assistant.db --limit 5 --dry-run')


if __name__ == "__main__":
    main()
