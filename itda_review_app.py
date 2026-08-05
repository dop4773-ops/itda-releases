"""
잇다 (Itda) - 승인/거부 위젯 (로컬 웹앱)

suggestions 테이블(review_status='pending')을 브라우저에서 검토하고
승인/무시하는 로컬 웹서버. LLM(3단계)이 만든 제안은 여기서 사람이
승인해야만 실제 todo/calendar/notice/reference 테이블에 반영된다.

사전 준비:
    pip install flask

실행:
    python itda_review_app.py --db assistant.db
    (기본 포트 5050) 브라우저에서 http://127.0.0.1:5050 접속

    포트 바꾸려면: python itda_review_app.py --db assistant.db --port 8080

주의:
    itda_llm_stage3.py 배치가 백그라운드에서 동시에 assistant.db에 쓰고 있어도
    안전하게 동작하도록 WAL 모드 + busy_timeout(30초)을 사용한다.
"""
import argparse
import datetime
import json
import os
import re
import sqlite3
import sys
import uuid

from flask import Flask, request, redirect, jsonify

# Windows 콘솔 기본 코드페이지로 인한 한글 출력 깨짐/UnicodeEncodeError 방지
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

app = Flask(__name__)

APP_VERSION = "1.3.0"


def _resource_dir() -> str:
    """PyInstaller로 패키징된 경우(sys.frozen)와 스크립트로 실행되는 경우 모두
    static 리소스(폰트 등) 폴더를 정확히 찾기 위한 함수."""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "static")


FONT_DIR = os.path.join(_resource_dir(), "fonts")


@app.route("/fonts/<path:filename>")
def serve_font(filename):
    from flask import send_from_directory
    return send_from_directory(FONT_DIR, filename)

DB_PATH = "assistant.db"
MODEL_PATH = None  # 설정 안 하면 /analyze(붙여넣기 분석) 기능만 비활성화됨, 나머지 페이지는 정상 동작
ML_MODEL_PATH = None  # 2단계 ML 분류기(joblib). 없으면 "지금 수집하기"가 규칙엔진만 적용함
SOURCES = []  # [{"name": "IP메신저", "type": "ipmsg", "path": "..."}, ...] - 확장 가능한 메신저 소스 목록
CONFIG_PATH = "itda_config.json"
PAGE_SIZE = 30
CATEGORIES = ["todo", "calendar", "notice", "reference", "ignore"]

SOURCE_TYPES = ["ipmsg", "miraelan"]
SOURCE_TYPE_LABELS = {"ipmsg": "IP메신저", "miraelan": "미래랜메신저"}

_LLM_TEST_STATUS = {"ok": None, "message": "아직 연결 테스트를 안 했습니다"}  # ok: None(미확인)/True/False
PROFILE_NAME = "사용자"
PROFILE_DEPT = "잇다 사용 중"
UPDATE_REPO = ""  # "owner/repo" 형식, GitHub 릴리스로 업데이트 확인할 때 사용
AUTO_CHECK_UPDATE = True  # 앱 시작할 때 자동으로 업데이트 확인할지
TRAY_ENABLED = True  # 작업표시줄 트레이 상주 (itda_app.py가 시작 시점에 이 값을 config에서 직접 읽음)
POSTIT_ENABLED = True  # 포스트잇 기능
_UPDATE_STATUS = {
    "state": "unknown",   # unknown/ok/newer/fail
    "message": "아직 업데이트 확인을 안 했습니다",
    "latest_version": None,
    "release_notes": None,
    "download_url": None,   # Itda_Setup.exe 실제 다운로드 링크 (원클릭 업데이트용)
    "release_url": None,    # 릴리스 페이지 링크 (수동으로 볼 때용)
}


def _log_debug(msg: str):
    """진단용 로그 - itda_config.json과 같은 폴더에 itda_debug.log로 남긴다.
    '저장했는데 사라진다'는 버그를 코드만 봐서는 원인을 못 찾겠어서, 저장/로드
    시점마다 실제로 무슨 데이터가 오갔는지 파일로 남겨서 재현 시 바로 원인을
    확인할 수 있게 하기 위함. 로그 남기다 실패해도 앱 동작에는 영향 없게 조용히 무시."""
    try:
        log_dir = os.path.dirname(os.path.abspath(CONFIG_PATH)) or "."
        log_path = os.path.join(log_dir, "itda_debug.log")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


def _load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            _log_debug(f"설정 로드: {CONFIG_PATH} -> sources={len(cfg.get('sources', []))}개, "
                       f"db_path={cfg.get('db_path')!r}")
            return cfg
        except Exception as e:
            _log_debug(f"설정 로드 실패: {CONFIG_PATH} -> {e}")
            print(f"설정 파일 읽기 실패: {e}", file=sys.stderr)
    else:
        _log_debug(f"설정 로드: {CONFIG_PATH} 파일이 아직 없음 (최초 실행이면 정상)")
    return {}


def _save_config(cfg: dict):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        _log_debug(f"설정 저장 성공: {CONFIG_PATH} -> sources={len(cfg.get('sources', []))}개, "
                   f"db_path={cfg.get('db_path')!r}, model_path={cfg.get('model_path')!r}")
    except Exception as e:
        _log_debug(f"설정 저장 실패!! {CONFIG_PATH} -> {e}")
        raise


def _save_all_config():
    """현재 전역 설정값 '전체'를 파일에 저장한다. 각 라우트에서 필요한 필드만 골라
    dict를 만들다가 하나라도 빠뜨리면 그 필드가 조용히 사라지는 버그가 있었어서
    (예: 소스 목록을 저장 안 하고 update_repo만 저장 -> 소스 목록 증발), 항상 여기
    한 곳에서만 전체를 저장하도록 통일함."""
    _save_config({
        "db_path": DB_PATH, "model_path": MODEL_PATH, "ml_model_path": ML_MODEL_PATH,
        "sources": SOURCES, "update_repo": UPDATE_REPO, "auto_check_update": AUTO_CHECK_UPDATE,
        "profile_name": PROFILE_NAME, "profile_dept": PROFILE_DEPT,
        "tray_enabled": TRAY_ENABLED, "postit_enabled": POSTIT_ENABLED,
    })


def _apply_config_globals(cfg: dict):
    """설정 파일 내용을 현재 실행 중인 전역변수에 즉시 반영 (앱 재시작 없이 적용)."""
    global DB_PATH, MODEL_PATH, ML_MODEL_PATH, SOURCES, UPDATE_REPO, PROFILE_NAME, PROFILE_DEPT
    global TRAY_ENABLED, POSTIT_ENABLED, AUTO_CHECK_UPDATE
    if cfg.get("db_path"):
        DB_PATH = cfg["db_path"]
    if cfg.get("model_path"):
        MODEL_PATH = cfg["model_path"]
    if cfg.get("ml_model_path"):
        ML_MODEL_PATH = cfg["ml_model_path"]
    SOURCES = cfg.get("sources", [])
    UPDATE_REPO = cfg.get("update_repo", "")
    if cfg.get("profile_name"):
        PROFILE_NAME = cfg["profile_name"]
    if cfg.get("profile_dept"):
        PROFILE_DEPT = cfg["profile_dept"]
    TRAY_ENABLED = bool(cfg.get("tray_enabled", True))
    POSTIT_ENABLED = bool(cfg.get("postit_enabled", True))
    AUTO_CHECK_UPDATE = bool(cfg.get("auto_check_update", True))

_LLM_CACHE = {"llm": None, "grammar": None, "model_path": None}


def _get_llm():
    """모델을 최초 '분석하기' 클릭 시 한 번만 로드하고 캐시한다 (앱 켜질 때 바로 안 실음 -
    가볍게 시작하고, AI는 실제로 쓸 때만 무거워지게)."""
    if _LLM_CACHE["llm"] is None or _LLM_CACHE["model_path"] != MODEL_PATH:
        if not MODEL_PATH:
            raise RuntimeError("모델 경로가 설정되지 않았습니다 (--model 옵션 또는 itda_config.json 확인)")
        from itda_llm_stage3 import load_model, _build_analyze_grammar
        _LLM_CACHE["llm"] = load_model(MODEL_PATH, n_ctx=4096, n_threads=4)
        _LLM_CACHE["grammar"] = _build_analyze_grammar()
        _LLM_CACHE["model_path"] = MODEL_PATH
    return _LLM_CACHE["llm"], _LLM_CACHE["grammar"]


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.row_factory = sqlite3.Row
    return conn


# 앱을 처음 켰을 때(빈 assistant.db) 필요한 테이블이 하나도 없어서 "제안 검토" 페이지가
# 500 에러로 죽던 문제 수정 - 시작 시 전체 스키마를 무조건 만들어둔다 (CREATE TABLE IF NOT
# EXISTS라 이미 있으면 그냥 넘어감, 기존 데이터에 영향 없음).
FULL_SCHEMA = """
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
    review_status TEXT DEFAULT 'pending',
    final_category TEXT,
    reviewed_utc TEXT,
    UNIQUE(source, event_id)
);

CREATE TABLE IF NOT EXISTS memo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    color TEXT DEFAULT '#FFF3B0',
    status TEXT DEFAULT 'pending',
    created_utc TEXT NOT NULL
);
"""


def init_db_schema():
    conn = get_conn()
    conn.executescript(FULL_SCHEMA)
    conn.commit()

    # 포스트잇 기능용 pinned/color 컬럼 - 기존에 만들어둔 DB에는 없을 수 있어서
    # 없는 경우에만 안전하게 추가 (있는 걸 또 추가하면 에러나므로 먼저 확인)
    cur = conn.cursor()
    for table in ("todo", "calendar", "notice"):
        cols = [row[1] for row in cur.execute(f"PRAGMA table_info({table})").fetchall()]
        if "pinned" not in cols:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN pinned INTEGER DEFAULT 0")
        if "color" not in cols:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN color TEXT")
    conn.commit()
    conn.close()


def _insert_by_category(cur, source, event_id, category, sender, sender_dept, content, created_utc,
                         deadline_or_date, summary):
    """승인된 제안을 실제 위젯이 읽는 테이블에 반영한다. ignore는 insert 없음."""
    if category == "todo":
        cur.execute(
            "INSERT INTO todo (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, content, created_utc),
        )
    elif category == "calendar":
        subtype = deadline_or_date if deadline_or_date else f"llm:{summary}"
        cur.execute(
            "INSERT INTO calendar (source, event_id, sender, sender_dept, event_subtype, content, created_utc) "
            "VALUES (?,?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, subtype, content, created_utc),
        )
    elif category == "notice":
        cur.execute(
            "INSERT INTO notice (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, content, created_utc),
        )
    elif category == "reference":
        cur.execute(
            "INSERT INTO reference (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, sender_dept, content, created_utc),
        )


SHARED_CSS = """
  @font-face { font-family: 'Pretendard'; font-weight: 400; font-display: swap; src: url('/fonts/Pretendard-Regular.woff2') format('woff2'); }
  @font-face { font-family: 'Pretendard'; font-weight: 500; font-display: swap; src: url('/fonts/Pretendard-Medium.woff2') format('woff2'); }
  @font-face { font-family: 'Pretendard'; font-weight: 600; font-display: swap; src: url('/fonts/Pretendard-SemiBold.woff2') format('woff2'); }
  @font-face { font-family: 'Pretendard'; font-weight: 700; font-display: swap; src: url('/fonts/Pretendard-Bold.woff2') format('woff2'); }
  @font-face { font-family: 'Pretendard'; font-weight: 800; font-display: swap; src: url('/fonts/Pretendard-ExtraBold.woff2') format('woff2'); }

  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { font-family: "Pretendard", "Malgun Gothic", "맑은 고딕", -apple-system, "Apple SD Gothic Neo", sans-serif;
         margin: 0; background: #F8F7FC; color: #34324A; -webkit-font-smoothing: antialiased;
         font-size: 14px; line-height: 1.5; }
  a { color: inherit; }
  .app-shell { display: flex; height: 100vh; overflow: hidden; }

  .sidebar { width: 226px; flex-shrink: 0; height: 100%; background: linear-gradient(180deg,#EFECFB,#EAF1FB);
             padding: 22px 0 0; display: flex; flex-direction: column; border-right: 1px solid #E7E3F6;
             overflow-y: auto; }
  .sidebar-logo { padding: 2px 22px 18px; color: #3A3652; text-decoration: none;
                  display: flex; align-items: center; gap: 11px;
                  border-bottom: 1px solid rgba(122,101,196,0.14); margin-bottom: 12px; padding-bottom: 20px; }
  .sidebar-logo .badge { width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
                          background: linear-gradient(135deg,#B7A6F5,#9FD8EC); display: flex;
                          align-items: center; justify-content: center; font-size: 14px; font-weight: 800; color: #453A73;
                          box-shadow: 0 3px 10px rgba(167,142,240,0.35); }
  .logo-stack { display: flex; flex-direction: column; line-height: 1.15; }
  .logo-main { font-size: 17px; font-weight: 800; letter-spacing: -0.3px; color: #3A3652; }
  .logo-sub { font-size: 10.5px; font-weight: 500; color: #8C87A6; letter-spacing: 0.2px; }
  .side-links { flex: 1; padding: 0 12px; overflow-y: auto; }
  .side-link { display: flex; align-items: center; gap: 10px; padding: 10px 13px; margin-bottom: 2px; border-radius: 11px;
               color: #6E6A87; text-decoration: none; font-size: 13.5px; font-weight: 500; transition: background .12s, color .12s; }
  .side-ico { font-size: 15px; width: 18px; text-align: center; flex-shrink: 0; }
  .side-link:hover { background: rgba(122,101,196,0.08); color: #3A3652; }
  .side-link.active { background: #E1D9FA; color: #5B3FBF; font-weight: 700; }
  .side-divider { height: 1px; background: rgba(122,101,196,0.13); margin: 8px 13px; }
  .sidebar-profile { display: flex; align-items: center; gap: 10px; padding: 14px 18px;
                      border-top: 1px solid rgba(122,101,196,0.14); position: relative;
                      text-decoration: none; color: inherit; cursor: pointer; transition: background .12s; }
  .sidebar-profile:hover { background: rgba(122,101,196,0.07); }
  .sidebar-profile.settings-active { background: #E1D9FA; }
  .profile-avatar { width: 32px; height: 32px; border-radius: 50%; background: rgba(122,101,196,0.12);
                     display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
  .profile-text { flex: 1; min-width: 0; }
  .profile-name { font-size: 12.5px; font-weight: 700; color: #3A3652; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .profile-dept { font-size: 11px; color: #9B96B3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .profile-dot { width: 8px; height: 8px; border-radius: 50%; background: #6FCF97; flex-shrink: 0;
                 box-shadow: 0 0 0 3px rgba(111,207,151,0.22); }
  .update-badge { display: block; margin: 8px 14px 0; padding: 8px 10px; border-radius: 9px;
                  background: #FDF1D9; color: #9A6A15; font-size: 11px; font-weight: 700;
                  text-decoration: none; text-align: center; }
  .sidebar-version { padding: 6px 22px 16px; font-size: 10.5px; color: #ADA8C4; }

  .content { flex: 1; height: 100%; padding: 36px 40px; overflow-y: auto; }
  .content-inner { max-width: 820px; }
  h1 { font-size: 21px; margin: 0 0 6px 0; font-weight: 800; letter-spacing: -0.4px; color: #2E2C42; }
  .sub { color: #9691AB; font-size: 13.5px; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 1px 2px rgba(103,90,163,0.04),
          0 10px 26px -16px rgba(103,90,163,0.16); border: 1px solid #F0EDF9; }
"""


def sidebar_html(active: str) -> str:
    primary = [
        ("/", "home", "🏠", "홈"),
        ("/analyze", "analyze", "✨", "새 메시지 분석"),
        ("/list", "list", "🗂️", "내 목록"),
        ("/postit", "postit", "📌", "포스트잇"),
    ]
    secondary = [
        ("/review", "review", "📋", "제안 검토"),
        ("/add", "add", "➕", "빠른 추가"),
    ]

    # /list는 카테고리/상태 필터에 따라 여러 active_key로 넘어올 수 있어서(todo_list 등),
    # 그런 하위 상태도 전부 "내 목록" 항목이 켜져있는 걸로 보이게 함
    list_related = {"list", "todo_list", "calendar_list", "done_list"}
    effective_active = "list" if active in list_related else active

    def _links(items):
        return "\n".join(
            f'<a href="{href}" class="side-link{" active" if key == effective_active else ""}">'
            f'<span class="side-ico">{icon}</span>{label}</a>'
            for href, key, icon, label in items
        )

    profile_active = " settings-active" if active == "settings" else ""

    update_badge = ""
    if _UPDATE_STATUS.get("state") == "newer":
        v = _UPDATE_STATUS.get("latest_version") or "?"
        update_badge = f'<a href="/settings" class="update-badge">🔔 새 버전 v{v} 발견</a>'

    return (
        f'<nav class="sidebar"><a href="/" class="sidebar-logo"><span class="badge">잇</span>'
        f'<span class="logo-stack"><span class="logo-main">잇다</span><span class="logo-sub">Itda</span></span></a>'
        f'<div class="side-links">{_links(primary)}'
        f'<div class="side-divider"></div>{_links(secondary)}</div>'
        f'{update_badge}'
        f'<a href="/settings" class="sidebar-profile{profile_active}" title="설정 (프로필/이름 변경 포함)">'
        f'<div class="profile-avatar">👤</div>'
        f'<div class="profile-text"><div class="profile-name">{PROFILE_NAME}</div>'
        f'<div class="profile-dept">{PROFILE_DEPT}</div></div>'
        f'<span class="profile-dot"></span></a>'
        f'<div class="sidebar-version">v{APP_VERSION}</div></nav>'
    )


PAGE_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>잇다 - 제안 검토</title>
<style>
{{ shared_css|safe }}
  .filters { margin-bottom: 16px; }
  .filters a { display: inline-block; padding: 6px 12px; margin-right: 6px; border-radius: 999px;
               background: #fff; border: 1px solid #ECE8F7; text-decoration: none; color: #6E6A87; font-size: 12.5px; font-weight: 500; }
  .filters a.active { background: #5B3FBF; color: #fff; border-color: #5B3FBF; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden;
          box-shadow: 0 1px 2px rgba(103,90,163,0.04); }
  th, td { padding: 10px 12px; border-bottom: 1px solid #F5F3FA; font-size: 12.5px; text-align: left; vertical-align: top; }
  th { background: #FAF9FD; color: #9691AB; font-weight: 700; font-size: 11.5px; }
  td.content { max-width: 360px; white-space: pre-wrap; word-break: break-word; }
  td.meta { color: #9691AB; font-size: 11.5px; white-space: nowrap; }
  select { padding: 4px 6px; border-radius: 6px; border: 1px solid #E7E3F6; font-size: 12px; }
  button { padding: 6px 12px; border-radius: 8px; border: none; cursor: pointer; font-size: 12px; margin-right: 4px; font-weight: 600; }
  button.approve { background: #7FD8AE; color: #14532D; }
  button.reject { background: #F0EEF7; color: #6E6A87; }
  .empty { padding: 40px; text-align: center; color: #9691AB; background: #fff; border-radius: 14px; }
  .pagination { margin-top: 16px; }
  .pagination a { margin-right: 8px; color: #8B5FE0; text-decoration: none; font-size: 12.5px; font-weight: 600; }
</style>
</head>
<body>
<div class="app-shell">
{{ sidebar|safe }}
<main class="content"><div class="content-inner">
  <h1>제안 검토</h1>
  <div class="sub">승인 전까지 실제 저장 안 됨 · 전체 대기 {{ total_pending }}건 중 {{ filtered_total }}건 표시 (필터: {{ category_filter }})</div>

  <div class="filters">
    <a href="/?category=all" class="{{ 'active' if category_filter == 'all' else '' }}">전체 ({{ total_pending }})</a>
    {% for cat, cnt in cat_counts.items() %}
      <a href="/?category={{ cat }}" class="{{ 'active' if category_filter == cat else '' }}">{{ cat }} ({{ cnt }})</a>
    {% endfor %}
  </div>

  {% if rows|length == 0 %}
    <div class="empty">검토할 제안이 없습니다 🎉</div>
  {% else %}
  <table>
    <tr>
      <th>발신자/부서</th>
      <th>원문</th>
      <th>LLM 제안</th>
      <th>환자명</th>
      <th>요약</th>
      <th>액션</th>
    </tr>
    {% for r in rows %}
    <tr>
      <td class="meta">{{ r['sender'] or '-' }}<br>{{ r['sender_dept'] or '-' }}</td>
      <td class="content">{{ r['content'] }}</td>
      <td class="meta">{{ r['suggested_category'] }}</td>
      <td class="meta">{{ r['patient_name'] or '-' }}</td>
      <td class="content">{{ r['summary'] or '-' }}</td>
      <td>
        <form method="post" action="/action/{{ r['id'] }}">
          <input type="hidden" name="return_url" value="{{ return_url }}">
          <select name="category">
            {% for c in categories %}
              <option value="{{ c }}" {{ 'selected' if c == r['suggested_category'] else '' }}>{{ c }}</option>
            {% endfor %}
          </select>
          <button type="submit" name="action" value="approve" class="approve">승인</button>
          <button type="submit" name="action" value="reject" class="reject">무시</button>
        </form>
      </td>
    </tr>
    {% endfor %}
  </table>
  <div class="pagination">
    {% if page > 1 %}<a href="/?category={{ category_filter }}&page={{ page - 1 }}">← 이전</a>{% endif %}
    <span>page {{ page }}</span>
    {% if has_next %}<a href="/?category={{ category_filter }}&page={{ page + 1 }}">다음 →</a>{% endif %}
  </div>
  {% endif %}
</div></main>
</div>
</body>
</html>
"""


def _parse_day_in_month(text: str, year: int, month: int):
    """'8월 6일', '8/6', '8-6' 같은 자유 텍스트에서 이번 달에 해당하는 날짜(1~31)를 최대한 뽑아본다.
    월 정보가 명시돼있는데 이번 달이 아니면 None. 파싱 실패해도 예외 없이 None 반환
    (환자 일정은 '다음주 월요일'처럼 상대적 표현도 많아서, 실패하는 게 정상인 경우가 흔함)."""
    if not text:
        return None
    m = re.search(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일", text)
    if m:
        mo, da = int(m.group(1)), int(m.group(2))
        return da if mo == month and 1 <= da <= 31 else None
    m = re.search(r"(?<!\d)(\d{1,2})[/\-](\d{1,2})(?!\d)", text)
    if m:
        mo, da = int(m.group(1)), int(m.group(2))
        return da if mo == month and 1 <= da <= 31 else None
    m = re.search(r"(?<!\d)(\d{1,2})\s*일(?!자|간|정)", text)
    if m:
        da = int(m.group(1))
        return da if 1 <= da <= 31 else None
    return None


def _build_calendar_grid():
    """이번 달 달력 그리드 + 일정이 잡힌 날짜에 표시할 정보를 만든다."""
    import calendar as cal_mod

    now = datetime.datetime.now()
    year, month, today_day = now.year, now.month, now.day

    cal = cal_mod.Calendar(firstweekday=6)  # 일요일 시작
    weeks = cal.monthdayscalendar(year, month)  # 그 달이 아닌 날은 0

    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT content, event_subtype FROM calendar WHERE status='pending'"
    ).fetchall()
    conn.close()

    day_items = {}  # day(int) -> [content, ...] (최대 몇 개까지만 보여줄 것)
    for r in rows:
        day = _parse_day_in_month(r["event_subtype"] or "", year, month)
        if day:
            day_items.setdefault(day, []).append(r["content"])

    return {
        "year": year, "month": month, "today": today_day,
        "weeks": weeks, "day_items": day_items,
    }


def _dashboard_data():
    conn = get_conn()
    cur = conn.cursor()
    stats = {
        "todo": cur.execute("SELECT COUNT(*) FROM todo WHERE status='pending'").fetchone()[0],
        "calendar": cur.execute("SELECT COUNT(*) FROM calendar WHERE status='pending'").fetchone()[0],
        "suggestion": cur.execute("SELECT COUNT(*) FROM suggestions WHERE review_status='pending'").fetchone()[0],
        "notice": cur.execute("SELECT COUNT(*) FROM notice WHERE status='pending'").fetchone()[0],
    }
    todo_preview = cur.execute(
        "SELECT id, content, sender, created_utc FROM todo WHERE status='pending' ORDER BY id DESC LIMIT 5"
    ).fetchall()
    calendar_preview = cur.execute(
        "SELECT id, content, event_subtype, sender, created_utc FROM calendar WHERE status='pending' ORDER BY id DESC LIMIT 5"
    ).fetchall()
    conn.close()
    return stats, todo_preview, calendar_preview


DASHBOARD_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>잇다 - 홈</title>
<style>
{{ shared_css|safe }}
  .stat-grid { display: flex; gap: 12px; margin-bottom: 18px; }
  .stat-card { flex: 1; background: #fff; border-radius: 14px; padding: 16px 18px; border: 1px solid #F0EDF9;
               box-shadow: 0 1px 2px rgba(103,90,163,0.04); text-decoration: none; color: inherit; }
  .stat-card .num { font-size: 22px; font-weight: 800; margin-bottom: 2px; }
  .stat-card .lbl { font-size: 12px; color: #9691AB; font-weight: 600; }
  .stat-card.c-todo .num { color: #2E9E6B; }
  .stat-card.c-calendar .num { color: #4A82E8; }
  .stat-card.c-suggestion .num { color: #8B5FE0; }
  .stat-card.c-notice .num { color: #C77DDB; }

  .quick-grid { display: flex; gap: 12px; margin-bottom: 24px; }
  .quick-card { flex: 1; border-radius: 14px; padding: 18px; text-decoration: none; color: #fff;
                display: flex; align-items: center; gap: 12px; }
  .quick-card .qicon { font-size: 22px; width: 40px; height: 40px; border-radius: 11px; background: rgba(255,255,255,0.22);
                        display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .quick-card .qtitle { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
  .quick-card .qsub { font-size: 11px; opacity: 0.85; }
  .quick-card.analyze { background: linear-gradient(120deg,#B7A6F5,#93C5FD); }
  .quick-card.add { background: linear-gradient(120deg,#8FE0C7,#93C5FD); }

  .dash-grid { display: flex; gap: 20px; align-items: flex-start; }
  .dash-main { flex: 1.3; min-width: 0; }
  .dash-side { flex: 1; min-width: 0; }

  .preview-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .preview-head h3 { margin: 0; font-size: 14px; font-weight: 700; }
  .preview-head a { font-size: 11.5px; color: #8B5FE0; text-decoration: none; font-weight: 600; }
  .preview-item { background: #fff; border-radius: 12px; padding: 11px 14px; margin-bottom: 8px;
                   border: 1px solid #F0EDF9; font-size: 12.5px; }
  .preview-item .ptext { font-weight: 600; margin-bottom: 3px; }
  .preview-item .pmeta { font-size: 11px; color: #ADA8C4; }
  .preview-empty { color: #B7B3CC; font-size: 12px; padding: 16px; text-align: center; background: #fff;
                    border-radius: 12px; border: 1px dashed #E7E3F6; }
  .preview-block { margin-bottom: 22px; }

  .cal-widget { background: #fff; border-radius: 16px; padding: 18px; border: 1px solid #F0EDF9;
                box-shadow: 0 1px 2px rgba(103,90,163,0.04); margin-bottom: 20px; }
  .cal-head { font-size: 13.5px; font-weight: 800; margin-bottom: 12px; text-align: center; color: #2E2C42; }
  .cal-row { display: flex; gap: 3px; margin-bottom: 3px; }
  .cal-dow { flex: 1; text-align: center; font-size: 10px; color: #C2BEDA; font-weight: 700; padding-bottom: 2px; }
  .cal-day { flex: 1; aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
             font-size: 11.5px; border-radius: 8px; color: #6E6A87; position: relative; }
  .cal-day.empty { visibility: hidden; }
  .cal-day.today { background: #5B3FBF; color: #fff; font-weight: 800; }
  .cal-day.has-event:not(.today) { background: #E1EAFB; font-weight: 700; color: #2358A8; }
  .cal-dot { position: absolute; bottom: 2px; width: 4px; height: 4px; border-radius: 50%; background: #8B5FE0; }
  .cal-day.today .cal-dot { background: #fff; }
  .cal-legend { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: #B7B3CC; margin-top: 10px; justify-content: center; }
  .cal-legend .dot { width: 6px; height: 6px; border-radius: 50%; background: #8B5FE0; }
</style>
</head>
<body>
<div class="app-shell">
{{ sidebar|safe }}
<main class="content"><div class="content-inner" style="max-width:1080px;">
  <h1>안녕하세요, {{ profile_name }}님 👋</h1>
  <div class="sub">오늘의 업무 현황이에요</div>

  <div class="stat-grid">
    <a href="/list?category=todo" class="stat-card c-todo"><div class="num">{{ stats.todo }}건</div><div class="lbl">✅ 할 일</div></a>
    <a href="/list?category=calendar" class="stat-card c-calendar"><div class="num">{{ stats.calendar }}건</div><div class="lbl">📅 일정</div></a>
    <a href="/review" class="stat-card c-suggestion"><div class="num">{{ stats.suggestion }}건</div><div class="lbl">📋 새 제안</div></a>
    <a href="/list?category=notice" class="stat-card c-notice"><div class="num">{{ stats.notice }}건</div><div class="lbl">🔔 공지</div></a>
  </div>

  <div class="quick-grid">
    <a href="/analyze" class="quick-card analyze">
      <div class="qicon">✨</div>
      <div><div class="qtitle">새 메시지 분석</div><div class="qsub">대화 붙여넣고 AI로 자동 분류</div></div>
    </a>
    <a href="/add" class="quick-card add">
      <div class="qicon">➕</div>
      <div><div class="qtitle">빠른 추가</div><div class="qsub">AI 없이 바로 저장</div></div>
    </a>
  </div>

  <div class="dash-grid">
    <div class="dash-main">
      <div class="preview-block">
        <div class="preview-head"><h3>✅ 할 일</h3><a href="/list?category=todo">더보기 →</a></div>
        {% if todo_preview|length == 0 %}
          <div class="preview-empty">할 일이 없어요</div>
        {% endif %}
        {% for t in todo_preview %}
          <div class="preview-item"><div class="ptext">{{ t['content'] }}</div>
            <div class="pmeta">{{ t['sender'] or '수동 입력' }} · {{ t['created_utc'][:10] if t['created_utc'] else '' }}</div></div>
        {% endfor %}
      </div>
      <div class="preview-block">
        <div class="preview-head"><h3>📅 다가오는 일정</h3><a href="/list?category=calendar">더보기 →</a></div>
        {% if calendar_preview|length == 0 %}
          <div class="preview-empty">등록된 일정이 없어요</div>
        {% endif %}
        {% for c in calendar_preview %}
          <div class="preview-item"><div class="ptext">{{ c['content'] }}</div>
            <div class="pmeta">{{ c['event_subtype'] or '' }}{% if c['sender'] %} · {{ c['sender'] }}{% endif %}</div></div>
        {% endfor %}
      </div>
    </div>

    <div class="dash-side">
      <div class="cal-widget">
        <div class="cal-head">{{ cal.year }}년 {{ cal.month }}월</div>
        <div class="cal-row">
          {% for dow in ['일','월','화','수','목','금','토'] %}<div class="cal-dow">{{ dow }}</div>{% endfor %}
        </div>
        {% for week in cal.weeks %}
        <div class="cal-row">
          {% for day in week %}
          <div class="cal-day {{ 'empty' if day == 0 else '' }} {{ 'today' if day == cal.today else '' }} {{ 'has-event' if day in cal.day_items else '' }}">
            {% if day != 0 %}{{ day }}{% endif %}
            {% if day in cal.day_items %}<span class="cal-dot"></span>{% endif %}
          </div>
          {% endfor %}
        </div>
        {% endfor %}
        <div class="cal-legend"><span class="dot"></span> 일정 있는 날</div>
      </div>
    </div>
  </div>
</div></main>
</div>
</body>
</html>
"""


@app.route("/")
def dashboard():
    from flask import render_template_string
    stats, todo_preview, calendar_preview = _dashboard_data()
    cal = _build_calendar_grid()
    return render_template_string(
        DASHBOARD_HTML, stats=stats, todo_preview=todo_preview, calendar_preview=calendar_preview, cal=cal,
        profile_name=PROFILE_NAME, shared_css=SHARED_CSS, sidebar=sidebar_html("home"),
    )


@app.route("/review")
def review_list():
    from flask import render_template_string

    category_filter = request.args.get("category", "all")
    page = max(1, int(request.args.get("page", 1)))
    offset = (page - 1) * PAGE_SIZE

    conn = get_conn()
    cur = conn.cursor()

    total_pending = cur.execute(
        "SELECT COUNT(*) FROM suggestions WHERE review_status='pending'"
    ).fetchone()[0]

    if category_filter != "all":
        rows = cur.execute(
            "SELECT * FROM suggestions WHERE review_status='pending' AND suggested_category=? "
            "ORDER BY id LIMIT ? OFFSET ?",
            (category_filter, PAGE_SIZE, offset),
        ).fetchall()
        filtered_total = cur.execute(
            "SELECT COUNT(*) FROM suggestions WHERE review_status='pending' AND suggested_category=?",
            (category_filter,),
        ).fetchone()[0]
    else:
        rows = cur.execute(
            "SELECT * FROM suggestions WHERE review_status='pending' ORDER BY id LIMIT ? OFFSET ?",
            (PAGE_SIZE, offset),
        ).fetchall()
        filtered_total = total_pending

    cat_counts = dict(cur.execute(
        "SELECT suggested_category, COUNT(*) FROM suggestions WHERE review_status='pending' "
        "GROUP BY suggested_category ORDER BY suggested_category"
    ).fetchall())

    conn.close()

    has_next = offset + PAGE_SIZE < filtered_total
    return render_template_string(
        PAGE_HTML,
        rows=rows,
        total_pending=total_pending,
        filtered_total=filtered_total,
        category_filter=category_filter,
        cat_counts=cat_counts,
        categories=CATEGORIES,
        page=page,
        has_next=has_next,
        return_url=request.full_path,
        shared_css=SHARED_CSS,
        sidebar=sidebar_html("review"),
    )


@app.route("/action/<int:suggestion_id>", methods=["POST"])
def action(suggestion_id):
    action_type = request.form.get("action")
    chosen_category = request.form.get("category")
    return_url = request.form.get("return_url") or "/"

    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM suggestions WHERE id=?", (suggestion_id,)).fetchone()
    if row is None:
        conn.close()
        return redirect(return_url)

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    if action_type == "approve":
        final_category = chosen_category if chosen_category in CATEGORIES else row["suggested_category"]
        review_status = "approved" if final_category == row["suggested_category"] else "edited"

        _insert_by_category(
            cur, row["source"], row["event_id"], final_category, row["sender"], row["sender_dept"],
            row["content"], row["created_utc"], row["deadline_or_date"], row["summary"],
        )
        cur.execute(
            "UPDATE suggestions SET review_status=?, final_category=?, reviewed_utc=? WHERE id=?",
            (review_status, final_category, now, suggestion_id),
        )
        cur.execute(
            "UPDATE processed_messages SET category=?, stage='llm', confidence=1.0, reason=? "
            "WHERE source=? AND event_id=?",
            (final_category, f"user_{review_status}", row["source"], row["event_id"]),
        )

    elif action_type == "reject":
        cur.execute(
            "UPDATE suggestions SET review_status='rejected', final_category='ignore', reviewed_utc=? WHERE id=?",
            (now, suggestion_id),
        )
        cur.execute(
            "UPDATE processed_messages SET category='ignore', stage='llm', confidence=1.0, reason='user_rejected' "
            "WHERE source=? AND event_id=?",
            (row["source"], row["event_id"]),
        )

    conn.commit()
    conn.close()
    return redirect(return_url)


QUICK_ACTION_HTML = """
<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
@font-face {{ font-family: 'Pretendard'; font-weight: 700; font-display: swap; src: url('/fonts/Pretendard-Bold.woff2') format('woff2'); }}
body{{font-family:"Pretendard","Malgun Gothic","맑은 고딕",-apple-system,sans-serif;background:#F8F7FC;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}}
.card{{background:#fff;padding:32px 40px;border-radius:16px;box-shadow:0 10px 26px -16px rgba(103,90,163,0.25);text-align:center;border:1px solid #F0EDF9;}}
.ok{{color:#2E9E6B;font-size:32px;}}</style></head>
<body><div class="card"><div class="ok">✓</div><p>{message}</p>
<p style="color:#ADA8C4;font-size:12.5px;">이 창은 닫으셔도 됩니다</p></div></body></html>
"""


@app.route("/quick/<int:suggestion_id>/approve")
def quick_approve(suggestion_id):
    """토스트 알림의 '승인' 버튼에서 호출됨 - 제안된 카테고리 그대로 즉시 확정."""
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM suggestions WHERE id=?", (suggestion_id,)).fetchone()
    if row is None:
        conn.close()
        return QUICK_ACTION_HTML.format(message="이미 처리됐거나 없는 항목입니다")
    if row["review_status"] != "pending":
        conn.close()
        return QUICK_ACTION_HTML.format(message=f"이미 '{row['review_status']}' 처리된 항목입니다")

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    category = row["suggested_category"]
    _insert_by_category(
        cur, row["source"], row["event_id"], category, row["sender"], row["sender_dept"],
        row["content"], row["created_utc"], row["deadline_or_date"], row["summary"],
    )
    cur.execute(
        "UPDATE suggestions SET review_status='approved', final_category=?, reviewed_utc=? WHERE id=?",
        (category, now, suggestion_id),
    )
    cur.execute(
        "UPDATE processed_messages SET category=?, stage='llm', confidence=1.0, reason='user_approved_quick' "
        "WHERE source=? AND event_id=?",
        (category, row["source"], row["event_id"]),
    )
    conn.commit()
    conn.close()
    return QUICK_ACTION_HTML.format(message=f"'{category}'(으)로 등록했습니다")


@app.route("/quick/<int:suggestion_id>/reject")
def quick_reject(suggestion_id):
    """토스트 알림의 '무시' 버튼에서 호출됨."""
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM suggestions WHERE id=?", (suggestion_id,)).fetchone()
    if row is None:
        conn.close()
        return QUICK_ACTION_HTML.format(message="이미 처리됐거나 없는 항목입니다")
    if row["review_status"] != "pending":
        conn.close()
        return QUICK_ACTION_HTML.format(message=f"이미 '{row['review_status']}' 처리된 항목입니다")

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    cur.execute(
        "UPDATE suggestions SET review_status='rejected', final_category='ignore', reviewed_utc=? WHERE id=?",
        (now, suggestion_id),
    )
    cur.execute(
        "UPDATE processed_messages SET category='ignore', stage='llm', confidence=1.0, reason='user_rejected_quick' "
        "WHERE source=? AND event_id=?",
        (row["source"], row["event_id"]),
    )
    conn.commit()
    conn.close()
    return QUICK_ACTION_HTML.format(message="무시 처리했습니다")


MANUAL_CATEGORIES = ["todo", "calendar", "notice", "reference"]


def _insert_manual(cur, category: str, content: str, sender: str | None, event_subtype: str | None) -> str:
    """AI 없이 사람이 직접 입력한 항목을 바로 확정 테이블에 저장한다.
    LLM 제안 경로(_insert_by_category)와 분리한 이유: calendar의 event_subtype
    기본값이 'llm:...'로 채워지면 수동 입력인데 AI가 만든 것처럼 보여서 헷갈림."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    event_id = f"manual-{uuid.uuid4().hex[:10]}"
    source = "manual"

    cur.execute(
        "INSERT INTO processed_messages (source, event_id, processed_utc, category, stage, confidence, reason) "
        "VALUES (?,?,?,?,?,?,?)",
        (source, event_id, now, category, "manual", 1.0, "manual_quick_add"),
    )
    if category == "todo":
        cur.execute(
            "INSERT INTO todo (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, None, content, now),
        )
    elif category == "calendar":
        cur.execute(
            "INSERT INTO calendar (source, event_id, sender, sender_dept, event_subtype, content, created_utc) "
            "VALUES (?,?,?,?,?,?,?)",
            (source, event_id, sender, None, event_subtype or "수동입력", content, now),
        )
    elif category == "notice":
        cur.execute(
            "INSERT INTO notice (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, None, content, now),
        )
    elif category == "reference":
        cur.execute(
            "INSERT INTO reference (source, event_id, sender, sender_dept, content, created_utc) VALUES (?,?,?,?,?,?)",
            (source, event_id, sender, None, content, now),
        )
    return event_id


ADD_PAGE_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>잇다 - 빠른 추가</title>
<style>
{{ shared_css|safe }}
  .banner { background: #E3F7EC; color: #1F6E48; padding: 9px 14px; border-radius: 10px; margin-bottom: 16px; font-size: 13px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 120px; padding: 12px; border-radius: 10px;
             border: 1px solid #E7E3F6; font-size: 14px; font-family: inherit; resize: vertical; }
  .cat-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
  .cat-grid button.cat { flex: 1 1 calc(50% - 5px); min-width: 140px; }
  button.cat { padding: 15px; border-radius: 12px; border: none; cursor: pointer; font-size: 14px; font-weight: 700; }
  button.cat.todo { background: #C9F0DC; color: #1F6E48; }
  button.cat.calendar { background: #D6E7FC; color: #2358A8; }
  button.cat.notice { background: #E9DCFA; color: #6B3FA0; }
  button.cat.reference { background: #EAE8F2; color: #5C577A; }
  .extra { margin-top: 14px; }
  .extra input { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid #E7E3F6;
                 font-size: 12.5px; margin-top: 4px; }
  .extra label { font-size: 11.5px; color: #9691AB; font-weight: 600; }
</style>
</head>
<body>
<div class="app-shell">
{{ sidebar|safe }}
<main class="content"><div class="content-inner">
  <h1>빠른 추가</h1>
  <div class="sub">메시지 내용 붙여넣고, 카테고리 버튼 한 번 누르면 바로 저장됩니다 (AI 안 거침)</div>
  {% if saved %}<div class="banner">✓ {{ saved }}건 저장했습니다. 계속 추가하세요.</div>{% endif %}
  {% if error %}<div class="banner" style="background:#FCE9E9;color:#9E3B3B;">{{ error }}</div>{% endif %}
  <div class="card">
    <form method="post" action="/add">
      <textarea name="content" placeholder="여기에 메시지 내용을 붙여넣으세요..." autofocus>{{ content }}</textarea>
      <div class="extra">
        <label>발신자 (선택)</label>
        <input type="text" name="sender" placeholder="예: 김민준" value="{{ sender }}">
        <label style="margin-top:8px;display:block;">일정 날짜/시간 (선택, calendar일 때만 사용)</label>
        <input type="text" name="event_subtype" placeholder="예: 8월 5일 오전 10시" value="{{ event_subtype }}">
      </div>
      <div class="cat-grid">
        <button type="submit" name="category" value="todo" class="cat todo">✅ 할 일</button>
        <button type="submit" name="category" value="calendar" class="cat calendar">📅 일정</button>
        <button type="submit" name="category" value="notice" class="cat notice">🔔 공지</button>
        <button type="submit" name="category" value="reference" class="cat reference">📎 참고</button>
      </div>
    </form>
  </div>
</div></main>
</div>
</body>
</html>
"""


@app.route("/add", methods=["GET", "POST"])
def quick_add():
    from flask import render_template_string

    if request.method == "GET":
        saved = request.args.get("saved")
        return render_template_string(ADD_PAGE_HTML, saved=saved, error=None, content="", sender="", event_subtype="",
                                       shared_css=SHARED_CSS, sidebar=sidebar_html("add"))

    content = request.form.get("content", "").strip()
    category = request.form.get("category", "")
    sender = request.form.get("sender", "").strip() or None
    event_subtype = request.form.get("event_subtype", "").strip() or None

    if not content or category not in MANUAL_CATEGORIES:
        return render_template_string(
            ADD_PAGE_HTML, saved=False, error="내용을 입력하고 카테고리를 선택해주세요",
            content=content, sender=sender or "", event_subtype=event_subtype or "",
            shared_css=SHARED_CSS, sidebar=sidebar_html("add"),
        )

    conn = get_conn()
    cur = conn.cursor()
    _insert_manual(cur, category, content, sender, event_subtype)
    conn.commit()
    conn.close()

    return redirect("/add?saved=1")


LIST_TABLES = ["todo", "calendar", "notice", "reference"]
LIST_CATEGORY_LABELS = {"todo": "할 일", "calendar": "일정", "notice": "공지", "reference": "참고"}
LIST_CATEGORY_COLORS = {"todo": "#7FD8AE", "calendar": "#8FBDF5", "notice": "#C9A8F0", "reference": "#C8C4DA"}
LIST_CATEGORY_TEXT_COLORS = {"todo": "#1F6E48", "calendar": "#2358A8", "notice": "#6B3FA0", "reference": "#5C577A"}


def _fetch_list_items(category_filter: str, status_filter: str, sort: str = "newest"):
    conn = get_conn()
    cur = conn.cursor()
    tables = LIST_TABLES if category_filter == "all" else [category_filter]
    items = []
    for t in tables:
        if t == "reference":
            rows = cur.execute(
                "SELECT id, sender, sender_dept, content, created_utc FROM reference ORDER BY id DESC"
            ).fetchall()
            for r in rows:
                items.append({"table": t, "id": r["id"], "sender": r["sender"], "sender_dept": r["sender_dept"],
                              "content": r["content"], "created_utc": r["created_utc"],
                              "event_subtype": None, "status": None, "pinned": False})
        else:
            sql = f"SELECT id, sender, sender_dept, content, created_utc, status, pinned" \
                  f"{', event_subtype' if t == 'calendar' else ''} FROM {t}"
            params = []
            if status_filter != "all":
                sql += " WHERE status = ?"
                params.append(status_filter)
            sql += " ORDER BY id DESC"
            rows = cur.execute(sql, params).fetchall()
            for r in rows:
                items.append({"table": t, "id": r["id"], "sender": r["sender"], "sender_dept": r["sender_dept"],
                              "content": r["content"], "created_utc": r["created_utc"],
                              "event_subtype": r["event_subtype"] if t == "calendar" else None,
                              "status": r["status"], "pinned": bool(r["pinned"])})
    conn.close()

    if sort == "oldest":
        items.sort(key=lambda x: (x["created_utc"] or "", x["id"]))
    elif sort == "category":
        # 안정 정렬(stable sort) 활용: 먼저 최신순으로 정렬해서 카테고리 안에서의 순서를 만들고,
        # 그 다음 카테고리 기준으로 다시 정렬하면 "카테고리별로 묶이되 그 안은 최신순"이 됨
        items.sort(key=lambda x: (x["created_utc"] or "", x["id"]), reverse=True)
        order = {t: i for i, t in enumerate(LIST_TABLES)}
        items.sort(key=lambda x: order.get(x["table"], 99))
    else:  # newest (기본값)
        items.sort(key=lambda x: (x["created_utc"] or "", x["id"]), reverse=True)
    return items


def _group_items(items: list, sort: str):
    """정렬 방식에 맞춰 항목들을 섹션으로 묶는다 (날짜별 또는 카테고리별)."""
    from itertools import groupby

    if sort == "category":
        key_fn = lambda x: LIST_CATEGORY_LABELS.get(x["table"], x["table"])
    else:
        key_fn = lambda x: (x["created_utc"] or "")[:10] or "날짜 미상"

    return [(key, list(grp)) for key, grp in groupby(items, key=key_fn)]


LIST_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>잇다 - 내 목록</title>
<style>
{{ shared_css|safe }}
  .filters { margin-bottom: 18px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  .filter-left { display: flex; gap: 8px; flex-wrap: wrap; }
  .filters a { display: inline-block; padding: 7px 14px; border-radius: 999px;
               background: #fff; border: 1px solid #ECE8F7; text-decoration: none; color: #6E6A87; font-size: 13px; font-weight: 500; }
  .filters a.active { background: #5B3FBF; color: #fff; border-color: #5B3FBF; }
  .sort-select { padding: 7px 12px; border-radius: 999px; border: 1px solid #ECE8F7; background: #fff;
                 color: #6E6A87; font-size: 12.5px; font-weight: 500; cursor: pointer; }
  .status-tabs { margin-bottom: 16px; }
  .status-tabs a { color: #ADA8C4; text-decoration: none; font-size: 12.5px; margin-right: 14px; padding-bottom: 4px; }
  .status-tabs a.active { color: #2E2C42; font-weight: 700; border-bottom: 2px solid #5B3FBF; }
  .bulk-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
  .search-input { flex: 1; min-width: 160px; padding: 8px 12px; border-radius: 999px; border: 1px solid #ECE8F7;
                   background: #fff; font-size: 12.5px; color: #34324A; }
  .select-all-label { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #6E6A87;
                       cursor: pointer; white-space: nowrap; }
  .select-all-label input { width: 15px; height: 15px; cursor: pointer; accent-color: #8B5FE0; }
  .selected-count { font-size: 11.5px; color: #ADA8C4; white-space: nowrap; }
  .bulk-delete-btn { padding: 7px 14px; border-radius: 999px; border: none; background: #FCE9E9; color: #9E3B3B;
                      font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .bulk-delete-btn:disabled { background: #F3F1F8; color: #C7C2D6; cursor: default; }
  .no-results { padding: 30px; text-align: center; color: #B7B3CC; font-size: 13px; }
  .item-select-cb { width: 16px; height: 16px; margin-top: 3px; cursor: pointer; accent-color: #5B3FBF; flex-shrink: 0; }
  .group-head { font-size: 12.5px; font-weight: 700; color: #9691AB; margin: 22px 0 10px; text-transform: uppercase; letter-spacing: 0.3px; }
  .group-head:first-of-type { margin-top: 0; }
  .item { background: #fff; border-radius: 13px; padding: 15px 18px; margin-bottom: 10px;
          box-shadow: 0 1px 2px rgba(103,90,163,0.04); border: 1px solid #F0EDF9;
          display: flex; align-items: flex-start; gap: 12px; }
  .item.done { opacity: 0.55; }
  .item.done .content-text { text-decoration: line-through; }
  .item form.toggle { margin: 0; }
  .item input[type=checkbox] { width: 19px; height: 19px; margin-top: 2px; cursor: pointer; accent-color: #8B5FE0; }
  .item .body { flex: 1; min-width: 0; }
  .cat-tag { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
             margin-right: 8px; letter-spacing: 0.2px; }
  .content-text { font-size: 14.5px; font-weight: 600; margin: 4px 0 4px 0; word-break: break-word; white-space: pre-wrap; }
  .item-meta { font-size: 12px; color: #ADA8C4; }
  .item-actions { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
  .item-edit, .item-del, .item-pin { border: none; background: none; color: #D9D5EA; cursor: pointer; font-size: 14px; padding: 4px 6px; border-radius: 6px; }
  .item-edit:hover { color: #8B5FE0; background: #EEE9FC; }
  .item-del:hover { color: #E0645E; background: #FCE9E9; }
  .item-pin:hover { color: #E0A73E; background: #FDF1D9; }
  .item-pin.pinned { color: #E0A73E; }
  .edit-box { margin-top: 8px; padding: 10px; background: #FAF9FD; border-radius: 10px; border: 1px solid #ECE8F7; }
  .edit-box .edit-subtype { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px;
                             border: 1px solid #E7E3F6; font-size: 12.5px; margin-bottom: 6px; }
  .edit-box .edit-content { width: 100%; box-sizing: border-box; min-height: 60px; padding: 7px 9px; border-radius: 7px;
                             border: 1px solid #E7E3F6; font-size: 12.5px; font-family: inherit; resize: vertical; }
  .edit-actions { display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end; }
  .edit-cancel { padding: 6px 12px; border-radius: 7px; border: 1px solid #E7E3F6; background: #fff; color: #9691AB;
                 font-size: 11.5px; font-weight: 600; cursor: pointer; }
  .edit-save { padding: 6px 12px; border-radius: 7px; border: none; background: linear-gradient(90deg,#A78BFA,#93C5FD);
               color: #fff; font-size: 11.5px; font-weight: 700; cursor: pointer; }
  .empty { padding: 48px; text-align: center; color: #9691AB; background: #fff; border-radius: 14px; }
</style>
</head>
<body>
<div class="app-shell">
{{ sidebar|safe }}
<main class="content"><div class="content-inner">
  <h1>{{ page_title }}</h1>
  <div class="sub">저장된 할 일 / 일정 / 공지 / 참고를 한눈에 확인하세요</div>

  <div class="filters">
    <div class="filter-left">
      <a href="/list?category=all&status={{ status_filter }}&sort={{ sort }}" class="{{ 'active' if category_filter == 'all' else '' }}">전체</a>
      {% for c in categories %}
      <a href="/list?category={{ c }}&status={{ status_filter }}&sort={{ sort }}" class="{{ 'active' if category_filter == c else '' }}">{{ labels[c] }}</a>
      {% endfor %}
    </div>
    <select class="sort-select" onchange="location.href='/list?category={{ category_filter }}&status={{ status_filter }}&sort=' + this.value">
      <option value="newest" {{ 'selected' if sort == 'newest' else '' }}>최신순</option>
      <option value="oldest" {{ 'selected' if sort == 'oldest' else '' }}>오래된순</option>
      <option value="category" {{ 'selected' if sort == 'category' else '' }}>카테고리순</option>
    </select>
  </div>
  <div class="status-tabs">
    <a href="/list?category={{ category_filter }}&status=all&sort={{ sort }}" class="{{ 'active' if status_filter == 'all' else '' }}">전체 보기</a>
    <a href="/list?category={{ category_filter }}&status=pending&sort={{ sort }}" class="{{ 'active' if status_filter == 'pending' else '' }}">진행 중</a>
    <a href="/list?category={{ category_filter }}&status=done&sort={{ sort }}" class="{{ 'active' if status_filter == 'done' else '' }}">완료</a>
  </div>

  <div class="bulk-bar">
    <input type="text" class="search-input" id="searchInput" placeholder="🔍 내용 검색..." oninput="filterItems()">
    <label class="select-all-label">
      <input type="checkbox" id="selectAllCb" onchange="toggleSelectAll(this.checked)"> 전체 선택
    </label>
    <span class="selected-count" id="selectedCount"></span>
    <button type="button" class="bulk-delete-btn" id="bulkDeleteBtn" onclick="bulkDelete()" disabled>🗑 선택 삭제</button>
  </div>

  {% if groups|length == 0 %}
    <div class="empty">아직 저장된 항목이 없어요.<br>"빠른 추가"나 "분석하기"로 항목을 등록해보세요.</div>
  {% else %}
    <div class="no-results" id="noResults" style="display:none;">검색 결과가 없어요.</div>
    {% for group_label, group_items in groups %}
    <div class="group-head">{{ group_label }}</div>
    {% for it in group_items %}
    <div class="item {{ 'done' if it.status == 'done' else '' }}" id="item-{{ it.table }}-{{ it.id }}"
         data-search="{{ (it.content ~ ' ' ~ (it.sender or '') ~ ' ' ~ (it.event_subtype or ''))|lower }}">
      <input type="checkbox" class="item-select-cb" data-table="{{ it.table }}" data-id="{{ it.id }}"
             onchange="updateBulkBar()">
      {% if it.table != 'reference' %}
      <form class="toggle" method="post" action="/list/toggle/{{ it.table }}/{{ it.id }}">
        <input type="hidden" name="return_url" value="{{ return_url }}">
        <input type="checkbox" onchange="this.form.submit()" {{ 'checked' if it.status == 'done' else '' }}>
      </form>
      {% else %}
      <div style="width:19px;"></div>
      {% endif %}
      <div class="body">
        <span class="cat-tag" style="background:{{ colors[it.table] }};color:{{ text_colors[it.table] }};">{{ labels[it.table] }}</span>
        <span class="item-meta" id="subtype-display-{{ it.table }}-{{ it.id }}">{{ it.event_subtype or '' }}</span>
        <div class="content-text" id="content-display-{{ it.table }}-{{ it.id }}">{{ it.content }}</div>
        <div class="item-meta">{{ it.sender or '수동 입력' }}{% if it.sender_dept %} · {{ it.sender_dept }}{% endif %} · {{ it.created_utc[:16] if it.created_utc else '' }}</div>

        <div class="edit-box" id="edit-form-{{ it.table }}-{{ it.id }}" style="display:none;">
          {% if it.table == 'calendar' %}
          <input type="text" class="edit-subtype" id="edit-subtype-{{ it.table }}-{{ it.id }}"
                 value="{{ it.event_subtype or '' }}" placeholder="날짜/시간 (예: 8월 6일 오전 10시)">
          {% endif %}
          <textarea class="edit-content" id="edit-content-{{ it.table }}-{{ it.id }}">{{ it.content }}</textarea>
          <div class="edit-actions">
            <button type="button" class="edit-cancel" onclick="cancelEdit('{{ it.table }}', {{ it.id }})">취소</button>
            <button type="button" class="edit-save" onclick="saveEdit('{{ it.table }}', {{ it.id }})">저장</button>
          </div>
        </div>
      </div>
      <div class="item-actions">
        {% if it.table != 'reference' %}
        <form method="post" action="/list/pin/{{ it.table }}/{{ it.id }}">
          <input type="hidden" name="return_url" value="{{ return_url }}">
          <button type="submit" class="item-pin {{ 'pinned' if it.pinned else '' }}" title="{{ '포스트잇 고정 해제' if it.pinned else '포스트잇에 고정' }}">📌</button>
        </form>
        {% endif %}
        <button type="button" class="item-edit" onclick="startEdit('{{ it.table }}', {{ it.id }})" title="수정">✏️</button>
        <form method="post" action="/list/delete/{{ it.table }}/{{ it.id }}"
              onsubmit="return confirm('이 항목을 삭제할까요? 되돌릴 수 없어요.');">
          <input type="hidden" name="return_url" value="{{ return_url }}">
          <button type="submit" class="item-del" title="삭제">🗑</button>
        </form>
      </div>
    </div>
    {% endfor %}
    {% endfor %}
  {% endif %}
</div></main>
</div>
<script>
function filterItems() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const items = document.querySelectorAll('.item');
  let visibleCount = 0;
  items.forEach(el => {
    const match = !q || (el.dataset.search || '').includes(q);
    el.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });
  // 검색으로 다 가려진 그룹 헤더도 숨기기
  document.querySelectorAll('.group-head').forEach(gh => {
    let sib = gh.nextElementSibling;
    let hasVisible = false;
    while (sib && !sib.classList.contains('group-head')) {
      if (sib.classList.contains('item') && sib.style.display !== 'none') hasVisible = true;
      sib = sib.nextElementSibling;
    }
    gh.style.display = hasVisible ? '' : 'none';
  });
  document.getElementById('noResults').style.display = (visibleCount === 0 && q) ? '' : 'none';
}

function toggleSelectAll(checked) {
  document.querySelectorAll('.item-select-cb').forEach(cb => {
    const item = cb.closest('.item');
    if (item.style.display !== 'none') cb.checked = checked;  // 검색으로 숨겨진 건 제외
  });
  updateBulkBar();
}

function updateBulkBar() {
  const checked = document.querySelectorAll('.item-select-cb:checked');
  const countEl = document.getElementById('selectedCount');
  const btn = document.getElementById('bulkDeleteBtn');
  countEl.textContent = checked.length > 0 ? `${checked.length}개 선택됨` : '';
  btn.disabled = checked.length === 0;
}

async function bulkDelete() {
  const checked = [...document.querySelectorAll('.item-select-cb:checked')];
  if (checked.length === 0) return;
  if (!confirm(`선택한 ${checked.length}개 항목을 삭제할까요? 되돌릴 수 없어요.`)) return;

  const items = checked.map(cb => ({table: cb.dataset.table, id: parseInt(cb.dataset.id)}));
  const btn = document.getElementById('bulkDeleteBtn');
  btn.disabled = true;
  btn.textContent = '삭제 중...';
  try {
    const resp = await fetch('/api/list/bulk_delete', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({items})
    });
    const data = await resp.json();
    if (data.ok) {
      checked.forEach(cb => cb.closest('.item').remove());
      document.getElementById('selectAllCb').checked = false;
      updateBulkBar();
    } else {
      alert('삭제 실패: ' + (data.error || '알 수 없는 오류'));
    }
  } catch (e) {
    alert('삭제 중 오류가 발생했습니다: ' + e);
  } finally {
    btn.textContent = '🗑 선택 삭제';
  }
}

function startEdit(table, id) {
  document.getElementById(`content-display-${table}-${id}`).style.display = 'none';
  const subtypeDisplay = document.getElementById(`subtype-display-${table}-${id}`);
  if (subtypeDisplay) subtypeDisplay.style.display = 'none';
  document.getElementById(`edit-form-${table}-${id}`).style.display = 'block';
}
function cancelEdit(table, id) {
  document.getElementById(`content-display-${table}-${id}`).style.display = '';
  const subtypeDisplay = document.getElementById(`subtype-display-${table}-${id}`);
  if (subtypeDisplay) subtypeDisplay.style.display = '';
  document.getElementById(`edit-form-${table}-${id}`).style.display = 'none';
}
async function saveEdit(table, id) {
  const contentInput = document.getElementById(`edit-content-${table}-${id}`);
  const content = contentInput.value.trim();
  if (!content) { alert('내용을 입력해주세요'); return; }
  const subtypeInput = document.getElementById(`edit-subtype-${table}-${id}`);
  const eventSubtype = subtypeInput ? subtypeInput.value.trim() : null;

  try {
    const resp = await fetch('/api/list/update', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({table, id, content, event_subtype: eventSubtype})
    });
    const data = await resp.json();
    if (data.ok) {
      document.getElementById(`content-display-${table}-${id}`).textContent = content;
      const subtypeDisplay = document.getElementById(`subtype-display-${table}-${id}`);
      if (subtypeDisplay) subtypeDisplay.textContent = eventSubtype || '';
      cancelEdit(table, id);
    } else {
      alert('저장 실패: ' + (data.error || '알 수 없는 오류'));
    }
  } catch (e) {
    alert('저장 중 오류가 발생했습니다: ' + e);
  }
}
</script>
</body>
</html>
"""


@app.route("/list")
def list_view():
    from flask import render_template_string

    category_filter = request.args.get("category", "all")
    status_filter = request.args.get("status", "all")
    sort = request.args.get("sort", "newest")
    if category_filter not in ["all"] + LIST_TABLES:
        category_filter = "all"
    if status_filter not in ("all", "pending", "done"):
        status_filter = "all"
    if sort not in ("newest", "oldest", "category"):
        sort = "newest"

    items = _fetch_list_items(category_filter, status_filter, sort)
    groups = _group_items(items, sort)

    # 사이드바의 "할 일 목록"/"캘린더 일정"/"완료된 항목" 중 지금 필터와 정확히 일치하는
    # 것만 활성 표시되게 함 (그 외 조합으로 들어오면 아무것도 활성 표시 안 됨 - 정상)
    if status_filter == "done":
        active_key = "done_list"
        page_title = "완료된 항목"
    elif category_filter == "todo":
        active_key = "todo_list"
        page_title = "할 일 목록"
    elif category_filter == "calendar":
        active_key = "calendar_list"
        page_title = "캘린더 일정"
    else:
        active_key = "list"
        page_title = "내 목록"

    return render_template_string(
        LIST_HTML, groups=groups, category_filter=category_filter, status_filter=status_filter, sort=sort,
        categories=LIST_TABLES, labels=LIST_CATEGORY_LABELS, colors=LIST_CATEGORY_COLORS,
        text_colors=LIST_CATEGORY_TEXT_COLORS,
        return_url=request.full_path, page_title=page_title,
        shared_css=SHARED_CSS, sidebar=sidebar_html(active_key),
    )


POSTIT_CARD_COLORS = {"todo": "#FFF3B0", "calendar": "#B9E6D8", "notice": "#FBC9D9"}
POSTIT_COLOR_PRESETS = ["#FFF3B0", "#FBC9D9", "#B9E6D8", "#B8D9F5", "#DCC9F5", "#FFD6A5"]


def _fetch_postit_cards():
    """포스트잇에 보여줄 카드 전체를 가져온다 - 내 목록에서 고정(pinned)한 항목 +
    포스트잇에서 직접 만든 자유 메모를 한 리스트로 합쳐서 반환."""
    conn = get_conn()
    cur = conn.cursor()
    cards = []
    for t in ("todo", "calendar", "notice"):
        extra = ", event_subtype" if t == "calendar" else ""
        rows = cur.execute(
            f"SELECT id, content, status, color{extra} FROM {t} WHERE pinned=1 ORDER BY id DESC"
        ).fetchall()
        for r in rows:
            cards.append({
                "kind": "pinned", "table": t, "id": r["id"], "content": r["content"],
                "status": r["status"], "color": r["color"] or POSTIT_CARD_COLORS[t],
                "event_subtype": r["event_subtype"] if t == "calendar" else None,
                "tag": LIST_CATEGORY_LABELS[t],
            })
    memo_rows = cur.execute("SELECT id, content, color, status FROM memo ORDER BY id DESC").fetchall()
    for r in memo_rows:
        cards.append({
            "kind": "memo", "table": None, "id": r["id"], "content": r["content"],
            "status": r["status"], "color": r["color"] or "#FFF3B0", "event_subtype": None,
            "tag": "메모",
        })
    conn.close()
    return cards


# --- 포스트잇 카드 하나짜리 UI(다음 두 화면에서 공통으로 씀) + 인터랙션 JS ---
POSTIT_CARD_CSS = """
  .postit-card { border-radius: 6px; padding: 10px 12px; position: relative; font-size: 12.5px; color: #3A3652;
                 box-shadow: 1px 3px 8px rgba(0,0,0,0.14); }
  .postit-card.done { opacity: 0.5; }
  .postit-card.done .ptext { text-decoration: line-through; }
  .postit-card .ptag { font-size: 9.5px; font-weight: 800; opacity: 0.55; text-transform: uppercase; margin-bottom: 4px; }
  .postit-card .ptext { font-weight: 700; line-height: 1.4; word-break: break-word; cursor: text; outline: none;
                         min-height: 1.4em; white-space: pre-wrap; }
  .postit-card .psub { font-size: 10.5px; opacity: 0.7; margin-top: 5px; }
  .postit-card .prow { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
  .postit-card .pcolors { display: flex; gap: 4px; }
  .postit-card .pdot { width: 13px; height: 13px; border-radius: 50%; cursor: pointer; border: 1.5px solid rgba(0,0,0,0.12); }
  .postit-card .pdot.active { border-color: #3A3652; border-width: 2px; }
  .postit-card .pactions { display: flex; align-items: center; gap: 4px; }
  .postit-card .pactions input[type=checkbox] { width: 15px; height: 15px; cursor: pointer; }
  .postit-card .pdel { border: none; background: rgba(255,255,255,0.55); border-radius: 5px; cursor: pointer;
                        font-size: 10.5px; padding: 2px 5px; color: #5C577A; }
"""

POSTIT_CARD_JS = """
const POSTIT_COLORS = %s;

function renderPostitCard(c) {
  const colorDots = POSTIT_COLORS.map(col =>
    `<span class="pdot ${col === c.color ? 'active' : ''}" style="background:${col};" onclick="setCardColor('${c.kind}', ${c.table ? "'"+c.table+"'" : 'null'}, ${c.id}, '${col}', this)"></span>`
  ).join('');
  return `
    <div class="postit-card ${c.status === 'done' ? 'done' : ''}" style="background:${c.color};" data-kind="${c.kind}" data-table="${c.table || ''}" data-id="${c.id}">
      <div class="ptag">${c.tag}</div>
      <div class="ptext" contenteditable="true"
           onblur="saveCardContent('${c.kind}', ${c.table ? "'"+c.table+"'" : 'null'}, ${c.id}, this)"
           onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${escapeHtmlPostit(c.content)}</div>
      ${c.event_subtype ? `<div class="psub">🗓 ${escapeHtmlPostit(c.event_subtype)}</div>` : ''}
      <div class="prow">
        <div class="pcolors">${colorDots}</div>
        <div class="pactions">
          <input type="checkbox" ${c.status === 'done' ? 'checked' : ''} title="완료"
                 onchange="toggleCardStatus('${c.kind}', ${c.table ? "'"+c.table+"'" : 'null'}, ${c.id}, this)">
          <button type="button" class="pdel" onclick="deleteCard('${c.kind}', ${c.table ? "'"+c.table+"'" : 'null'}, ${c.id}, this)">${c.kind === 'memo' ? '삭제' : '해제'}</button>
        </div>
      </div>
    </div>
  `;
}

function escapeHtmlPostit(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

async function toggleCardStatus(kind, table, id, checkbox) {
  const card = checkbox.closest('.postit-card');
  try {
    const resp = await fetch('/api/postit/toggle_status', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({kind, table, id})
    });
    const data = await resp.json();
    if (data.ok) {
      card.classList.toggle('done', checkbox.checked);
    }
  } catch (e) { alert('처리 중 오류: ' + e); }
}

async function setCardColor(kind, table, id, color, dotEl) {
  const card = dotEl.closest('.postit-card');
  try {
    const resp = await fetch('/api/postit/set_color', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({kind, table, id, color})
    });
    const data = await resp.json();
    if (data.ok) {
      card.style.background = color;
      card.querySelectorAll('.pdot').forEach(d => d.classList.remove('active'));
      dotEl.classList.add('active');
    }
  } catch (e) { alert('처리 중 오류: ' + e); }
}

async function saveCardContent(kind, table, id, el) {
  const content = el.textContent.trim();
  if (!content) { el.textContent = '(내용 없음)'; return; }
  try {
    await fetch('/api/postit/update_content', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({kind, table, id, content})
    });
  } catch (e) { alert('저장 중 오류: ' + e); }
}

async function deleteCard(kind, table, id, btn) {
  const msg = kind === 'memo' ? '이 메모를 삭제할까요?' : '포스트잇에서 고정 해제할까요? (내 목록에는 남아있어요)';
  if (!confirm(msg)) return;
  const card = btn.closest('.postit-card');
  try {
    const resp = await fetch('/api/postit/delete', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({kind, table, id})
    });
    const data = await resp.json();
    if (data.ok) { card.remove(); checkEmptyState(); }
  } catch (e) { alert('삭제 중 오류: ' + e); }
}

async function addMemo() {
  try {
    const resp = await fetch('/api/memo/create', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: '새 메모', color: POSTIT_COLORS[0]})
    });
    const data = await resp.json();
    if (data.ok) {
      const card = {kind: 'memo', table: null, id: data.id, content: '새 메모', color: POSTIT_COLORS[0], status: 'pending', event_subtype: null, tag: '메모'};
      const grid = document.getElementById('postitGrid');
      grid.insertAdjacentHTML('afterbegin', renderPostitCard(card));
      checkEmptyState();
      const newText = grid.querySelector('.postit-card .ptext');
      if (newText) { newText.focus(); document.execCommand('selectAll', false, null); }
    }
  } catch (e) { alert('메모 추가 중 오류: ' + e); }
}

function checkEmptyState() {
  const grid = document.getElementById('postitGrid');
  const empty = document.getElementById('postitEmpty');
  if (!grid) return;
  const hasCards = grid.querySelectorAll('.postit-card').length > 0;
  if (empty) empty.style.display = hasCards ? 'none' : '';
  grid.style.display = hasCards ? '' : 'none';
}
"""


POSTIT_HTML = """
<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>잇다 - 포스트잇</title>
<style>{{ shared_css|safe }}
  .postit-toolbar { margin-bottom: 18px; display: flex; gap: 10px; }
  .float-btn { padding: 10px 18px; border: none; border-radius: 10px; background: linear-gradient(90deg,#A78BFA,#93C5FD);
               color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
  .add-memo-btn { padding: 10px 18px; border: 1px dashed #C9BFF0; border-radius: 10px; background: #fff;
                   color: #7C5FE0; font-size: 13px; font-weight: 700; cursor: pointer; }
  .postit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
  .postit-empty { background: #fff; border-radius: 16px; padding: 48px; text-align: center; border: 1px solid #F0EDF9; }
  .postit-empty .emoji { font-size: 36px; margin-bottom: 10px; }
  .postit-empty p { color: #9691AB; font-size: 13px; line-height: 1.6; }
  .postit-empty a { color: #8B5FE0; font-weight: 600; }
""" + POSTIT_CARD_CSS + """
</style></head><body><div class="app-shell">{{ sidebar|safe }}
<main class="content"><div class="content-inner">
  <h1>포스트잇</h1>
  <div class="sub">"내 목록"에서 📌로 고정한 항목 + 직접 작성한 메모가 여기 모여요</div>

  <div class="postit-toolbar">
    <button type="button" class="float-btn" onclick="openWidget()">🖥️ 바탕화면에 띄우기</button>
    <button type="button" class="add-memo-btn" onclick="addMemo()">➕ 메모 추가</button>
  </div>

  <div class="postit-empty" id="postitEmpty" style="{{ 'display:none;' if cards|length > 0 else '' }}">
    <div class="emoji">📌</div>
    <p><b>아직 카드가 없어요</b><br>
    "메모 추가"로 바로 써보거나, <a href="/list">내 목록</a>에서 항목을 고정해보세요.</p>
  </div>
  <div class="postit-grid" id="postitGrid" style="{{ 'display:none;' if cards|length == 0 else '' }}">
    {% for c in cards %}
    <div class="postit-card {{ 'done' if c.status == 'done' else '' }}" style="background:{{ c.color }};"
         data-kind="{{ c.kind }}" data-table="{{ c.table or '' }}" data-id="{{ c.id }}">
      <div class="ptag">{{ c.tag }}</div>
      <div class="ptext" contenteditable="true"
           onblur="saveCardContent('{{ c.kind }}', {{ ('\\''+c.table+'\\'') if c.table else 'null' }}, {{ c.id }}, this)"
           onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">{{ c.content }}</div>
      {% if c.event_subtype %}<div class="psub">🗓 {{ c.event_subtype }}</div>{% endif %}
      <div class="prow">
        <div class="pcolors">
          {% for col in color_presets %}
          <span class="pdot {{ 'active' if col == c.color else '' }}" style="background:{{ col }};"
                onclick="setCardColor('{{ c.kind }}', {{ ('\\''+c.table+'\\'') if c.table else 'null' }}, {{ c.id }}, '{{ col }}', this)"></span>
          {% endfor %}
        </div>
        <div class="pactions">
          <input type="checkbox" {{ 'checked' if c.status == 'done' else '' }} title="완료"
                 onchange="toggleCardStatus('{{ c.kind }}', {{ ('\\''+c.table+'\\'') if c.table else 'null' }}, {{ c.id }}, this)">
          <button type="button" class="pdel" onclick="deleteCard('{{ c.kind }}', {{ ('\\''+c.table+'\\'') if c.table else 'null' }}, {{ c.id }}, this)">{{ '삭제' if c.kind == 'memo' else '해제' }}</button>
        </div>
      </div>
    </div>
    {% endfor %}
  </div>
</div></main></div>
<script>
""" + POSTIT_CARD_JS % "{{ color_presets|tojson }}" + """
async function openWidget() {
  if (!window.pywebview) {
    alert('바탕화면 위젯은 잇다 앱(데스크톱 프로그램)에서만 사용할 수 있어요.');
    return;
  }
  try {
    await window.pywebview.api.open_postit_widget();
  } catch (e) {
    alert('위젯을 여는 중 오류가 발생했습니다: ' + e);
  }
}
</script>
</body></html>
"""


@app.route("/postit")
def postit_placeholder():
    from flask import render_template_string
    cards = _fetch_postit_cards()
    return render_template_string(
        POSTIT_HTML, cards=cards, color_presets=POSTIT_COLOR_PRESETS,
        shared_css=SHARED_CSS, sidebar=sidebar_html("postit"),
    )


POSTIT_WIDGET_HTML = """
<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>잇다 포스트잇</title>
<style>
@font-face { font-family: 'Pretendard'; font-weight: 700; font-display: swap; src: url('/fonts/Pretendard-Bold.woff2') format('woff2'); }
@font-face { font-family: 'Pretendard'; font-weight: 500; font-display: swap; src: url('/fonts/Pretendard-Medium.woff2') format('woff2'); }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; font-family: "Pretendard","Malgun Gothic",sans-serif; background: #F8F7FC;
       display: flex; flex-direction: column; border-radius: 10px; overflow: hidden;
       border: 1px solid #E7E3F6; user-select: none; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px;
          background: #EFECFB; flex-shrink: 0; cursor: move; }
.header .title { font-size: 11.5px; font-weight: 800; color: #5B3FBF; pointer-events: none; }
.header .btns { display: flex; gap: 2px; }
.header button { border: none; background: none; color: #9691AB; cursor: pointer; font-size: 12.5px;
                  padding: 2px 6px; border-radius: 5px; }
.header button:hover { background: rgba(0,0,0,0.06); }
.header .close:hover { color: #E0645E; }
.list { flex: 1; overflow-y: auto; padding: 8px; user-select: text; }
.list .postit-card { margin-bottom: 8px; }
.empty { text-align: center; color: #B7B3CC; font-size: 12px; padding: 20px 8px; }
""" + POSTIT_CARD_CSS + """
</style></head>
<body>
  <div class="header" id="dragHeader">
    <span class="title">📌 잇다 포스트잇</span>
    <div class="btns">
      <button type="button" onclick="addMemo()" title="메모 추가">➕</button>
      <button type="button" onclick="location.reload()" title="새로고침">⟳</button>
      <button type="button" class="close" onclick="closeWidget()" title="닫기">✕</button>
    </div>
  </div>
  <div class="list" id="postitGrid">
    {% for c in cards %}
    <div class="postit-card {{ 'done' if c.status == 'done' else '' }}" style="background:{{ c.color }};"
         data-kind="{{ c.kind }}" data-table="{{ c.table or '' }}" data-id="{{ c.id }}">
      <div class="ptag">{{ c.tag }}</div>
      <div class="ptext" contenteditable="true"
           onblur="saveCardContent('{{ c.kind }}', {{ ('\\''+c.table+'\\'') if c.table else 'null' }}, {{ c.id }}, this)"
           onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">{{ c.content }}</div>
      {% if c.event_subtype %}<div class="psub">🗓 {{ c.event_subtype }}</div>{% endif %}
      <div class="prow">
        <div class="pcolors">
          {% for col in color_presets %}
          <span class="pdot {{ 'active' if col == c.color else '' }}" style="background:{{ col }};"
                onclick="setCardColor('{{ c.kind }}', {{ ('\\''+c.table+'\\'') if c.table else 'null' }}, {{ c.id }}, '{{ col }}', this)"></span>
          {% endfor %}
        </div>
        <div class="pactions">
          <input type="checkbox" {{ 'checked' if c.status == 'done' else '' }} title="완료"
                 onchange="toggleCardStatus('{{ c.kind }}', {{ ('\\''+c.table+'\\'') if c.table else 'null' }}, {{ c.id }}, this)">
          <button type="button" class="pdel" onclick="deleteCard('{{ c.kind }}', {{ ('\\''+c.table+'\\'') if c.table else 'null' }}, {{ c.id }}, this)">{{ '삭제' if c.kind == 'memo' else '해제' }}</button>
        </div>
      </div>
    </div>
    {% endfor %}
    {% if cards|length == 0 %}
    <div class="empty" id="postitEmpty">📌 카드가 없어요<br>➕로 메모를 추가해보세요</div>
    {% endif %}
  </div>
<script>
""" + POSTIT_CARD_JS % "{{ color_presets|tojson }}" + """
function closeWidget() {
  if (window.pywebview) { window.pywebview.api.close_postit_widget(); }
}

// pywebview 기본 드래그(easy_drag)가 마우스 포인터랑 창 위치가 어긋나는 문제가 있어서,
// 헤더를 직접 마우스로 추적해서 델타만큼 정확히 옮기는 방식으로 대체함.
(function setupDrag() {
  const header = document.getElementById('dragHeader');
  let dragging = false, startMouseX = 0, startMouseY = 0, startWinX = 0, startWinY = 0, pending = false;

  header.addEventListener('mousedown', async (e) => {
    if (e.target.closest('button')) return;  // 헤더 안의 버튼 클릭은 드래그 아님
    if (!window.pywebview) return;
    dragging = true;
    startMouseX = e.screenX;
    startMouseY = e.screenY;
    const pos = await window.pywebview.api.get_widget_position();
    startWinX = pos[0];
    startWinY = pos[1];
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      const dx = e.screenX - startMouseX;
      const dy = e.screenY - startMouseY;
      window.pywebview.api.move_widget(startWinX + dx, startWinY + dy);
      pending = false;
    });
  });

  document.addEventListener('mouseup', () => { dragging = false; });
})();
</script>
</body></html>
"""


@app.route("/postit/widget")
def postit_widget():
    from flask import render_template_string
    cards = _fetch_postit_cards()
    return render_template_string(
        POSTIT_WIDGET_HTML, cards=cards, color_presets=POSTIT_COLOR_PRESETS,
    )


@app.route("/api/postit/toggle_status", methods=["POST"])
def api_postit_toggle_status():
    data = request.get_json(force=True, silent=True) or {}
    kind, item_id, table = data.get("kind"), data.get("id"), data.get("table")
    if not isinstance(item_id, int):
        return jsonify({"ok": False, "error": "잘못된 항목"}), 400

    conn = get_conn()
    cur = conn.cursor()
    if kind == "memo":
        row = cur.execute("SELECT status FROM memo WHERE id=?", (item_id,)).fetchone()
        if row:
            new_status = "pending" if row["status"] == "done" else "done"
            cur.execute("UPDATE memo SET status=? WHERE id=?", (new_status, item_id))
    elif kind == "pinned" and table in ("todo", "calendar", "notice"):
        row = cur.execute(f"SELECT status FROM {table} WHERE id=?", (item_id,)).fetchone()
        if row:
            new_status = "pending" if row["status"] == "done" else "done"
            cur.execute(f"UPDATE {table} SET status=? WHERE id=?", (new_status, item_id))
    else:
        conn.close()
        return jsonify({"ok": False, "error": "잘못된 요청"}), 400
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/postit/set_color", methods=["POST"])
def api_postit_set_color():
    data = request.get_json(force=True, silent=True) or {}
    kind, item_id, table, color = data.get("kind"), data.get("id"), data.get("table"), data.get("color")
    if not isinstance(item_id, int) or not isinstance(color, str) or not color.startswith("#") or len(color) not in (4, 7):
        return jsonify({"ok": False, "error": "잘못된 색상"}), 400

    conn = get_conn()
    cur = conn.cursor()
    if kind == "memo":
        cur.execute("UPDATE memo SET color=? WHERE id=?", (color, item_id))
    elif kind == "pinned" and table in ("todo", "calendar", "notice"):
        cur.execute(f"UPDATE {table} SET color=? WHERE id=?", (color, item_id))
    else:
        conn.close()
        return jsonify({"ok": False, "error": "잘못된 요청"}), 400
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/postit/update_content", methods=["POST"])
def api_postit_update_content():
    data = request.get_json(force=True, silent=True) or {}
    kind, item_id, table = data.get("kind"), data.get("id"), data.get("table")
    content = (data.get("content") or "").strip()
    if not isinstance(item_id, int):
        return jsonify({"ok": False, "error": "잘못된 항목"}), 400
    if not content:
        return jsonify({"ok": False, "error": "내용을 입력해주세요"}), 400

    conn = get_conn()
    cur = conn.cursor()
    if kind == "memo":
        cur.execute("UPDATE memo SET content=? WHERE id=?", (content, item_id))
    elif kind == "pinned" and table in ("todo", "calendar", "notice"):
        cur.execute(f"UPDATE {table} SET content=? WHERE id=?", (content, item_id))
    else:
        conn.close()
        return jsonify({"ok": False, "error": "잘못된 요청"}), 400
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/postit/delete", methods=["POST"])
def api_postit_delete():
    """메모는 완전히 삭제하고, 고정된 항목(할일/일정/공지)은 삭제가 아니라 고정만
    해제한다 - 실제 항목은 '내 목록'에 계속 남아있어야 하므로."""
    data = request.get_json(force=True, silent=True) or {}
    kind, item_id, table = data.get("kind"), data.get("id"), data.get("table")
    if not isinstance(item_id, int):
        return jsonify({"ok": False, "error": "잘못된 항목"}), 400

    conn = get_conn()
    cur = conn.cursor()
    if kind == "memo":
        cur.execute("DELETE FROM memo WHERE id=?", (item_id,))
    elif kind == "pinned" and table in ("todo", "calendar", "notice"):
        cur.execute(f"UPDATE {table} SET pinned=0 WHERE id=?", (item_id,))
    else:
        conn.close()
        return jsonify({"ok": False, "error": "잘못된 요청"}), 400
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/memo/create", methods=["POST"])
def api_memo_create():
    data = request.get_json(force=True, silent=True) or {}
    content = (data.get("content") or "새 메모").strip() or "새 메모"
    color = data.get("color") or POSTIT_COLOR_PRESETS[0]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO memo (content, color, status, created_utc) VALUES (?, ?, 'pending', ?)",
        (content, color, now),
    )
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": new_id})


@app.route("/list/toggle/<table>/<int:item_id>", methods=["POST"])
def list_toggle(table, item_id):
    return_url = request.form.get("return_url") or "/list"
    if table not in ("todo", "calendar", "notice"):
        return redirect(return_url)

    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute(f"SELECT status FROM {table} WHERE id=?", (item_id,)).fetchone()
    if row is not None:
        new_status = "pending" if row["status"] == "done" else "done"
        cur.execute(f"UPDATE {table} SET status=? WHERE id=?", (new_status, item_id))
        conn.commit()
    conn.close()

    return redirect(return_url)


@app.route("/list/pin/<table>/<int:item_id>", methods=["POST"])
def list_pin(table, item_id):
    """포스트잇에 띄울 항목을 고정/해제한다. reference는 완료 개념이 없는 것처럼
    포스트잇 고정 대상에서도 제외(할일/일정/공지만 고정 가능)."""
    return_url = request.form.get("return_url") or "/list"
    if table not in ("todo", "calendar", "notice"):
        return redirect(return_url)

    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute(f"SELECT pinned FROM {table} WHERE id=?", (item_id,)).fetchone()
    if row is not None:
        new_pinned = 0 if row["pinned"] else 1
        cur.execute(f"UPDATE {table} SET pinned=? WHERE id=?", (new_pinned, item_id))
        conn.commit()
    conn.close()

    return redirect(return_url)


@app.route("/list/delete/<table>/<int:item_id>", methods=["POST"])
def list_delete(table, item_id):
    return_url = request.form.get("return_url") or "/list"
    # table은 반드시 이 화이트리스트 안에서만 허용 (URL로 임의 테이블명 주입 방지)
    if table not in LIST_TABLES:
        return redirect(return_url)

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))
    conn.commit()
    conn.close()

    return redirect(return_url)


@app.route("/api/list/update", methods=["POST"])
def api_list_update():
    data = request.get_json(force=True, silent=True) or {}
    table = data.get("table")
    item_id = data.get("id")
    content = (data.get("content") or "").strip()
    event_subtype = data.get("event_subtype")

    if table not in LIST_TABLES:
        return jsonify({"ok": False, "error": "잘못된 카테고리입니다"}), 400
    if not isinstance(item_id, int):
        return jsonify({"ok": False, "error": "잘못된 항목입니다"}), 400
    if not content:
        return jsonify({"ok": False, "error": "내용을 입력해주세요"}), 400

    conn = get_conn()
    cur = conn.cursor()
    if table == "calendar":
        cur.execute(
            "UPDATE calendar SET content=?, event_subtype=? WHERE id=?",
            (content, (event_subtype or "").strip() or None, item_id),
        )
    else:
        cur.execute(f"UPDATE {table} SET content=? WHERE id=?", (content, item_id))
    conn.commit()
    conn.close()

    return jsonify({"ok": True})


@app.route("/api/list/bulk_delete", methods=["POST"])
def api_list_bulk_delete():
    data = request.get_json(force=True, silent=True) or {}
    items = data.get("items")
    if not isinstance(items, list) or not items:
        return jsonify({"ok": False, "error": "삭제할 항목이 없습니다"}), 400

    conn = get_conn()
    cur = conn.cursor()
    deleted = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        table = it.get("table")
        item_id = it.get("id")
        # table은 반드시 화이트리스트 안에서만 허용 (요청 데이터로 임의 테이블명 주입 방지)
        if table not in LIST_TABLES or not isinstance(item_id, int):
            continue
        cur.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))
        deleted += cur.rowcount
    conn.commit()
    conn.close()

    return jsonify({"ok": True, "deleted": deleted})


ANALYZE_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>잇다 - 새 메시지 분석</title>
<style>
{{ shared_css|safe }}
  .analyze-grid { display: flex; gap: 20px; align-items: flex-start; }
  .analyze-grid .panel { flex: 1 1 0; min-width: 0; }
  @media (max-width: 820px) { .analyze-grid { flex-direction: column; } }
  .panel { background: #fff; border-radius: 16px; box-shadow: 0 1px 2px rgba(103,90,163,0.04),
           0 10px 26px -16px rgba(103,90,163,0.16); border: 1px solid #F0EDF9; overflow: hidden; }
  .panel-head { padding: 16px 20px; border-bottom: 1px solid #F5F3FA; }
  .panel-head h3 { margin: 0 0 3px 0; font-size: 14px; font-weight: 700; color: #2E2C42; }
  .panel-head p { margin: 0; font-size: 11.5px; color: #ADA8C4; }
  .panel-body { padding: 18px 20px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 260px; padding: 12px; border-radius: 10px;
             border: 1px solid #E7E3F6; font-size: 13.5px; font-family: inherit; resize: vertical; line-height: 1.55; }
  .char-count { text-align: right; font-size: 11px; color: #C2BEDA; margin-top: 6px; }
  button.analyze { margin-top: 14px; width: 100%; padding: 13px; border: none; border-radius: 10px;
                   background: linear-gradient(90deg,#A78BFA,#93C5FD); color: #fff; font-size: 14px;
                   font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
  button.analyze:disabled { opacity: 0.55; cursor: default; }
  .error-banner { background: #FCE9E9; color: #9E3B3B; padding: 9px 14px; border-radius: 10px; margin-bottom: 14px; font-size: 12.5px; }
  .filter-checks { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 6px; }
  .filter-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9691AB;
                   cursor: pointer; user-select: none; font-weight: 500; }
  .filter-check input[type=checkbox] { width: 15px; height: 15px; cursor: pointer; accent-color: #8B5FE0; }
  .result-empty { text-align: center; color: #C2BEDA; font-size: 12.5px; padding: 60px 20px; }
  .result-empty .big { font-size: 30px; margin-bottom: 10px; }
  .result-item { display: flex; gap: 10px; align-items: flex-start; padding: 12px 10px; border-radius: 10px; }
  .result-item:hover { background: #FAF9FD; }
  .result-item input[type=checkbox] { width: 18px; height: 18px; margin-top: 3px; flex-shrink: 0; cursor: pointer; accent-color: #8B5FE0; }
  .result-item .rbody { flex: 1; min-width: 0; }
  .result-item .rtext-input { font-size: 13.5px; font-weight: 600; margin-bottom: 5px; color: #34324A;
                               width: 100%; box-sizing: border-box; border: 1px solid transparent; background: none;
                               border-radius: 6px; padding: 3px 6px; margin-left: -6px; font-family: inherit; }
  .result-item .rtext-input:hover { border-color: #ECE8F7; background: #FAF9FD; }
  .result-item .rtext-input:focus { outline: none; border-color: #C9BFF0; background: #fff; }
  .result-item .rmeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .result-item .ractions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-top: 1px; }
  select.cat-select { font-size: 10.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; border: none;
                       cursor: pointer; appearance: none; -webkit-appearance: none; text-align: center; }
  .rmeta .info { font-size: 11px; color: #C2BEDA; }
  .rdel { flex-shrink: 0; border: none; background: none; color: #D9D5EA; cursor: pointer; font-size: 15px; padding: 2px 4px; }
  .rdel:hover { color: #E0645E; }
  .result-actions { display: flex; gap: 10px; padding: 14px 20px; border-top: 1px solid #F5F3FA; }
  .btn-cancel { flex: 0 0 auto; padding: 11px 18px; border-radius: 10px; border: 1px solid #E7E3F6; background: #fff;
                color: #9691AB; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-save { flex: 1; padding: 11px 18px; border: none; border-radius: 10px;
              background: linear-gradient(90deg,#A78BFA,#93C5FD); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
  .btn-save:disabled { opacity: 0.5; cursor: default; }
  .hint-line { font-size: 11px; color: #C2BEDA; padding: 0 20px 14px; }
  .toast { position: fixed; top: 20px; right: 24px; background: #34324A; color: #fff; padding: 10px 18px;
           border-radius: 10px; font-size: 12.5px; box-shadow: 0 8px 24px rgba(52,50,74,0.25); opacity: 0; transform: translateY(-8px);
           transition: all .2s; pointer-events: none; }
  .toast.show { opacity: 1; transform: translateY(0); }
</style>
</head>
<body>
<div class="app-shell">
{{ sidebar|safe }}
<main class="content"><div class="content-inner" style="max-width:1000px;">
  <h1>새 메시지 분석</h1>
  <div class="sub">메신저 대화를 붙여넣으면 AI가 항목별로 쪼개서 자동 분류해요</div>

  <div class="analyze-grid">
    <div class="panel">
      <div class="panel-head"><h3>메시지 붙여넣기</h3><p>메신저 대화를 복사해서 붙여넣어 주세요</p></div>
      <div class="panel-body">
        <div id="errorBanner" class="error-banner" style="display:none;"></div>
        <textarea id="pasteText" placeholder="여기에 메신저 대화 내용을 붙여넣으세요 (여러 메시지 한 번에 가능)..." oninput="updateCharCount()"></textarea>
        <div class="char-count"><span id="charCount">0</span>자</div>
        <button type="button" class="analyze" id="analyzeBtn" onclick="runAnalyze()">
          <span id="analyzeBtnText">✨ 분석하기</span>
        </button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;">
        <div><h3 id="resultTitle">분석 결과</h3><p id="resultSub">아직 분석하지 않았어요</p></div>
      </div>
      <div class="panel-body" style="padding-bottom:8px;">
        <div class="filter-checks" id="filterChips" style="display:none;">
          <label class="filter-check"><input type="checkbox" checked data-cat="all" onchange="toggleFilter('all')"> 전체</label>
          <label class="filter-check"><input type="checkbox" checked data-cat="todo" onchange="toggleFilter('todo')"> 할 일</label>
          <label class="filter-check"><input type="checkbox" checked data-cat="calendar" onchange="toggleFilter('calendar')"> 캘린더</label>
          <label class="filter-check"><input type="checkbox" checked data-cat="notice" onchange="toggleFilter('notice')"> 공지</label>
          <label class="filter-check"><input type="checkbox" checked data-cat="reference" onchange="toggleFilter('reference')"> 참고</label>
        </div>
        <div id="resultList">
          <div class="result-empty"><div class="big">📋</div>왼쪽에 메시지를 붙여넣고<br>"분석하기"를 눌러보세요</div>
        </div>
      </div>
      <div class="result-actions" id="resultActions" style="display:none;">
        <button type="button" class="btn-cancel" onclick="cancelResults()">취소</button>
        <button type="button" class="btn-save" id="saveBtn" onclick="saveResults()">저장하기 (0개)</button>
      </div>
    </div>
  </div>
</div></main>
</div>
<div class="toast" id="toast"></div>

<script>
const CAT_LABELS = {todo: '할 일', calendar: '캘린더', notice: '공지', reference: '참고'};
const CAT_COLORS = {todo: '#C9F0DC', calendar: '#D6E7FC', notice: '#E9DCFA', reference: '#EAE8F2'};
const CAT_TEXT_COLORS = {todo: '#1F6E48', calendar: '#2358A8', notice: '#6B3FA0', reference: '#5C577A'};
let currentItems = [];
let activeFilters = new Set(['all']);

function updateCharCount() {
  document.getElementById('charCount').textContent = document.getElementById('pasteText').value.length;
}

function showError(msg) {
  const el = document.getElementById('errorBanner');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function runAnalyze() {
  const text = document.getElementById('pasteText').value.trim();
  showError('');
  if (!text) { showError('붙여넣을 내용이 없습니다'); return; }

  const btn = document.getElementById('analyzeBtn');
  const btnText = document.getElementById('analyzeBtnText');
  btn.disabled = true;
  btnText.textContent = '⏳ 분석 중... (처음엔 조금 걸려요)';
  document.getElementById('resultSub').textContent = '분석하는 중...';

  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text})
    });
    const data = await resp.json();
    if (!resp.ok) { showError(data.error || '분석에 실패했습니다'); resetResultPanel(); return; }
    currentItems = data.items.map((it, i) => ({...it, _id: i, _include: true}));
    renderResults(data.elapsed_sec);
  } catch (e) {
    showError('서버와 통신 중 오류가 발생했습니다: ' + e);
    resetResultPanel();
  } finally {
    btn.disabled = false;
    btnText.textContent = '✨ 분석하기';
  }
}

function resetResultPanel() {
  document.getElementById('resultSub').textContent = '아직 분석하지 않았어요';
  document.getElementById('resultTitle').textContent = '분석 결과';
  document.getElementById('filterChips').style.display = 'none';
  document.getElementById('resultActions').style.display = 'none';
  document.getElementById('resultList').innerHTML =
    '<div class="result-empty"><div class="big">📋</div>왼쪽에 메시지를 붙여넣고<br>"분석하기"를 눌러보세요</div>';
}

function renderResults(elapsed) {
  document.getElementById('resultTitle').textContent = `분석 결과 (${currentItems.length}개 항목)`;
  document.getElementById('resultSub').textContent = elapsed ? `분석 소요시간 ${elapsed}초` : '';
  document.getElementById('filterChips').style.display = currentItems.length ? 'flex' : 'none';
  document.getElementById('resultActions').style.display = currentItems.length ? 'flex' : 'none';

  if (currentItems.length === 0) {
    document.getElementById('resultList').innerHTML =
      '<div class="result-empty"><div class="big">🤷</div>추출된 항목이 없어요<br>(전부 잡담으로 판단됐어요)</div>';
    return;
  }
  renderList();
}

function renderList() {
  const list = document.getElementById('resultList');
  list.innerHTML = '';
  currentItems.forEach(it => {
    if (!activeFilters.has('all') && !activeFilters.has(it.category)) return;
    const row = document.createElement('div');
    row.className = 'result-item';
    const metaBits = [];
    if (it.patient_name) metaBits.push(`환자: ${it.patient_name}`);
    if (it.deadline_or_date) metaBits.push(it.deadline_or_date);
    row.innerHTML = `
      <input type="checkbox" ${it._include ? 'checked' : ''} onchange="toggleInclude(${it._id}, this.checked)">
      <div class="rbody">
        <input type="text" class="rtext-input" value="${escapeHtml(it.summary || '')}" oninput="updateSummary(${it._id}, this.value)">
        ${metaBits.length ? `<div class="rmeta"><span class="info">🗓 ${escapeHtml(metaBits.join(' · '))}</span></div>` : ''}
      </div>
      <div class="ractions">
        <select class="cat-select" style="background:${CAT_COLORS[it.category]};color:${CAT_TEXT_COLORS[it.category]}" onchange="changeCategory(${it._id}, this.value)">
          ${Object.keys(CAT_LABELS).map(c => `<option value="${c}" ${c === it.category ? 'selected' : ''}>${CAT_LABELS[c]}</option>`).join('')}
        </select>
        <button type="button" class="rdel" title="삭제" onclick="deleteItem(${it._id})">🗑</button>
      </div>
    `;
    list.appendChild(row);
  });
  updateSaveCount();
}

function updateSummary(id, value) {
  const it = currentItems.find(x => x._id === id);
  if (it) it.summary = value;
}

function toggleFilter(cat) {
  if (cat === 'all') {
    activeFilters = new Set(['all']);
  } else {
    activeFilters.delete('all');
    if (activeFilters.has(cat)) activeFilters.delete(cat); else activeFilters.add(cat);
    if (activeFilters.size === 0) activeFilters.add('all');
  }
  document.querySelectorAll('.filter-check input[type=checkbox]').forEach(cb => {
    cb.checked = activeFilters.has(cb.dataset.cat);
  });
  renderList();
}

function toggleInclude(id, checked) {
  const it = currentItems.find(x => x._id === id);
  if (it) it._include = checked;
  updateSaveCount();
}

function changeCategory(id, cat) {
  const it = currentItems.find(x => x._id === id);
  if (it) it.category = cat;
  renderList();
}

function deleteItem(id) {
  currentItems = currentItems.filter(x => x._id !== id);
  document.getElementById('resultTitle').textContent = `분석 결과 (${currentItems.length}개 항목)`;
  renderList();
}

function updateSaveCount() {
  const n = currentItems.filter(x => x._include).length;
  const btn = document.getElementById('saveBtn');
  btn.textContent = `저장하기 (${n}개)`;
  btn.disabled = n === 0;
}

function cancelResults() {
  currentItems = [];
  activeFilters = new Set(['all']);
  document.getElementById('pasteText').value = '';
  updateCharCount();
  resetResultPanel();
}

async function saveResults() {
  const toSave = currentItems.filter(x => x._include);
  if (toSave.length === 0) return;
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = '저장 중...';
  try {
    const resp = await fetch('/api/analyze/save', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({items: toSave})
    });
    const data = await resp.json();
    showToast(`✓ ${data.saved}건 저장했습니다`);
    cancelResults();
  } catch (e) {
    showToast('저장 중 오류가 발생했습니다');
  } finally {
    updateSaveCount();
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
</script>
</body>
</html>
"""


@app.route("/analyze")
def analyze():
    from flask import render_template_string
    return render_template_string(ANALYZE_HTML, shared_css=SHARED_CSS, sidebar=sidebar_html("analyze"))


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "붙여넣을 내용이 없습니다"}), 400

    try:
        llm, grammar = _get_llm()
    except Exception as e:
        return jsonify({"error": f"AI 모델을 불러오지 못했습니다: {e}"}), 500

    from itda_llm_stage3 import analyze_text
    result = analyze_text(llm, text, grammar=grammar)
    return jsonify({"items": result["items"], "elapsed_sec": result["elapsed_sec"]})


@app.route("/api/analyze/save", methods=["POST"])
def api_analyze_save():
    data = request.get_json(force=True, silent=True) or {}
    items = data.get("items", [])
    if not isinstance(items, list):
        return jsonify({"error": "잘못된 요청입니다"}), 400

    conn = get_conn()
    cur = conn.cursor()
    saved = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        category = it.get("category")
        if category not in MANUAL_CATEGORIES:
            continue
        patient_name = (it.get("patient_name") or "").strip() or None
        deadline = (it.get("deadline_or_date") or "").strip() or None
        summary = (it.get("summary") or "").strip()

        content = summary or "(내용 없음)"
        if patient_name and patient_name not in content:
            content = f"[{patient_name}] {content}"

        _insert_manual(cur, category, content, None, deadline)
        saved += 1

    conn.commit()
    conn.close()
    return jsonify({"saved": saved})


SETTINGS_HTML = """
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>잇다 - 설정</title>
<style>
{{ shared_css|safe }}
  .card { margin-bottom: 14px; padding: 18px 20px; }
  .card h2 { font-size: 13.5px; margin: 0 0 10px 0; }
  label { font-size: 11.5px; color: #9691AB; display: block; margin-top: 8px; font-weight: 600; }
  input[type=text] { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 6px; border: 1px solid #E7E3F6;
                      font-size: 12.5px; margin-top: 3px; }
  .source-row { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
  .source-row input[type=text] { margin-top: 0; }
  .source-row input.name { flex: 0 0 100px; }
  .source-row select { flex: 0 0 92px; padding: 7px; border-radius: 6px; border: 1px solid #E7E3F6; font-size: 12px; }
  .source-row input.path { flex: 1; }
  .source-row button { flex: 0 0 auto; padding: 7px 9px; border: none; border-radius: 6px; background: #FBE7E7;
                        color: #9E3B3B; cursor: pointer; font-size: 11.5px; }
  .source-row button.browse-btn-sm { background: #EAE6FA; color: #5B3FBF; }
  .path-row { display: flex; gap: 6px; margin-top: 3px; }
  .path-row input[type=text] { margin-top: 0; }
  .browse-btn { flex: 0 0 auto; padding: 7px 11px; border: 1px solid #E7E3F6; border-radius: 6px; background: #FAF9FD;
                color: #6E6A87; cursor: pointer; font-size: 11.5px; white-space: nowrap; }
  .add-btn { margin-top: 8px; padding: 7px 12px; border: 1px dashed #C9BFF0; border-radius: 6px; background: #fff;
             color: #7C5FE0; cursor: pointer; font-size: 12px; }
  .save-btn { margin-top: 14px; width: 100%; padding: 12px; border: none; border-radius: 10px;
              background: linear-gradient(90deg,#A78BFA,#93C5FD); color: #fff; font-size: 13.5px; font-weight: 700; cursor: pointer; }
  .collect-btn { margin-top: 8px; width: 100%; padding: 10px; border: none; border-radius: 10px;
                 background: #7FD8AE; color: #14532D; font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .test-btn-inline { margin-top: 8px; width: 100%; padding: 8px; border: 1px solid #E7E3F6; border-radius: 8px;
                      background: #FAF9FD; color: #6E6A87; font-size: 12px; font-weight: 600; cursor: pointer; }
  .llm-status { margin-top: 8px; padding: 7px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 700;
                display: flex; align-items: center; gap: 7px; }
  .llm-status.ok { background: #E3F7EC; color: #1F6E48; }
  .llm-status.fail { background: #FCE9E9; color: #9E3B3B; }
  .llm-status.unknown { background: #F4F2FA; color: #8C87A6; }
  .llm-status-msg { font-weight: 500; opacity: 0.85; }
  .update-status { margin-top: 8px; padding: 8px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 600; }
  .update-status.ok { background: #E3F7EC; color: #1F6E48; }
  .update-status.newer { background: #FDF1D9; color: #9A6A15; }
  .update-status.fail { background: #FCE9E9; color: #9E3B3B; }
  .update-status.unknown { background: #F4F2FA; color: #8C87A6; }
  .update-status a { color: inherit; text-decoration: underline; font-weight: 700; }
  .release-notes-box { margin-top: 8px; padding: 10px 12px; background: #FAF9FD; border: 1px solid #ECE8F7;
                        border-radius: 8px; font-size: 11.5px; color: #6E6A87; white-space: pre-wrap;
                        max-height: 140px; overflow-y: auto; line-height: 1.6; }
  .update-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .update-now-btn { flex: 1; padding: 9px; border: none; border-radius: 8px;
                     background: linear-gradient(90deg,#7FD8AE,#93C5FD); color: #14532D;
                     font-size: 12.5px; font-weight: 700; cursor: pointer; }
  .update-now-btn:disabled { background: #F3F1F8; color: #C7C2D6; cursor: default; }
  .update-manual-link { font-size: 11.5px; color: #8B5FE0; font-weight: 600; white-space: nowrap; }
  .message { padding: 8px 12px; border-radius: 8px; margin-bottom: 14px; font-size: 12px;
             background: #E3F7EC; color: #1F6E48; }
  .message.warn { background: #FDF1D9; color: #9A6A15; }
  .hint { color: #B7B3CC; font-size: 11px; margin-top: 5px; }
  .check-row { display: flex; align-items: flex-start; gap: 9px; margin-top: 10px; cursor: pointer; }
  .check-row input[type=checkbox] { width: 16px; height: 16px; margin-top: 1px; flex-shrink: 0; cursor: pointer; accent-color: #8B5FE0; }
  .check-row span { font-size: 12px; color: #6E6A87; line-height: 1.4; }
</style>
</head>
<body>
<div class="app-shell">
{{ sidebar|safe }}
<main class="content"><div class="content-inner" style="max-width:640px;">
  <h1 style="font-size:18px;">설정</h1>
  <div class="sub" style="font-size:12.5px;margin-bottom:16px;">DB/모델 경로와 메신저 소스 연결을 관리해요</div>
  {% if message %}<div class="message {{ 'warn' if '⚠️' in message else '' }}">{{ message }}</div>{% endif %}

  <form method="post" action="/settings">
    <div class="card">
      <h2>내 정보</h2>
      <label>이름</label>
      <input type="text" name="profile_name" value="{{ profile_name }}" placeholder="예: 김민준">
      <label>부서/역할</label>
      <input type="text" name="profile_dept" value="{{ profile_dept }}" placeholder="예: 재활치료팀">
      <div class="hint">사이드바 좌측 하단에 표시돼요</div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h2>기본 경로</h2>
      <label>assistant.db 경로</label>
      <div class="path-row">
        <input type="text" id="db_path_input" name="db_path" value="{{ db_path }}" placeholder="assistant.db">
        <button type="button" class="browse-btn" onclick="pickFile('db_path_input', ['SQLite DB (*.db)', '모든 파일 (*.*)'])">📁 찾아보기</button>
      </div>
      <label>LLM 모델 경로 (.gguf, 분석하기 기능에 필요)</label>
      <div class="path-row">
        <input type="text" id="model_path_input" name="model_path" value="{{ model_path }}" placeholder="models\\Qwen_Qwen3-1.7B-Q4_K_M.gguf">
        <button type="button" class="browse-btn" onclick="pickFile('model_path_input', ['GGUF 모델 (*.gguf)', '모든 파일 (*.*)'])">📁 찾아보기</button>
      </div>
      <div class="llm-status {{ 'ok' if llm_status_ok == True else ('fail' if llm_status_ok == False else 'unknown') }}" id="llmStatusBox">
        {% if llm_status_ok == True %}🟢 연결됨{% elif llm_status_ok == False %}🔴 연결 실패{% else %}⚪ 미확인{% endif %}
        <span class="llm-status-msg">{{ llm_status_message }}</span>
      </div>
      <button type="button" class="test-btn-inline" onclick="testLLM(this)">🔌 연결 테스트 (처음엔 조금 걸려요)</button>
      <label style="margin-top:12px;">ML 모델 경로 (.joblib, 자동 수집 2단계에 필요)</label>
      <div class="path-row">
        <input type="text" id="ml_model_path_input" name="ml_model_path" value="{{ ml_model_path }}" placeholder="model.joblib">
        <button type="button" class="browse-btn" onclick="pickFile('ml_model_path_input', ['Joblib 모델 (*.joblib)', '모든 파일 (*.*)'])">📁 찾아보기</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h2>메신저 소스 연결</h2>
      <div id="sources-container">
      {% for s in sources %}
        <div class="source-row">
          <input type="text" class="name" name="source_name_{{ loop.index0 }}" value="{{ s.name }}" placeholder="이름 (비워두면 자동)">
          <select name="source_type_{{ loop.index0 }}">
            {% for t in source_types %}
            <option value="{{ t }}" {{ 'selected' if t == s.type else '' }}>{{ source_type_labels[t] }}</option>
            {% endfor %}
          </select>
          <input type="text" class="path" id="source_path_{{ loop.index0 }}" name="source_path_{{ loop.index0 }}" value="{{ s.path }}" placeholder="DB 파일 경로">
          <button type="button" class="browse-btn-sm" onclick="pickFile('source_path_{{ loop.index0 }}', ['SQLite DB (*.db)', '모든 파일 (*.*)'])">📁</button>
          <button type="button" onclick="this.parentElement.remove()">삭제</button>
        </div>
      {% endfor %}
      </div>
      <button type="button" class="add-btn" onclick="addSourceRow()">➕ 소스 추가</button>
      <div class="hint">여러 개 추가 가능합니다 (예: IP메신저 1개 + 미래랜메신저 1개, 나중에 더 늘려도 됨)</div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h2>위젯</h2>
      <label class="check-row">
        <input type="checkbox" name="tray_enabled" {{ 'checked' if tray_enabled else '' }}>
        <span>작업표시줄 트레이에 상주 (창을 닫아도 계속 실행, 완전 종료는 트레이 아이콘 우클릭)</span>
      </label>
      <label class="check-row">
        <input type="checkbox" name="postit_enabled" {{ 'checked' if postit_enabled else '' }}>
        <span>포스트잇 기능 사용 (바탕화면 위젯 + 메모)</span>
      </label>
      <label class="check-row">
        <input type="checkbox" name="auto_check_update" {{ 'checked' if auto_check_update else '' }}>
        <span>시작 시 자동으로 업데이트 확인 (아래에 GitHub 저장소가 설정돼 있어야 동작해요)</span>
      </label>
      <div class="hint">저장 후 다음 실행부터 적용돼요 (지금 켜져있는 창에는 즉시 반영 안 됨)</div>
    </div>

    <button type="submit" class="save-btn">설정 저장</button>
  </form>
  <form method="post" action="/settings/collect">
    <button type="submit" class="collect-btn">🔄 지금 새 메시지 가져오기 (규칙엔진+ML 적용)</button>
  </form>

  <div class="card" style="margin-top:14px;">
    <h2>업데이트</h2>
    <div class="hint" style="margin-top:0;">현재 버전: v{{ app_version }}</div>
    <label>GitHub 저장소 (예: myname/itda-releases)</label>
    <input type="text" id="update_repo_input" value="{{ update_repo }}" placeholder="owner/repo">
    <div class="update-status {{ 'ok' if update_status.state == 'ok' else ('newer' if update_status.state == 'newer' else ('fail' if update_status.state == 'fail' else 'unknown')) }}" id="updateStatusBox">
      {{ update_status.message|safe }}
    </div>

    <div id="updateAvailableBox" style="{{ '' if update_status.state == 'newer' else 'display:none;' }}">
      <div class="release-notes-box" id="releaseNotesBox">{{ update_status.release_notes or '' }}</div>
      <div class="update-actions">
        <button type="button" class="update-now-btn" id="updateNowBtn" onclick="startUpdate()"
                {{ '' if update_status.download_url else 'disabled' }}>⬇️ 지금 업데이트</button>
        <a class="update-manual-link" href="{{ update_status.release_url or '#' }}" target="_blank">수동으로 받기</a>
      </div>
      <div class="hint">업데이트를 누르면 새 버전을 내려받고, 앱이 자동으로 닫혔다가 새 버전으로 다시 열려요.</div>
    </div>

    <button type="button" class="test-btn-inline" onclick="checkUpdate()">🔍 업데이트 확인</button>
    <div class="hint">저장소를 지정하면 GitHub의 최신 릴리스와 현재 버전을 비교해줘요. 아직 실제 배포 저장소가 없다면 비워두세요.</div>
  </div>

  <div class="card" style="margin-top:14px;">
    <h2>진단 정보</h2>
    <div class="hint" style="margin-top:0;">저장이 이상하게 동작할 때 확인용 (지원 요청 시 이 파일 내용을 같이 보내주시면 원인 파악이 빨라요)</div>
    <label>설정 파일 위치</label>
    <input type="text" value="{{ config_path }}" readonly onclick="this.select()">
    <label>진단 로그 위치</label>
    <input type="text" value="{{ log_path }}" readonly onclick="this.select()">
    <div class="hint">저장/불러오기할 때마다 자동으로 기록돼요. 메모장으로 열어보시면 돼요.</div>
  </div>
</div></main>
</div>

<script>
let _latestUpdateData = null;

async function checkUpdate() {
  const repo = document.getElementById('update_repo_input').value.trim();
  const statusEl = document.getElementById('updateStatusBox');
  const box = document.getElementById('updateAvailableBox');
  statusEl.textContent = '확인 중...';
  box.style.display = 'none';
  try {
    const resp = await fetch('/settings/check_update', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({repo})
    });
    const data = await resp.json();
    _latestUpdateData = data;
    statusEl.className = 'update-status ' + data.state;
    statusEl.innerHTML = data.message;

    if (data.state === 'newer') {
      box.style.display = 'block';
      document.getElementById('releaseNotesBox').textContent = data.release_notes || '(릴리스 노트 없음)';
      const btn = document.getElementById('updateNowBtn');
      btn.disabled = !data.download_url;
      document.querySelector('.update-manual-link').href = data.release_url || '#';
    }
  } catch (e) {
    statusEl.className = 'update-status fail';
    statusEl.textContent = '요청 중 오류가 발생했습니다: ' + e;
  }
}

async function startUpdate() {
  if (!window.pywebview) {
    alert('원클릭 업데이트는 잇다 앱(데스크톱 프로그램)에서만 사용할 수 있어요.\\n"수동으로 받기" 링크를 이용해주세요.');
    return;
  }
  if (!_latestUpdateData || !_latestUpdateData.download_url) {
    alert('다운로드 링크를 찾을 수 없어요. 업데이트 확인을 다시 눌러보세요.');
    return;
  }
  if (!confirm(`v${_latestUpdateData.latest_version}으로 업데이트할까요?\\n앱이 자동으로 닫혔다가 새 버전으로 다시 열려요.`)) {
    return;
  }

  const btn = document.getElementById('updateNowBtn');
  btn.disabled = true;
  btn.textContent = '다운로드 중... 0%';

  // 다운로드 진행률을 0.5초마다 물어봐서 버튼 텍스트로 보여줌
  const progressTimer = setInterval(async () => {
    try {
      const p = await window.pywebview.api.get_download_progress();
      if (!p.done && !p.error) {
        btn.textContent = `다운로드 중... ${p.percent}%`;
      }
    } catch (e) { /* 진행률 조회 실패는 무시 - 치명적이지 않음 */ }
  }, 500);

  try {
    const result = await window.pywebview.api.download_and_install_update(_latestUpdateData.download_url);
    clearInterval(progressTimer);
    if (result.ok) {
      btn.textContent = '설치 중... 잠시 후 앱이 자동으로 다시 열려요';
      alert('업데이트를 설치할게요.\\n\\n앱이 지금 닫히고, 설치 진행 창이 잠깐 보였다가,\\n완료되면 자동으로 다시 열려요.\\n(30초~1분 정도 걸릴 수 있어요, 너무 급하게 다시 실행하지 말아주세요)');
      window.pywebview.api.quit_app();
    } else {
      alert('업데이트 실패: ' + result.error);
      btn.disabled = false;
      btn.textContent = '⬇️ 지금 업데이트';
    }
  } catch (e) {
    clearInterval(progressTimer);
    alert('업데이트 중 오류가 발생했습니다: ' + e);
    btn.disabled = false;
    btn.textContent = '⬇️ 지금 업데이트';
  }
}

async function testLLM(btn) {
  // 아직 "설정 저장"을 안 눌렀어도, 지금 입력창/찾아보기로 골라둔 경로를 그대로 테스트한다
  // (예전엔 저장된 값만 테스트해서 "찾아보기 후 바로 테스트"가 항상 "경로 미설정"으로 실패했음)
  const modelPath = document.getElementById('model_path_input').value.trim();
  const statusEl = document.getElementById('llmStatusBox');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '연결 확인 중... (모델 로딩, 조금 걸려요)';
  try {
    const resp = await fetch('/settings/test_model', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model_path: modelPath})
    });
    const data = await resp.json();
    statusEl.className = 'llm-status ' + (data.ok ? 'ok' : 'fail');
    statusEl.innerHTML = (data.ok ? '🟢 연결됨 ' : '🔴 연결 실패 ') + '<span class="llm-status-msg">' + data.message + '</span>';
  } catch (e) {
    statusEl.className = 'llm-status fail';
    statusEl.innerHTML = '🔴 연결 실패 <span class="llm-status-msg">요청 중 오류: ' + e + '</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}
</script>

<script>
let rowCounter = {{ sources|length }};
function addSourceRow() {
  const container = document.getElementById('sources-container');
  const div = document.createElement('div');
  div.className = 'source-row';
  const pathId = `source_path_${rowCounter}`;
  div.innerHTML = `
    <input type="text" class="name" name="source_name_${rowCounter}" placeholder="이름 (비워두면 자동)">
    <select name="source_type_${rowCounter}">
      {% for t in source_types %}<option value="{{ t }}">{{ source_type_labels[t] }}</option>{% endfor %}
    </select>
    <input type="text" class="path" id="${pathId}" name="source_path_${rowCounter}" placeholder="DB 파일 경로">
    <button type="button" class="browse-btn-sm" onclick="pickFile('${pathId}', ['SQLite DB (*.db)', '모든 파일 (*.*)'])">📁</button>
    <button type="button" onclick="this.parentElement.remove()">삭제</button>
  `;
  container.appendChild(div);
  rowCounter += 1;
}

// 데스크톱 앱(pywebview) 안에서만 동작 - 네이티브 파일 탐색기를 열어서
// 선택한 파일의 전체 경로를 해당 입력창에 채워준다.
async function pickFile(inputId, fileTypes) {
  if (!window.pywebview) {
    alert('파일 찾아보기는 잇다 앱(데스크톱 프로그램)에서만 사용할 수 있어요.\\n브라우저로 열었을 때는 경로를 직접 입력해주세요.');
    return;
  }
  try {
    const path = await window.pywebview.api.pick_file(fileTypes);
    if (path) {
      document.getElementById(inputId).value = path;
    }
  } catch (e) {
    alert('파일 선택 중 오류가 발생했습니다: ' + e);
  }
}
</script>
</body>
</html>
"""


def _settings_context(message=None):
    log_dir = os.path.dirname(os.path.abspath(CONFIG_PATH)) or "."
    return dict(
        db_path=DB_PATH, model_path=MODEL_PATH or "", ml_model_path=ML_MODEL_PATH or "",
        sources=SOURCES, message=message, source_types=SOURCE_TYPES, source_type_labels=SOURCE_TYPE_LABELS,
        shared_css=SHARED_CSS, sidebar=sidebar_html("settings"),
        llm_status_ok=_LLM_TEST_STATUS["ok"], llm_status_message=_LLM_TEST_STATUS["message"],
        app_version=APP_VERSION, update_repo=UPDATE_REPO, update_status=_UPDATE_STATUS,
        auto_check_update=AUTO_CHECK_UPDATE,
        profile_name=PROFILE_NAME, profile_dept=PROFILE_DEPT,
        tray_enabled=TRAY_ENABLED, postit_enabled=POSTIT_ENABLED,
        config_path=os.path.abspath(CONFIG_PATH), log_path=os.path.join(log_dir, "itda_debug.log"),
    )


@app.route("/settings", methods=["GET", "POST"])
def settings():
    from flask import render_template_string

    if request.method == "GET":
        return render_template_string(SETTINGS_HTML, **_settings_context())

    global DB_PATH, MODEL_PATH, ML_MODEL_PATH, SOURCES, PROFILE_NAME, PROFILE_DEPT
    global TRAY_ENABLED, POSTIT_ENABLED, AUTO_CHECK_UPDATE

    db_path = request.form.get("db_path", "").strip() or "assistant.db"
    model_path = request.form.get("model_path", "").strip() or None
    ml_model_path = request.form.get("ml_model_path", "").strip() or None
    profile_name = request.form.get("profile_name", "").strip() or "사용자"
    profile_dept = request.form.get("profile_dept", "").strip() or "잇다 사용 중"
    # 체크박스는 체크 안 하면 폼에 아예 안 딸려오므로, 존재 여부로 판단
    tray_enabled = request.form.get("tray_enabled") == "on"
    postit_enabled = request.form.get("postit_enabled") == "on"
    auto_check_update = request.form.get("auto_check_update") == "on"

    # source_name_<idx> 패턴으로 실제 존재하는 인덱스를 스캔한다 (중간 행이 삭제돼서
    # 인덱스가 연속이 아니어도 안전하게 처리하기 위함)
    indices = set()
    for key in request.form.keys():
        if key.startswith("source_name_"):
            indices.add(key.rsplit("_", 1)[-1])

    source_keys_raw = [k for k in request.form.keys() if k.startswith("source_")]
    _log_debug(f"/settings POST 받음 - source_ 로 시작하는 폼 필드들: {source_keys_raw}")

    sources = []
    skipped_reasons = []
    name_counts = {}  # 같은 타입 이름이 자동으로 여러 개 생기면 "IP메신저 2"처럼 번호 붙이기용
    for idx in sorted(indices, key=lambda x: int(x)):
        name = request.form.get(f"source_name_{idx}", "").strip()
        stype = request.form.get(f"source_type_{idx}", "")
        path = request.form.get(f"source_path_{idx}", "").strip()

        if not path and not name:
            continue  # 완전히 빈 채로 남겨둔 행(추가만 하고 아무것도 안 채운 경우)은 조용히 무시

        # 이름을 안 채우고 경로/타입만 넣는 경우가 흔해서(특히 "찾아보기"만 쓰고 이름을 깜빡하는 경우),
        # 이제는 이것 때문에 행 전체가 조용히 사라지지 않도록 타입 이름으로 자동 채워준다.
        if not name and stype in SOURCE_TYPES:
            base = SOURCE_TYPE_LABELS[stype]
            name_counts[base] = name_counts.get(base, 0) + 1
            name = base if name_counts[base] == 1 else f"{base} {name_counts[base]}"
            _log_debug(f"소스 행 {idx}: 이름이 비어있어서 자동으로 '{name}'(으)로 채움")

        if not path or stype not in SOURCE_TYPES:
            skipped_reasons.append(
                f"'{name or '(이름없음)'}' 행: " +
                ("경로가 비어있어요" if not path else f"소스 타입이 올바르지 않아요({stype!r})")
            )
            _log_debug(f"소스 행 {idx} 걸러짐 -> name={name!r}, type={stype!r}, path={path!r}")
            continue

        sources.append({"name": name, "type": stype, "path": path})

    _log_debug(f"최종 파싱된 sources ({len(sources)}개): {sources}")

    if model_path != MODEL_PATH:
        # 모델 경로가 바뀌면 이전 연결 테스트 결과는 더 이상 유효하지 않음
        _LLM_TEST_STATUS["ok"] = None
        _LLM_TEST_STATUS["message"] = "경로가 바뀌었습니다 - 다시 연결 테스트해주세요"

    DB_PATH, MODEL_PATH, ML_MODEL_PATH, SOURCES = db_path, model_path, ml_model_path, sources
    PROFILE_NAME, PROFILE_DEPT = profile_name, profile_dept
    TRAY_ENABLED, POSTIT_ENABLED = tray_enabled, postit_enabled
    AUTO_CHECK_UPDATE = auto_check_update
    _save_all_config()

    if skipped_reasons:
        message = ("⚠️ 설정은 저장했지만, 다음 소스는 정보가 부족해서 제외됐어요: "
                   + " / ".join(skipped_reasons))
    else:
        message = "✓ 설정을 저장했습니다."

    return render_template_string(SETTINGS_HTML, **_settings_context(message=message))


@app.route("/settings/check_update", methods=["POST"])
def settings_check_update():
    global UPDATE_REPO
    data = request.get_json(force=True, silent=True) or {}
    repo = (data.get("repo") or "").strip()
    UPDATE_REPO = repo

    # 저장소 입력값은 즉시 설정 파일에도 반영 (다른 항목은 안 건드림)
    _save_all_config()

    # 매번 새로 확인하는 거니 이전 결과(릴리스노트/다운로드링크 등)는 초기화
    _UPDATE_STATUS.update({"latest_version": None, "release_notes": None,
                            "download_url": None, "release_url": None})

    if not repo:
        _UPDATE_STATUS["state"] = "unknown"
        _UPDATE_STATUS["message"] = "GitHub 저장소를 입력하지 않았습니다."
        return jsonify(_UPDATE_STATUS)

    try:
        import urllib.request
        import json as _json
        url = f"https://api.github.com/repos/{repo}/releases/latest"
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                     "User-Agent": "itda-app"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            release = _json.loads(resp.read().decode("utf-8"))
        latest_tag = str(release.get("tag_name", "")).lstrip("v")
        release_url = release.get("html_url", f"https://github.com/{repo}/releases")
        release_notes = release.get("body") or "(릴리스 노트가 작성되지 않았습니다)"

        # Itda_Setup.exe 애셋의 실제 다운로드 링크를 찾는다 (원클릭 업데이트용)
        download_url = None
        for asset in release.get("assets", []):
            if str(asset.get("name", "")).lower().endswith(".exe"):
                download_url = asset.get("browser_download_url")
                break

        if not latest_tag:
            _UPDATE_STATUS["state"] = "fail"
            _UPDATE_STATUS["message"] = "저장소에서 릴리스 정보를 찾지 못했습니다."
        elif latest_tag == APP_VERSION:
            _UPDATE_STATUS["state"] = "ok"
            _UPDATE_STATUS["message"] = f"최신 버전을 사용 중이에요 (v{APP_VERSION})"
        else:
            _UPDATE_STATUS["state"] = "newer"
            _UPDATE_STATUS["message"] = f"새 버전이 있어요: v{latest_tag} (현재 v{APP_VERSION})"
            _UPDATE_STATUS["latest_version"] = latest_tag
            _UPDATE_STATUS["release_notes"] = release_notes
            _UPDATE_STATUS["release_url"] = release_url
            _UPDATE_STATUS["download_url"] = download_url
            if not download_url:
                _UPDATE_STATUS["message"] += " (설치 파일을 못 찾아서 원클릭 업데이트는 안 돼요 - 릴리스에 exe가 첨부됐는지 확인해주세요)"
    except Exception as e:
        _UPDATE_STATUS["state"] = "fail"
        _UPDATE_STATUS["message"] = f"업데이트 확인 실패: {e}"

    return jsonify(_UPDATE_STATUS)


@app.route("/settings/test_model", methods=["POST"])
def settings_test_model():
    global MODEL_PATH

    data = request.get_json(force=True, silent=True) or {}
    # 화면에 지금 입력/선택돼있는 경로를 우선 테스트한다 (아직 "설정 저장"을 안 눌렀어도
    # 찾아보기로 고른 경로를 바로 테스트할 수 있어야 하므로).
    candidate_path = (data.get("model_path") or "").strip() or MODEL_PATH

    if not candidate_path:
        _LLM_TEST_STATUS["ok"] = False
        _LLM_TEST_STATUS["message"] = "모델 경로가 설정되지 않았습니다"
    elif not os.path.exists(candidate_path):
        _LLM_TEST_STATUS["ok"] = False
        _LLM_TEST_STATUS["message"] = f"파일을 찾을 수 없습니다: {candidate_path}"
    else:
        try:
            from itda_llm_stage3 import load_model, _build_analyze_grammar
            # 기존 캐시가 다른 경로였으면 새로 로드, 같은 경로면 캐시 재사용
            if _LLM_CACHE["model_path"] != candidate_path:
                _LLM_CACHE["llm"] = load_model(candidate_path, n_ctx=4096, n_threads=4)
                _LLM_CACHE["grammar"] = _build_analyze_grammar()
                _LLM_CACHE["model_path"] = candidate_path
            _LLM_TEST_STATUS["ok"] = True
            _LLM_TEST_STATUS["message"] = "모델을 정상적으로 불러왔습니다"
            # 테스트 성공한 경로를 실제 사용 경로로 채택 + 저장 (검증 안 된 경로가 저장되는 걸 방지)
            MODEL_PATH = candidate_path
            _save_all_config()
        except Exception as e:
            _LLM_TEST_STATUS["ok"] = False
            _LLM_TEST_STATUS["message"] = str(e)

    return jsonify(_LLM_TEST_STATUS)


@app.route("/settings/collect", methods=["POST"])
def settings_collect():
    from flask import render_template_string

    if not SOURCES:
        return render_template_string(SETTINGS_HTML, **_settings_context(
            message="설정된 메신저 소스가 없습니다. 먼저 위에서 추가하고 저장해주세요."))

    try:
        from itda_adapters import IPMessengerAdapter, MiraeLanAdapter
        from itda_pipeline_v2 import run as run_pipeline
    except ImportError as e:
        return render_template_string(SETTINGS_HTML, **_settings_context(
            message=f"파이프라인 모듈을 불러오지 못했습니다 (itda_adapters.py/itda_pipeline_v2.py/itda_rules.py가 "
                    f"같은 폴더에 있는지 확인하세요): {e}"))

    adapter_map = {"ipmsg": IPMessengerAdapter, "miraelan": MiraeLanAdapter}
    adapters = []
    missing = []
    for s in SOURCES:
        cls = adapter_map.get(s["type"])
        if not cls:
            continue
        if not os.path.exists(s["path"]):
            missing.append(s["name"])
            continue
        adapters.append(cls(s["path"]))

    if missing:
        message = f"다음 소스 파일을 찾을 수 없습니다: {', '.join(missing)}"
    elif not adapters:
        message = "유효한 소스가 없습니다."
    elif not ML_MODEL_PATH or not os.path.exists(ML_MODEL_PATH):
        message = f"ML 모델 파일을 찾을 수 없습니다: {ML_MODEL_PATH or '(경로 미설정)'}"
    else:
        try:
            counts = run_pipeline(DB_PATH, adapters, ML_MODEL_PATH)
            if counts:
                message = "✓ 수집 완료: " + ", ".join(f"{k} {v}건" for k, v in sorted(counts.items(), key=lambda x: -x[1]))
            else:
                message = "새로 들어온 메시지가 없습니다."
        except Exception as e:
            message = f"수집 중 오류가 발생했습니다: {e}"

    return render_template_string(SETTINGS_HTML, **_settings_context(message=message))


def main():
    global DB_PATH, MODEL_PATH, ML_MODEL_PATH, SOURCES, CONFIG_PATH
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=None)
    parser.add_argument("--model", default=None, help="GGUF 모델 경로 (없으면 /analyze 분석하기만 비활성화)")
    parser.add_argument("--ml-model", default=None, help="joblib 모델 경로 (없으면 지금 수집하기 비활성화)")
    parser.add_argument("--config", default="itda_config.json", help="설정 파일 경로")
    parser.add_argument("--port", type=int, default=5050)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    CONFIG_PATH = args.config
    cfg = _load_config()
    _apply_config_globals(cfg)

    # CLI 인자가 명시적으로 주어지면 설정 파일보다 우선
    if args.db:
        DB_PATH = args.db
    elif not cfg.get("db_path"):
        DB_PATH = "assistant.db"
    if args.model:
        MODEL_PATH = args.model
    if args.ml_model:
        ML_MODEL_PATH = args.ml_model

    print(f"잇다 제안 검토 위젯: http://{args.host}:{args.port}")
    print(f"  DB: {DB_PATH} / 모델: {MODEL_PATH or '미설정'} / ML모델: {ML_MODEL_PATH or '미설정'} / 소스 {len(SOURCES)}개")
    init_db_schema()
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
