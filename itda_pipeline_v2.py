"""
잇다 (Itda) - Phase 3 v2: 어댑터 기반 통합 파이프라인
여러 MessageSource(IP Messenger, MiraeLanMessenger, ...)를 동일한 assistant.db로 수렴시킨다.

실행: python itda_pipeline_v2.py
"""
import sqlite3
import joblib
import datetime
import os

from itda_rules import rule_classify
from itda_adapters import IPMessengerAdapter, MiraeLanAdapter

SCHEMA = """
CREATE TABLE IF NOT EXISTS processed_messages (
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    processed_utc TEXT NOT NULL,
    category TEXT NOT NULL,
    stage TEXT NOT NULL,          -- structured / rule / ml / llm_pending
    confidence REAL,
    reason TEXT,
    PRIMARY KEY (source, event_id)
);

CREATE TABLE IF NOT EXISTS todo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sender TEXT,
    sender_dept TEXT,
    content TEXT NOT NULL,
    created_utc TEXT NOT NULL,
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS calendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sender TEXT,
    sender_dept TEXT,
    event_subtype TEXT,
    content TEXT NOT NULL,
    created_utc TEXT NOT NULL,
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS notice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sender TEXT,
    sender_dept TEXT,
    content TEXT NOT NULL,
    created_utc TEXT NOT NULL,
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS reference (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sender TEXT,
    sender_dept TEXT,
    content TEXT NOT NULL,
    created_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sender TEXT,
    sender_dept TEXT,
    content TEXT NOT NULL,
    created_utc TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    llm_result TEXT
);
"""


def init_assistant_db(path: str):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def classify_free_text(raw_body: str, ml_bundle):
    cat, reason, cleaned = rule_classify(raw_body)
    if cat != 'ambiguous_ai':
        return cat, 'rule', 1.0, reason, cleaned

    if not cleaned:
        return 'ignore', 'rule', 1.0, 'empty', cleaned

    vectorizer = ml_bundle['vectorizer']
    clf = ml_bundle['clf']
    threshold = ml_bundle['threshold']

    X = vectorizer.transform([cleaned])
    probs = clf.predict_proba(X)[0]
    pred_idx = probs.argmax()
    pred_cat = clf.classes_[pred_idx]
    confidence = float(probs[pred_idx])

    if confidence >= threshold:
        return pred_cat, 'ml', confidence, f'ml_pred({pred_cat})', cleaned
    return 'llm_pending', 'llm_pending', confidence, 'low_confidence', cleaned


def _insert_by_category(dst_cur, source, event_id, category, sender, sender_dept, content, created_utc, event_subtype=None):
    if category == 'todo':
        dst_cur.execute(
            "INSERT INTO todo (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, content, created_utc)
        )
    elif category == 'calendar':
        dst_cur.execute(
            "INSERT INTO calendar (source, event_id, sender, sender_dept, event_subtype, content, created_utc) VALUES (?,?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, event_subtype, content, created_utc)
        )
    elif category == 'notice':
        dst_cur.execute(
            "INSERT INTO notice (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, content, created_utc)
        )
    elif category == 'reference':
        dst_cur.execute(
            "INSERT INTO reference (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, content, created_utc)
        )
    elif category == 'llm_pending':
        dst_cur.execute(
            "INSERT INTO llm_queue (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, content, created_utc)
        )
    # ignore, schedule_tool -> processed_messages에만 기록


def process_source(adapter, ml_bundle, dst_conn, already_processed: set, now: str, counts: dict):
    dst_cur = dst_conn.cursor()
    source = adapter.source_name

    # 1) 이미 정형화된 이벤트 (규칙엔진 불필요, 바로 확정)
    for ev in adapter.fetch_structured_events():
        key = (source, ev['event_id'])
        if key in already_processed:
            continue
        dst_cur.execute(
            "INSERT INTO processed_messages (source, event_id, processed_utc, category, stage, confidence, reason) "
            "VALUES (?,?,?,?,?,?,?)",
            (source, ev['event_id'], now, ev['category'], 'structured', 1.0, 'structured_source')
        )
        _insert_by_category(dst_cur, source, ev['event_id'], ev['category'], ev['sender'], ev['sender_dept'],
                             ev['content'], ev['created_utc'] or now, ev.get('event_subtype'))
        counts[ev['category']] = counts.get(ev['category'], 0) + 1
        already_processed.add(key)

    # 2) 자유 텍스트 -> 규칙엔진 -> ML
    for msg in adapter.fetch_free_text_messages():
        key = (source, msg['event_id'])
        if key in already_processed:
            continue
        category, stage, confidence, reason, cleaned = classify_free_text(msg['body'], ml_bundle)
        created_utc = msg['created_utc'] or now

        dst_cur.execute(
            "INSERT INTO processed_messages (source, event_id, processed_utc, category, stage, confidence, reason) "
            "VALUES (?,?,?,?,?,?,?)",
            (source, msg['event_id'], now, category, stage, confidence, reason)
        )
        _insert_by_category(dst_cur, source, msg['event_id'], category, msg['sender'], msg['sender_dept'],
                             cleaned, created_utc, reason if category == 'calendar' else None)
        counts[category] = counts.get(category, 0) + 1
        already_processed.add(key)


def run(assistant_db_path: str, adapters: list, model_path: str = "model.joblib"):
    ml_bundle = joblib.load(model_path)
    dst_conn = init_assistant_db(assistant_db_path)
    dst_cur = dst_conn.cursor()

    dst_cur.execute("SELECT source, event_id FROM processed_messages")
    already_processed = {(r[0], r[1]) for r in dst_cur.fetchall()}

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    counts = {}

    for adapter in adapters:
        process_source(adapter, ml_bundle, dst_conn, already_processed, now, counts)

    dst_conn.commit()
    dst_conn.close()
    return counts


if __name__ == "__main__":
    if not os.path.exists("model.joblib"):
        print("모델이 없습니다. itda_ml_train.py를 먼저 실행하세요.")
    else:
        adapters = [
            IPMessengerAdapter("ipmsg.db"),
            MiraeLanAdapter("messenger.db"),
        ]
        result_counts = run("assistant.db", adapters, "model.joblib")
        print("\n=== 처리 결과 (전체 소스 통합) ===")
        for cat, cnt in sorted(result_counts.items(), key=lambda x: -x[1]):
            print(f"{cat}: {cnt}")
