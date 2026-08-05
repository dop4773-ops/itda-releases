"""
잇다 (Itda) - 실시간 워처

11,007건짜리 야간 배치(itda_llm_stage3.py)와는 다른 용도입니다.
이 스크립트는 LLM 모델을 한 번만 로드해서 메모리에 계속 띄워둔 채로,
새 메시지가 들어오면 몇 초 안에 규칙엔진/ML을 거쳐도 애매한 건만 즉시 LLM으로
판단하고, Windows 토스트 알림으로 "승인/무시"를 그 자리에서 물어봅니다.

건당 처리 시간은 이 정도 사양 PC 기준 약 3~7초 - 11,000건 배치로는 치명적이지만
1건씩 실시간으로 처리하는 데는 전혀 문제없는 속도라 이 방식을 택했습니다.

사전 준비:
    pip install winotify   (Windows 토스트 알림용. 없으면 알림 없이 suggestions에만 쌓이고,
                             나중에 itda_review_app.py 브라우저 화면에서 검토 가능)
    itda_review_app.py를 미리 http://127.0.0.1:5050 에서 실행해두어야 토스트의
    승인/무시 버튼이 실제로 동작합니다 (버튼 클릭 -> 그 서버의 /quick/<id>/... 호출).

실행 (예시):
    python itda_review_app.py --db assistant.db &      (먼저 리뷰 서버 실행)
    python itda_realtime_watcher.py --db assistant.db \\
        --model models\\Qwen_Qwen3-1.7B-Q4_K_M.gguf \\
        --ml-model model.joblib \\
        --ipmsg-db ipmsg.db --miraelan-db messenger.db

    Ctrl+C로 종료. 계속 띄워두는 프로그램이라 Windows 작업 스케줄러에
    "로그온 시 시작" 트리거로 등록해서 상시 실행하는 걸 추천합니다.
"""
import argparse
import datetime
import json
import os
import sqlite3
import sys
import time

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    from winotify import Notification
except ImportError:
    Notification = None

from itda_llm_stage3 import (
    load_model, _build_grammar, classify_with_llm, CATEGORIES,
    init_suggestions_table, _insert_suggestion,
)

try:
    from itda_pipeline_v2 import run as run_pipeline
    from itda_adapters import IPMessengerAdapter, MiraeLanAdapter
    PIPELINE_AVAILABLE = True
except ImportError as e:
    run_pipeline = None
    IPMessengerAdapter = None
    MiraeLanAdapter = None
    PIPELINE_AVAILABLE = False
    print(f"경고: 파이프라인 모듈 임포트 실패 ({e}) - 신규 메시지 수집(규칙엔진/ML 단계) 없이 "
          f"이미 llm_queue에 쌓여있는 항목만 처리합니다.", file=sys.stderr)


def get_conn(db_path: str):
    conn = sqlite3.connect(db_path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    return conn


def notify(review_base_url: str, suggestion_id: int, category: str, summary: str,
           patient_name: str | None, content: str):
    if Notification is None:
        print(f"[알림 생략: winotify 미설치] 새 제안 #{suggestion_id} - {category}: {summary}")
        return
    title = f"잇다 - 새 {category} 제안"
    body = summary or content[:40]
    if patient_name:
        body = f"[{patient_name}] {body}"
    try:
        toast = Notification(app_id="잇다 (Itda)", title=title, msg=body, duration="long")
        toast.add_actions(label="승인", launch=f"{review_base_url}/quick/{suggestion_id}/approve")
        toast.add_actions(label="무시", launch=f"{review_base_url}/quick/{suggestion_id}/reject")
        toast.show()
    except Exception as e:
        # 알림 자체가 실패해도 suggestions에는 이미 쌓여있으니 워처는 계속 돌아가게 함
        print(f"토스트 알림 실패 (제안은 정상 저장됨, 브라우저에서 확인 가능): {e}", file=sys.stderr)


def process_new_llm_queue_items(conn, llm, grammar, review_base_url: str) -> int:
    """llm_queue에서 status='queued'인 새 항목만 골라 즉시 LLM 판단 + 알림. 처리 건수 반환."""
    cur = conn.cursor()
    init_suggestions_table(conn)
    rows = cur.execute(
        "SELECT id, source, event_id, sender, sender_dept, content, created_utc "
        "FROM llm_queue WHERE status='queued' ORDER BY id"
    ).fetchall()

    for row_id, source, event_id, sender, sender_dept, content, created_utc in rows:
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

        cur.execute(
            "UPDATE llm_queue SET status='suggested', llm_result=? WHERE id=?",
            (json.dumps(parsed, ensure_ascii=False) if parsed else result["raw_output"], row_id),
        )
        cur.execute(
            "UPDATE processed_messages SET category=?, stage='llm_suggested', confidence=NULL, "
            "reason='pending_review' WHERE source=? AND event_id=?",
            (category, source, event_id),
        )
        _insert_suggestion(cur, source, event_id, category, sender, sender_dept, content, created_utc,
                            patient_name, deadline_or_date, summary, result["raw_output"])
        conn.commit()

        suggestion_id = cur.execute(
            "SELECT id FROM suggestions WHERE source=? AND event_id=?", (source, event_id)
        ).fetchone()[0]

        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] 새 제안 #{suggestion_id}: "
              f"{category} - {summary} ({result['elapsed_sec']}초)")
        notify(review_base_url, suggestion_id, category, summary, patient_name, content)

    return len(rows)


def watch_loop(db_path, model_path, ml_model_path, ipmsg_db, miraelan_db,
               poll_interval, review_base_url, n_threads, n_ctx):
    print(f"모델 로딩 중: {model_path} (한 번만 로드하고 계속 메모리에 유지합니다)")
    llm = load_model(model_path, n_ctx=n_ctx, n_threads=n_threads)
    grammar = _build_grammar()
    print(f"준비 완료. {poll_interval}초마다 새 메시지를 확인합니다. (Ctrl+C로 종료)")

    adapters = []
    if PIPELINE_AVAILABLE and ipmsg_db:
        adapters.append(IPMessengerAdapter(ipmsg_db))
    if PIPELINE_AVAILABLE and miraelan_db:
        adapters.append(MiraeLanAdapter(miraelan_db))

    while True:
        try:
            if adapters and ml_model_path and os.path.exists(ml_model_path):
                run_pipeline(db_path, adapters, ml_model_path)
            elif adapters and not (ml_model_path and os.path.exists(ml_model_path)):
                print(f"[경고] ML 모델({ml_model_path})을 못 찾아 신규 메시지 수집을 건너뜁니다.",
                      file=sys.stderr)

            conn = get_conn(db_path)
            n = process_new_llm_queue_items(conn, llm, grammar, review_base_url)
            conn.close()
            if n == 0:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] 새 항목 없음", flush=True)
        except KeyboardInterrupt:
            raise
        except Exception as e:
            # 이번 주기가 실패해도 워처 프로세스 자체는 안 죽고 다음 주기에 다시 시도
            print(f"[경고] 이번 주기 처리 중 오류 (계속 실행): {e}", file=sys.stderr)

        time.sleep(poll_interval)


def main():
    parser = argparse.ArgumentParser(description="잇다 실시간 워처 - 신규 메시지 즉시 판단 + 토스트 알림")
    parser.add_argument("--db", default="assistant.db")
    parser.add_argument("--model", required=True, help="GGUF 모델 경로")
    parser.add_argument("--ml-model", default="model.joblib", help="2단계 ML 모델 경로")
    parser.add_argument("--ipmsg-db", default=None, help="IP Messenger DB 경로 (없으면 생략)")
    parser.add_argument("--miraelan-db", default=None, help="MiraeLanMessenger DB 경로 (없으면 생략)")
    parser.add_argument("--poll-interval", type=int, default=30, help="확인 주기(초), 기본 30")
    parser.add_argument("--review-url", default="http://127.0.0.1:5050",
                         help="itda_review_app.py가 떠있는 주소 (토스트 버튼이 호출할 곳)")
    parser.add_argument("--n-threads", type=int, default=4)
    parser.add_argument("--n-ctx", type=int, default=2048)
    args = parser.parse_args()

    try:
        watch_loop(args.db, args.model, args.ml_model, args.ipmsg_db, args.miraelan_db,
                   args.poll_interval, args.review_url, args.n_threads, args.n_ctx)
    except KeyboardInterrupt:
        print("\n워처를 종료합니다.")


if __name__ == "__main__":
    main()
