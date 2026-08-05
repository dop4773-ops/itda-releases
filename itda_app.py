"""
잇다 (Itda) - 데스크톱 앱 진입점

itda_review_app.py의 Flask 서버를 백그라운드 스레드로 돌리고,
브라우저 대신 pywebview로 만든 전용 창에 띄운다.
사람 입장에서는 "잇다.exe" 더블클릭 -> 창 하나 뜸, 그게 전부.
(내부적으로는 여전히 로컬 Flask 서버가 돌지만 안 보이게 감춰짐)

사전 준비:
    pip install flask pywebview
    pip install pystray pillow   # 선택사항 - 작업표시줄 트레이 상주 기능에 필요
                                   # (없어도 앱은 정상 동작하고, 창 닫으면 그냥 종료됨)

실행 (개발 중 테스트):
    python itda_app.py

.exe로 패키징하는 방법은 build_exe.ps1 참고.

DB 경로 결정 순서:
    1) 실행파일(또는 이 스크립트)과 같은 폴더에 itda_config.json이 있으면 그 안의 "db_path" 사용
    2) 없으면 실행파일과 같은 폴더의 assistant.db 사용
"""
import json
import os
import sys
import threading
import time

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def _base_dir() -> str:
    """PyInstaller로 패키징됐을 때(sys.frozen)와 그냥 스크립트로 실행될 때 모두
    exe/스크립트가 있는 폴더를 정확히 찾기 위한 함수.
    assistant.db, itda_config.json처럼 '사용자가 직접 만들고 옮기는 파일'용 기준 경로."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _resource_dir() -> str:
    """--add-data로 빌드에 포함시킨 파일(아이콘 등)이 실제로 풀리는 위치.
    _base_dir()과 다른 개념: PyInstaller 6+ onedir 빌드는 --add-data로 넣은
    파일들을 exe와 같은 폴더가 아니라 그 안의 _internal 폴더에 넣기 때문에,
    sys._MEIPASS를 통해서 찾아야 정확하다. (트레이 아이콘이 계속 기본 보라색
    사각형으로만 뜨던 버그가 바로 이 구분을 안 해서 생긴 문제였음)"""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def _run_flask(base_dir: str, port: int):
    import itda_review_app as review_app

    config_path = os.path.join(base_dir, "itda_config.json")
    review_app.CONFIG_PATH = config_path
    cfg = review_app._load_config()

    def _abs(p):
        if not p:
            return None
        return p if os.path.isabs(p) else os.path.join(base_dir, p)

    # review_app의 공통 로직을 그대로 재사용 (경로를 각자 다시 구현하다가 필드 하나
    # 빠뜨리는 실수를 방지하기 위함 - db_path/model_path 등은 실행파일 기준 상대경로도
    # 지원해야 해서 절대경로 변환만 여기서 별도로 처리)
    review_app._apply_config_globals(cfg)
    review_app.DB_PATH = _abs(review_app.DB_PATH) or os.path.join(base_dir, "assistant.db")
    review_app.MODEL_PATH = _abs(review_app.MODEL_PATH)
    review_app.ML_MODEL_PATH = _abs(review_app.ML_MODEL_PATH)

    # 앱을 처음 실행할 때(빈 assistant.db) 테이블이 하나도 없어서 "제안 검토" 등에서
    # 500 에러가 나던 문제 수정 - 여기서 전체 스키마를 미리 만들어둔다.
    review_app.init_db_schema()

    # debug=False, use_reloader=False 필수 - 안 그러면 스레드/패키징 환경에서 오작동함
    review_app.app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False, threaded=True)


class Api:
    """설정 화면의 '찾아보기' 버튼, 포스트잇의 '바탕화면에 띄우기' 버튼이 호출하는
    JS API 브릿지 (window.pywebview.api.함수이름(...) 형태로 호출됨)."""

    def __init__(self, port: int):
        self.port = port
        self._widget_window = None

    def pick_file(self, file_types=None):
        import webview
        types = tuple(file_types) if file_types else ("모든 파일 (*.*)",)
        result = webview.windows[0].create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=types
        )
        if result:
            return result[0]
        return None

    def open_postit_widget(self):
        """포스트잇 위젯을 화면 우측 하단에 항상 위(on_top)로 띄운다.
        이미 떠있으면 새로 안 만들고 그냥 다시 보여주기만 함."""
        import webview

        if self._widget_window is not None:
            try:
                self._widget_window.show()
                return "shown_existing"
            except Exception:
                self._widget_window = None  # 창이 이미 닫혔던 경우 - 아래에서 새로 만듦

        width, height = 260, 420
        x, y = None, None
        try:
            screens = webview.screens
            if screens:
                sw, sh = screens[0].width, screens[0].height
                x, y = sw - width - 24, sh - height - 80  # 작업표시줄 위, 우측 하단
        except Exception:
            pass  # 화면 크기 못 가져와도 창은 그냥 기본 위치에 뜨게 (기능 자체는 동작)

        self._widget_window = webview.create_window(
            "잇다 포스트잇",
            f"http://127.0.0.1:{self.port}/postit/widget",
            width=width, height=height, x=x, y=y,
            frameless=True, on_top=True, resizable=True,
            background_color="#F8F7FC",
            js_api=self,  # 위젯 창 안의 X 버튼이 close_postit_widget()을 호출할 수 있도록
        )
        return "created"

    def close_postit_widget(self):
        """프레임 없는 창이라 자체 닫기(X) 버튼이 없어서, 위젯 안의 X 버튼이 이걸 호출해서 닫는다."""
        if self._widget_window is not None:
            try:
                self._widget_window.destroy()
            except Exception:
                pass
            self._widget_window = None
        return "closed"


def _tray_enabled(base_dir: str) -> bool:
    """설정 화면(위젯 카드)에서 끄면 트레이 아이콘 없이 평범하게 닫히는 창으로 동작한다.
    기본값은 켜짐(True)."""
    config_path = os.path.join(base_dir, "itda_config.json")
    if not os.path.exists(config_path):
        return True
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return bool(cfg.get("tray_enabled", True))
    except Exception:
        return True


def _setup_tray(window, base_dir: str) -> bool:
    """트레이 아이콘을 띄우고, 창을 닫아도 완전히 종료되지 않고 트레이에 상주하게 만든다.
    pystray/Pillow가 없으면 조용히 포기하고 평범한 창(닫으면 진짜 종료)으로 동작한다."""
    try:
        import pystray
        from PIL import Image
    except Exception as e:
        # ImportError뿐 아니라, 플랫폼별 백엔드 선택 실패 등 다른 예외가 날 수도 있어서
        # 넓게 잡는다 - 트레이 기능 하나 때문에 앱 전체가 죽으면 안 되므로.
        print(f"안내: 트레이 아이콘을 초기화하지 못해 트레이 없이 실행합니다 ({e})", file=sys.stderr)
        print("      (pip install pystray pillow 로 설치하면 작업표시줄 상주 기능을 쓸 수 있어요)",
              file=sys.stderr)
        return False

    # --add-data로 번들된 위치(_resource_dir)를 우선 찾고, 혹시 몰라 실행파일 폴더
    # (base_dir)에도 있으면 그것도 폴백으로 시도 - 둘 다 실패해야 기본 사각형으로 대체
    candidate_paths = [
        os.path.join(_resource_dir(), "itda_icon.ico"),
        os.path.join(base_dir, "itda_icon.ico"),
    ]
    image = None
    for icon_path in candidate_paths:
        try:
            image = Image.open(icon_path)
            break
        except Exception:
            continue
    if image is None:
        print(f"안내: itda_icon.ico를 다음 경로들에서 못 찾았습니다: {candidate_paths}", file=sys.stderr)
        print("      기본 사각형 아이콘으로 대체합니다.", file=sys.stderr)
        image = Image.new("RGB", (64, 64), color=(139, 95, 224))

    def on_show(icon=None, item=None):
        window.show()

    def on_quit(icon=None, item=None):
        # 트레이/윈도우/Flask(데몬 스레드)까지 전부 확실히 종료
        try:
            tray_icon.stop()
        except Exception:
            pass
        try:
            window.destroy()
        except Exception:
            pass
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("잇다 열기", on_show, default=True),
        pystray.MenuItem("종료", on_quit),
    )
    tray_icon = pystray.Icon("itda", image, "잇다 (Itda)", menu)

    # pystray.Icon.run()도 자체 이벤트 루프라 블로킹됨 - webview.start()와 별도 스레드로 분리
    tray_thread = threading.Thread(target=tray_icon.run, daemon=True)
    tray_thread.start()

    def on_closing():
        window.hide()
        return False  # False를 반환해야 실제 창 파괴(destroy)를 막고 숨기기만 함

    window.events.closing += on_closing
    return True


def _try_focus_existing_instance(port: int) -> bool:
    """트레이 상주 기능 때문에, 사용자가 실행 중인 걸 모르고 아이콘을 다시 눌러서
    두 번째 인스턴스가 뜰 수 있다. 이 경우 서로 다른 프로세스가 각자 다른 메모리에
    설정을 들고 있게 되어 '방금 저장한 설정이 사라진 것처럼 보이는' 매우 헷갈리는
    버그로 이어진다 - 그래서 이미 떠있는 인스턴스가 있으면 그쪽 창만 보여주고
    새 인스턴스는 아무것도 안 띄운 채 조용히 종료한다."""
    import urllib.request
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/__focus_window", method="POST")
        urllib.request.urlopen(req, timeout=1.5)
        return True
    except Exception:
        return False


def main():
    port = 5050
    base_dir = _base_dir()

    if _try_focus_existing_instance(port):
        print("잇다가 이미 실행 중이라 기존 창을 그대로 사용합니다 (새 인스턴스는 띄우지 않음).")
        return

    print(f"잇다 시작 중... (기준 폴더: {base_dir})")

    flask_thread = threading.Thread(target=_run_flask, args=(base_dir, port), daemon=True)
    flask_thread.start()

    # Flask가 실제로 요청을 받을 준비가 될 때까지 잠깐 대기
    time.sleep(1.0)

    import webview
    api = Api(port)
    window = webview.create_window(
        "잇다 (Itda)",
        f"http://127.0.0.1:{port}/add",
        width=1040,
        height=760,
        min_size=(780, 560),
        js_api=api,
    )

    # 나중에 두 번째 인스턴스가 실행되면 "창 좀 보여줘"라고 여기로 요청을 보낸다
    # (트레이에 숨어있을 때 실수로 다시 실행해도 창만 다시 보여주고 끝나게)
    import itda_review_app as review_app

    @review_app.app.route("/__focus_window", methods=["POST"])
    def __focus_window():
        window.show()
        return "ok"

    if _tray_enabled(base_dir):
        tray_ok = _setup_tray(window, base_dir)
        if tray_ok:
            print("트레이 아이콘 활성화됨 - 창을 닫아도 작업표시줄에서 계속 실행됩니다. "
                  "완전히 끄려면 트레이 아이콘 우클릭 > 종료를 눌러주세요.")

    webview.start()


if __name__ == "__main__":
    main()
