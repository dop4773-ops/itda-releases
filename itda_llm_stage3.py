"""
잇다 (Itda) - 3단계 LLM 모듈
llama-cpp-python으로 GGUF 모델을 프로그램에 직접 내장 (Ollama 서버 불필요).

사전 준비:
    pip install llama-cpp-python

모델 다운로드 (택1, 로컬에서 실행):
    # EXAONE 4.0 1.2B (한국어 특화, 온디바이스용) - 현재 llama.cpp 호환성 이슈로 보류
    huggingface-cli download LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF --include "*Q4_K_M*" --local-dir ./models/exaone

    # Qwen3-1.7B (Apache 2.0) - 모델 비교 검증 완료, 최종 확정
    huggingface-cli download bartowski/Qwen_Qwen3-1.7B-GGUF --include "*Q4_K_M*" --local-dir ./models/qwen3

실행:
    # 전체 배치 처리 (llm_queue의 status='queued' 전부)
    python itda_llm_stage3.py --model ./models/qwen3/Qwen_Qwen3-1.7B-Q4_K_M.gguf --db assistant.db

    # 소규모 테스트 (DB에 쓰지 않고 결과만 확인)
    python itda_llm_stage3.py --model ./models/qwen3/Qwen_Qwen3-1.7B-Q4_K_M.gguf --limit 20 --dry-run

설계 변경 (2026-08-01): 자동확정 -> 제안(suggestion) 생성으로 전환
    - 소형 모델(Qwen3-1.7B) 검증 중 없는 환자명을 지어내거나(few-shot 예시 베끼기),
      "치료거부"를 "치료 요청"으로 뒤집는 등 신뢰할 수 없는 오분류가 관찰됨.
    - 병원 업무 데이터라는 특성상 사람 확인 없이 todo/calendar 등에 자동으로 확정
      반영하는 것은 위험하다고 판단, LLM은 todo/calendar/notice/reference 테이블에
      직접 쓰지 않고 새 suggestions 테이블에 "제안"만 쌓는다.
    - 실제 확정은 이후 만들 위젯(승인/수정/무시 UI)에서 사람이 검토한 뒤 이뤄진다
      (Feedback Engine과 함께 다음 단계에서 설계 예정, 이 파일의 범위 밖).

메모:
    - status='queued'만 대상으로 하고 처리 후 'suggested'로 바꾸므로, 중단 후 재실행해도
      이미 처리된 행은 건너뛰고 이어서 처리한다 (재개 가능).
    - commit_every 건마다 커밋하므로 장시간 배치(11,007건 ≈ 1.8~2시간) 도중 중단돼도
      그 시점까지 처리분은 보존된다.
"""
import argparse
import json
import re
import signal
import sqlite3
import sys
import time

# Windows 콘솔의 기본 코드페이지(cp949 등)가 한글/특수문자 출력 시 깨지거나
# UnicodeEncodeError를 낼 수 있어 UTF-8을 강제한다. (Mac/Linux는 원래 UTF-8이라 영향 없음)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass  # 아주 오래된 Python이면 reconfigure가 없을 수 있음 - 무시하고 진행

# Llama와 LlamaGrammar를 따로 임포트한다. 이전엔 한 try/except로 묶여있어서,
# LlamaGrammar 임포트 경로만 실패해도(버전차이 등) Llama까지 통째로 None 처리되는
# 문제가 있었음 - Windows에서 llama-cpp-python 버전이 Mac과 다를 수 있어 분리함.
try:
    from llama_cpp import Llama
except ImportError:
    Llama = None

LlamaGrammar = None
try:
    from llama_cpp import LlamaGrammar  # 최신 버전은 top-level에서도 제공
except ImportError:
    try:
        from llama_cpp.llama_grammar import LlamaGrammar
    except ImportError:
        LlamaGrammar = None


CATEGORIES = ["todo", "calendar", "notice", "reference", "ignore"]

# JSON 스키마를 강제해서 소형 모델이 형식을 깨뜨리지 못하게 함 (grammar-constrained decoding)
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": CATEGORIES},
        "patient_name": {"type": ["string", "null"]},
        "summary": {"type": "string"},
        "deadline_or_date": {"type": ["string", "null"]},
    },
    "required": ["category", "summary"],
}


PROMPT_TEMPLATE = """다음은 병원 내부 메신저에서 온 메시지입니다. 이 메시지를 분석해서 아래 JSON 형식으로만 답하세요. 다른 설명은 절대 추가하지 마세요.

카테고리 종류:
- todo: 발신자가 "상대방"에게 특정 행동을 해달라고 요청/부탁하는 경우
- calendar: 환자의 일정(외박/외출/전동/전원/외진/검사/회의/퇴원)이 날짜와 함께 언급된 경우
- notice: 부서/조직 전체를 대상으로 한 공지
- reference: 행동 요청은 없지만 기록해둘 가치가 있는 환자 상태/관찰 보고
- ignore: 잡담, 인사, 감탄사, 발신자 스스로 하겠다는 응답(자기 확인/수락) 등

아래 예시를 참고해서 분류하세요.

메시지: "김철수님 오전에 재활 치료 한번 봐주세요"
JSON: {{"category": "todo", "patient_name": "김철수", "summary": "재활 치료 확인 요청", "deadline_or_date": null}}

메시지: "네 저희가 확인 후 내릴게요"
JSON: {{"category": "ignore", "patient_name": null, "summary": "자기 확인 응답", "deadline_or_date": null}}

메시지: "ㅋㅋㅋㅋ 그러네요"
JSON: {{"category": "ignore", "patient_name": null, "summary": "감탄사", "deadline_or_date": null}}

이제 아래 메시지를 위와 같은 형식으로 분류하세요.
(주의: 위 예시들은 형식 참고용입니다. 환자명, summary 등은 절대 예시에서 그대로 베끼지 말고
반드시 아래 실제 메시지 내용에 있는 정보만 사용하세요. 메시지에 환자명이 없으면 patient_name은 null입니다.)

메시지: "{message}"

JSON 형식:
{{"category": "todo|calendar|notice|reference|ignore", "patient_name": "환자명 또는 null", "summary": "10단어 이내 한글 요약", "deadline_or_date": "날짜/시각 언급 있으면 그대로, 없으면 null"}}

JSON:"""


def load_model(model_path: str, n_ctx: int = 2048, n_threads: int = 4):
    if Llama is None:
        raise RuntimeError("llama-cpp-python이 설치되어 있지 않습니다. pip install llama-cpp-python")
    return Llama(model_path=model_path, n_ctx=n_ctx, n_threads=n_threads, verbose=False)


# ------------------------------------------------------------------
# "붙여넣기 -> 분석하기" 전용: 메시지 여러 개가 섞인 통짜 텍스트를 통째로 읽고
# 그 안의 실행 가능한 항목들을 전부 찾아 배열로 쪼개서 반환한다.
# (기존 classify_with_llm은 메시지 1개 -> 카테고리 1개. 이건 텍스트 덩어리 -> 항목 N개)
# ------------------------------------------------------------------
ANALYZE_ITEM_CATEGORIES = ["todo", "calendar", "notice", "reference"]

ANALYZE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": ANALYZE_ITEM_CATEGORIES},
                    "patient_name": {"type": ["string", "null"]},
                    "summary": {"type": "string"},
                    "deadline_or_date": {"type": ["string", "null"]},
                },
                "required": ["category", "summary"],
            },
        },
    },
    "required": ["items"],
}

ANALYZE_PROMPT_TEMPLATE = """다음은 병원 내부 메신저에서 복사해서 붙여넣은 대화 내용입니다.
이 안에서 실행 가능한 항목들을 전부 찾아 각각 별도 항목으로 나눠 JSON으로 반환하세요.

규칙:
- 메시지 하나에 환자나 용건이 여러 개 언급되면 각각 별도 항목으로 분리하세요
  (예: "808 김문숙 외진 3:40 출발 / 812 전영옥 12pm 외출 출발"은 서로 다른 환자의
  서로 다른 일정이므로 2개의 별도 항목입니다)
- "안녕하십니까", "수고하십시오" 같은 인사말/잡담은 항목으로 만들지 말고 그냥 무시하세요
- category는 다음 중 하나만 사용:
  - todo: 누군가에게 특정 행동을 해달라고 요청/부탁하는 내용
  - calendar: 환자의 일정(외박/외출/전동/전원/외진/검사/회의/퇴원)이 날짜/시간과 함께 언급된 경우
  - notice: 부서/조직 전체를 대상으로 한 공지
  - reference: 요청은 없지만 기록해둘 가치가 있는 환자 상태/관찰 보고
- 항목이 하나도 없으면(전부 잡담이면) items를 빈 배열로 반환하세요

대화 내용:
\"\"\"
{text}
\"\"\"

JSON 형식:
{{"items": [{{"category": "todo|calendar|notice|reference", "patient_name": "환자명 또는 null", "summary": "10단어 이내 한글 요약", "deadline_or_date": "날짜/시각 언급 있으면 그대로, 없으면 null"}}]}}

JSON:"""


def _build_analyze_grammar():
    if LlamaGrammar is None:
        print("경고: LlamaGrammar를 임포트하지 못해 grammar 없이 실행합니다.", file=sys.stderr)
        return None
    return LlamaGrammar.from_json_schema(json.dumps(ANALYZE_SCHEMA))


def analyze_text(llm, text: str, grammar=None, max_tokens: int = 1200):
    """붙여넣은 대화 텍스트 통째로 넣으면 항목 리스트를 뽑아준다.
    반환: {"items": [...], "raw_output": str, "elapsed_sec": float}
    파싱 실패해도 예외를 던지지 않고 items=[]로 안전하게 반환한다 (호출부에서 에러 배너 처리)."""
    prompt = ANALYZE_PROMPT_TEMPLATE.format(text=text)
    start = time.time()
    kwargs = {"max_tokens": max_tokens, "temperature": 0.1}
    if grammar is not None:
        kwargs["grammar"] = grammar
    output = llm(prompt, **kwargs)
    elapsed = time.time() - start

    raw_text = output["choices"][0]["text"]
    parsed = extract_json(raw_text)

    items = []
    if parsed and isinstance(parsed.get("items"), list):
        for it in parsed["items"]:
            if not isinstance(it, dict):
                continue
            category = it.get("category")
            if category not in ANALYZE_ITEM_CATEGORIES:
                continue  # 스키마 밖 카테고리는 안전하게 버림 (억지로 ignore 만들지 않음)
            patient_name = it.get("patient_name")
            if patient_name in ("null", "None", ""):
                patient_name = None
            deadline_or_date = it.get("deadline_or_date")
            if deadline_or_date in ("null", "None", ""):
                deadline_or_date = None
            items.append({
                "category": category,
                "patient_name": patient_name,
                "summary": str(it.get("summary", ""))[:100],
                "deadline_or_date": deadline_or_date,
            })

    return {"items": items, "raw_output": raw_text.strip(), "elapsed_sec": round(elapsed, 2)}


def _build_grammar():
    if LlamaGrammar is None:
        print("경고: LlamaGrammar를 임포트하지 못해 grammar 없이 실행합니다 "
              "(JSON 포맷 강제가 안 되어 파싱 실패율이 높아질 수 있음 - "
              "llama-cpp-python 버전을 확인하세요).", file=sys.stderr)
        return None
    return LlamaGrammar.from_json_schema(json.dumps(RESPONSE_SCHEMA))


def extract_json(text: str):
    """모델 출력에서 JSON 블록만 안전하게 추출"""
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def classify_with_llm(llm, message: str, max_tokens: int = 300, grammar=None):
    prompt = PROMPT_TEMPLATE.format(message=message)
    start = time.time()
    kwargs = {"max_tokens": max_tokens, "temperature": 0.1}
    if grammar is not None:
        kwargs["grammar"] = grammar
    output = llm(prompt, **kwargs)
    elapsed = time.time() - start

    raw_text = output["choices"][0]["text"]
    parsed = extract_json(raw_text)

    return {
        "raw_output": raw_text.strip(),
        "parsed": parsed,
        "elapsed_sec": round(elapsed, 2),
    }


SUGGESTIONS_SCHEMA = """
CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sender TEXT,
    sender_dept TEXT,
    content TEXT NOT NULL,
    created_utc TEXT NOT NULL,
    suggested_category TEXT NOT NULL,
    patient_name TEXT,
    summary TEXT,
    deadline_or_date TEXT,
    llm_raw TEXT,
    review_status TEXT DEFAULT 'pending',   -- pending / approved / edited / rejected
    final_category TEXT,                    -- 사람이 승인/수정한 뒤 확정된 카테고리 (위젯에서 채움)
    reviewed_utc TEXT,
    UNIQUE(source, event_id)
);
"""


def init_suggestions_table(conn):
    conn.executescript(SUGGESTIONS_SCHEMA)
    conn.commit()


def _insert_suggestion(cur, source, event_id, category, sender, sender_dept, content, created_utc,
                        patient_name, deadline_or_date, summary, raw_output):
    """LLM 분류 결과를 '제안'으로만 suggestions 테이블에 쌓는다.
    todo/calendar/notice/reference 등 실제 테이블에는 쓰지 않는다 -
    확정은 사람이 위젯에서 승인한 뒤에만 이뤄진다 (이 스크립트의 범위 밖)."""
    cur.execute(
        "INSERT OR REPLACE INTO suggestions "
        "(source, event_id, sender, sender_dept, content, created_utc, suggested_category, "
        " patient_name, deadline_or_date, summary, llm_raw, review_status) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')",
        (source, event_id, sender, sender_dept, content, created_utc, category,
         patient_name, deadline_or_date, summary, raw_output),
    )


def get_conn(assistant_db_path: str):
    """WAL 모드 + busy_timeout(30초)으로 연결한다.
    itda_review_app.py(승인/거부 웹앱)가 같은 DB에 동시 접근해도 안전하게."""
    conn = sqlite3.connect(assistant_db_path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    return conn


def process_llm_queue(assistant_db_path: str, model_path: str, limit: int = None,
                       commit_every: int = 50, n_threads: int = 4, n_ctx: int = 2048,
                       dry_run: bool = False):
    llm = load_model(model_path, n_ctx=n_ctx, n_threads=n_threads)
    grammar = _build_grammar()

    conn = get_conn(assistant_db_path)
    if not dry_run:
        init_suggestions_table(conn)
    cur = conn.cursor()
    query = (
        "SELECT id, source, event_id, sender, sender_dept, content, created_utc "
        "FROM llm_queue WHERE status = 'queued' ORDER BY id"
    )
    if limit:
        query += f" LIMIT {int(limit)}"
    cur.execute(query)
    rows = cur.fetchall()

    total = len(rows)
    print(f"처리 대상: {total}건 (dry_run={dry_run})")
    if total == 0:
        conn.close()
        return []

    # 장시간 배치 도중 Ctrl+C로 중단해도 그때까지 처리분은 커밋되도록 함
    interrupted = {"flag": False}

    def _on_sigint(signum, frame):
        print("\n중단 요청 받음 - 지금까지 처리분 커밋 후 종료합니다...")
        interrupted["flag"] = True

    signal.signal(signal.SIGINT, _on_sigint)

    results = []
    processed_since_commit = 0
    start_all = time.time()

    for i, (row_id, source, event_id, sender, sender_dept, content, created_utc) in enumerate(rows, start=1):
        if interrupted["flag"]:
            break

        result = classify_with_llm(llm, content, grammar=grammar)
        parsed = result["parsed"] or {}
        category = parsed.get("category")
        if category not in CATEGORIES:
            category = "ignore"
        summary = str(parsed.get("summary", ""))[:100]
        patient_name = parsed.get("patient_name")
        if patient_name in ("null", "None", ""):
            patient_name = None
        deadline_or_date = parsed.get("deadline_or_date")
        if deadline_or_date in ("null", "None", ""):
            deadline_or_date = None

        results.append((row_id, content, result))

        if not dry_run:
            cur.execute(
                "UPDATE llm_queue SET status='suggested', llm_result=? WHERE id=?",
                (json.dumps(parsed, ensure_ascii=False) if parsed else result["raw_output"], row_id),
            )
            # category는 참고용(LLM 제안값)으로만 기록하고, stage='llm_suggested'로 미확정임을 명시.
            # confidence는 일부러 비워둠(NULL) - 규칙/ML 단계의 실제 확신도와 혼동되지 않도록.
            # 재실행 시 중복 큐잉만 막는 용도 - 실제 확정은 위젯 승인 후 별도 플로우에서 처리.
            cur.execute(
                "UPDATE processed_messages SET category=?, stage='llm_suggested', confidence=NULL, "
                "reason='pending_review' WHERE source=? AND event_id=?",
                (category, source, event_id),
            )
            _insert_suggestion(cur, source, event_id, category, sender, sender_dept, content, created_utc,
                                patient_name, deadline_or_date, summary, result["raw_output"])

            processed_since_commit += 1
            if processed_since_commit >= commit_every:
                conn.commit()
                processed_since_commit = 0

        if i % 20 == 0 or i == total:
            elapsed_all = time.time() - start_all
            rate = elapsed_all / i
            eta_min = rate * (total - i) / 60
            print(f"[{i}/{total}] {category:10s} | {summary[:24]:24s} | "
                  f"경과 {elapsed_all/60:.1f}분, 예상잔여 {eta_min:.1f}분", flush=True)

    if not dry_run:
        conn.commit()
    conn.close()

    print("\n=== 제안 생성 결과 (아직 확정 아님 - suggestions 테이블에 pending 상태로 대기) ===")
    done_categories = {}
    for _, _, result in results:
        parsed = result["parsed"] or {}
        cat = parsed.get("category") if parsed.get("category") in CATEGORIES else "ignore"
        done_categories[cat] = done_categories.get(cat, 0) + 1
    for cat, cnt in sorted(done_categories.items(), key=lambda x: -x[1]):
        print(f"{cat}: {cnt}")
    if not dry_run:
        print("\n실제 todo/calendar/notice/reference 테이블에는 반영되지 않았습니다.")
        print("위젯에서 승인해야 확정됩니다 (다음 단계에서 구현 예정).")

    if interrupted["flag"]:
        print(f"\n중단됨: {len(results)}/{total}건 처리 후 종료. "
              f"재실행하면 나머지(status='queued')부터 이어서 처리합니다.")

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="GGUF 모델 파일 경로")
    parser.add_argument("--db", default="assistant.db")
    parser.add_argument("--limit", type=int, default=None, help="테스트용 처리 건수 제한 (기본: 전체)")
    parser.add_argument("--commit-every", type=int, default=50, help="N건마다 커밋 (기본 50)")
    parser.add_argument("--n-threads", type=int, default=4)
    parser.add_argument("--n-ctx", type=int, default=2048)
    parser.add_argument("--dry-run", action="store_true", help="DB에 쓰지 않고 분류 결과만 출력")
    args = parser.parse_args()

    all_results = process_llm_queue(
        args.db, args.model, limit=args.limit, commit_every=args.commit_every,
        n_threads=args.n_threads, n_ctx=args.n_ctx, dry_run=args.dry_run,
    )
    # 콘솔에는 앞부분 20건만 상세 출력 (대량 배치 시 스크롤 방지, 전체 결과는 DB에 이미 반영됨)
    for row_id, content, result in all_results[:20]:
        print(f"\n--- id={row_id} ({result['elapsed_sec']}초) ---")
        print(f"원문: {content[:60]}")
        print(f"결과: {result['parsed']}")
