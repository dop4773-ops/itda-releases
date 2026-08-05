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


_shared_state = {"window": None}  # main()이 창을 만든 뒤 여기에 넣어두면, _run_flask 안에서
                                    # 등록된 라우트가 나중에 이걸 읽어서 창을 보여줄 수 있음


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

    # 두 번째 인스턴스가 나중에 실행되면 "창 좀 보여줘"라고 여기로 요청을 보낸다
    # (트레이에 숨어있을 때 실수로 다시 실행해도 창만 다시 보여주고 끝나게).
    # 주의: 이 라우트는 반드시 app.run() 호출 "전에", 같은 스레드에서 등록해야 한다.
    # 예전엔 이걸 main() 쪽(다른 스레드)에서 서버가 이미 돌고 있는 도중에 동적으로
    # 추가했었는데, 그게 Flask/Werkzeug 내부 라우팅 테이블을 다른 스레드에서 건드리는
    # 셈이라 스레드 안전성 문제가 있었고, "뭘 눌러도 응답없음"으로 이어진 걸로 보인다.
    @review_app.app.route("/__focus_window", methods=["POST"])
    def __focus_window():
        w = _shared_state.get("window")
        if w is not None:
            w.show()
        return "ok"

    # debug=False, use_reloader=False 필수 - 안 그러면 스레드/패키징 환경에서 오작동함
    review_app.app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False, threaded=True)


class Api:
    """설정 화면의 '찾아보기'/'지금 업데이트' 버튼, 포스트잇의 '바탕화면에 띄우기' 버튼이
    호출하는 JS API 브릿지 (window.pywebview.api.함수이름(...) 형태로 호출됨)."""

    def __init__(self, port: int):
        self.port = port
        self._widget_window = None
        self.main_window = None  # main()에서 설정 - quit_app()이 종료시킬 대상
        self._tray_icon = None   # _setup_tray()가 설정 - quit_app()이 함께 정지시킬 대상
        self._download_progress = {"percent": 0, "done": False, "error": None}

    def pick_file(self, file_types=None):
        import webview
        types = tuple(file_types) if file_types else ("모든 파일 (*.*)",)
        result = webview.windows[0].create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=types
        )
        if result:
            return result[0]
        return None

    def get_download_progress(self):
        """다운로드 중일 때 JS가 주기적으로 호출해서 진행률(%)을 물어보는 용도."""
        return self._download_progress

    def download_and_install_update(self, url):
        """새 버전의 설치 파일(Itda_Setup.exe)을 받아서, 설치 진행 상황이 화면에
        보이는 채로(완전 무음 설치 아님 - 뭔가 되고 있다는 걸 알 수 있게) 설치하고
        자동으로 재시작하는 헬퍼 프로세스를 준비한다.
        실제 종료는 이 함수가 성공한 뒤 JS가 quit_app()을 별도로 호출해야 실행됨
        (다운로드 도중에 앱이 꺼지면 안 되니까 순서를 분리)."""
        import urllib.request
        import tempfile

        self._download_progress = {"percent": 0, "done": False, "error": None}

        def _report(block_num, block_size, total_size):
            if total_size > 0:
                pct = min(100, int(block_num * block_size * 100 / total_size))
                self._download_progress["percent"] = pct

        try:
            tmp_dir = tempfile.gettempdir()
            installer_path = os.path.join(tmp_dir, "Itda_Setup_update.exe")
            urllib.request.urlretrieve(url, installer_path, reporthook=_report)
            self._download_progress["percent"] = 100
        except Exception as e:
            self._download_progress["error"] = str(e)
            return {"ok": False, "error": f"다운로드 실패: {e}"}

        try:
            import subprocess
            base_dir = _base_dir()
            exe_path = os.path.join(base_dir, "잇다.exe")
            lock_path = _update_lock_path(base_dir)
            log_path = os.path.join(base_dir, "itda_update_log.txt")

            # 설치가 진행 중이라는 걸 표시하는 잠금 파일 - main()이 시작할 때 이 파일이
            # 있으면 "업데이트 중이니 기다려주세요" 화면만 보여주고 정상 실행은 안 해서,
            # 헬퍼가 아직 설치 중인데 사용자가 급하게 다시 실행해서 꼬이는 걸 방지한다.
            with open(lock_path, "w", encoding="utf-8") as f:
                f.write("updating")

            # 지금 이 프로세스가 완전히 종료된 뒤(quit_app 호출 후)에 설치 프로그램을
            # 돌리고, 설치가 끝나면 잠금 파일을 지우고 새 버전을 자동으로 다시 실행하는
            # 헬퍼. 지금 프로세스와 완전히 분리된(detached) 별도 프로세스로 띄워야
            # 잇다가 종료돼도 이 헬퍼는 안 죽고 계속 진행된다.
            # /VERYSILENT(완전 무음) 대신 /SILENT를 써서 - 사용자 입력은 필요 없지만
            # 작은 진행 표시줄은 보이게 해서 "지금 뭔가 되고 있다"는 걸 알 수 있게 한다.
            ps_script = (
                f'"[$([DateTime]::Now)] 업데이트 시작, 2초 대기" | Out-File -FilePath "{log_path}" -Append -Encoding utf8; '
                f'Start-Sleep -Seconds 2; '
                f'"[$([DateTime]::Now)] 설치 프로그램 실행: {installer_path}" | Out-File -FilePath "{log_path}" -Append -Encoding utf8; '
                f'Start-Process -FilePath "{installer_path}" '
                f'-ArgumentList "/SILENT /SUPPRESSMSGBOXES /NORESTART /SP-" -Wait; '
                f'"[$([DateTime]::Now)] 설치 완료, 잠금 해제 후 재시작" | Out-File -FilePath "{log_path}" -Append -Encoding utf8; '
                f'Remove-Item -Path "{lock_path}" -Force -ErrorAction SilentlyContinue; '
                f'Start-Process -FilePath "{exe_path}"'
            )
            creationflags = (
                getattr(subprocess, "DETACHED_PROCESS", 0)
                | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                # 이게 없으면, 잇다 프로세스가 Windows Job Object에 묶여있는 경우
                # (드물지 않음) 잇다가 종료될 때 "분리시켜서" 띄워둔 이 헬퍼까지
                # 같이 강제 종료돼버릴 수 있다 - 그래서 업데이트 설치 도중에 헬퍼가
                # 사라져서 앱이 다시 안 켜지는 문제로 이어졌던 것으로 보인다.
                # 이 플래그는 부모의 Job에서 확실히 떨어져 나가게 만든다.
                | getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0)
            )
            subprocess.Popen(
                ["powershell.exe", "-WindowStyle", "Hidden", "-Command", ps_script],
                creationflags=creationflags,
            )
        except Exception as e:
            return {"ok": False, "error": f"업데이트 준비 실패: {e}"}

        self._download_progress["done"] = True
        return {"ok": True}

    def quit_app(self):
        """download_and_install_update()가 성공한 뒤 JS가 호출 - 트레이/창/Flask까지
        전부 종료시켜서, 백그라운드에 준비해둔 설치 헬퍼가 안전하게 파일을 교체할 수
        있게 한다 (잇다.exe가 실행 중이면 파일이 잠겨서 설치가 실패하므로)."""
        try:
            if self._tray_icon is not None:
                self._tray_icon.stop()
        except Exception:
            pass
        try:
            if self.main_window is not None:
                self.main_window.destroy()
        except Exception:
            pass
        os._exit(0)

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
            frameless=True, on_top=True, resizable=True, easy_drag=False,
            background_color="#F8F7FC",
            js_api=self,  # 위젯 창 안의 버튼들이 여기 메서드를 호출할 수 있도록
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

    def get_widget_position(self):
        """드래그 시작 시점의 창 위치를 알려준다 (커스텀 드래그 계산용)."""
        if self._widget_window is not None:
            try:
                return [self._widget_window.x, self._widget_window.y]
            except Exception:
                pass
        return [0, 0]

    def move_widget(self, x, y):
        """헤더를 드래그할 때 마우스가 움직인 만큼 정확히 창을 옮긴다.
        pywebview 기본 제공 드래그(easy_drag)가 마우스 포인터랑 창 사이에
        거리가 벌어지는 문제가 있어서, 직접 델타를 계산해 이동시키는 방식으로 교체함."""
        if self._widget_window is not None:
            try:
                self._widget_window.move(int(x), int(y))
            except Exception:
                pass
        return "ok"

    def resize_widget(self, width, height):
        """포스트잇 위젯은 frameless(테두리 없음) 창이라 OS가 기본 제공하는 크기조절
        모서리가 안 보인다 - 그래서 화면 안에 직접 만든 크기조절 손잡이가 이 메서드를
        호출해서 크기를 조절한다."""
        if self._widget_window is not None:
            try:
                width = max(200, int(width))
                height = max(150, int(height))
                self._widget_window.resize(width, height)
            except Exception:
                pass
        return "ok"


def _update_lock_path(base_dir: str) -> str:
    return os.path.join(base_dir, ".update_in_progress")


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


def _setup_tray(window, base_dir: str, api: "Api") -> bool:
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
    api._tray_icon = tray_icon

    # pystray.Icon.run()도 자체 이벤트 루프라 블로킹됨 - webview.start()와 별도 스레드로 분리
    tray_thread = threading.Thread(target=tray_icon.run, daemon=True)
    tray_thread.start()

    def on_closing():
        window.hide()
        return False  # False를 반환해야 실제 창 파괴(destroy)를 막고 숨기기만 함

    window.events.closing += on_closing
    return True


def _wait_for_flask_ready(port: int, timeout: float = 15.0):
    """고정 시간만 자고 넘어가는 대신, 실제로 Flask가 요청에 응답하는지 짧은 간격으로
    확인하면서 기다린다. 창을 너무 일찍 띄우면 서버가 아직 준비 안 된 상태라 첫 클릭이
    "응답없음"으로 보이는 문제가 있었어서, 이제 실제 준비 완료를 확인하고 넘어간다."""
    import urllib.request

    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/add", timeout=1.0)
            return True
        except Exception:
            time.sleep(0.2)
    print(f"안내: {timeout}초 동안 Flask 준비 확인을 못 했지만, 일단 창을 띄웁니다.", file=sys.stderr)
    return False


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


def _maybe_check_update_on_start(base_dir: str, port: int):
    """"시작 시 자동으로 업데이트 확인" 설정이 켜져있으면, 창이 뜨고 나서 잠깐 뒤에
    백그라운드에서 조용히 한 번 확인한다. 실패해도(네트워크 없음 등) 앱 시작에는
    전혀 영향 안 주도록 전부 조용히 무시한다."""
    time.sleep(2.0)  # Flask/창이 완전히 안정된 뒤에 시도
    config_path = os.path.join(base_dir, "itda_config.json")
    if not os.path.exists(config_path):
        return
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        if not cfg.get("auto_check_update", True):
            return
        repo = (cfg.get("update_repo") or "").strip()
        if not repo:
            return

        import urllib.request
        import json as _json
        body = _json.dumps({"repo": repo}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/settings/check_update", data=body,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass  # 조용히 실패 - 시작 시 자동 확인은 "되면 좋고" 기능이라 앱 실행을 막으면 안 됨


def _show_update_waiting_window():
    """설치 헬퍼가 아직 돌고 있는 도중에 사용자가 급하게 앱을 다시 실행했을 때,
    혼란스러운 "응답없음" 대신 명확한 안내 화면을 보여준다."""
    import webview
    html = """
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:'Malgun Gothic','맑은 고딕',sans-serif;display:flex;align-items:center;
                  justify-content:center;height:100vh;margin:0;background:#F8F7FC;color:#34324A;">
      <div style="text-align:center;">
        <div style="font-size:34px;margin-bottom:10px;">⏳</div>
        <h2 style="margin:0 0 8px;font-size:16px;">업데이트 설치 중입니다</h2>
        <p style="color:#9691AB;font-size:12.5px;line-height:1.6;">
          잠시 후 자동으로 새 버전이 실행돼요.<br>이 창은 그냥 닫으셔도 괜찮아요.</p>
      </div>
    </body></html>
    """
    webview.create_window("잇다 - 업데이트 중", html=html, width=380, height=240, resizable=False)
    webview.start()


def main():
    port = 5050
    base_dir = _base_dir()

    lock_path = _update_lock_path(base_dir)
    if os.path.exists(lock_path):
        # 잠금 파일이 2분 넘게 안 지워졌으면 예전 업데이트 시도가 실패해서 못 지운
        # 걸로 보고 무시한다 (안 그러면 앱이 영영 안 켜지는 상황이 생길 수 있음).
        try:
            age_sec = time.time() - os.path.getmtime(lock_path)
        except Exception:
            age_sec = 9999
        if age_sec < 120:
            print("업데이트 설치가 진행 중인 것 같아 대기 화면만 보여주고 종료합니다.")
            _show_update_waiting_window()
            return
        else:
            print("2분 넘게 안 지워진 업데이트 잠금 파일을 무시하고 정상 실행합니다.")
            try:
                os.remove(lock_path)
            except Exception:
                pass

    if _try_focus_existing_instance(port):
        print("잇다가 이미 실행 중이라 기존 창을 그대로 사용합니다 (새 인스턴스는 띄우지 않음).")
        return

    print(f"잇다 시작 중... (기준 폴더: {base_dir})")

    flask_thread = threading.Thread(target=_run_flask, args=(base_dir, port), daemon=True)
    flask_thread.start()

    # Flask가 실제로 요청을 받을 준비가 될 때까지 대기. 예전엔 무조건 1초만 자고
    # 넘어갔는데, 컴퓨터가 느리거나 첫 DB 마이그레이션이 오래 걸리면 1초로는 부족해서
    # 창이 뜨자마자 첫 클릭이 "응답없음"으로 보이는 문제가 있었음 - 이제 실제로
    # 서버가 응답하는지 직접 확인하면서 최대 15초까지 기다린다.
    _wait_for_flask_ready(port, timeout=15.0)

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
    api.main_window = window  # quit_app()이 나중에 이 창을 종료시킬 수 있도록
    _shared_state["window"] = window  # _run_flask 안의 /__focus_window 라우트가 읽어감

    if _tray_enabled(base_dir):
        tray_ok = _setup_tray(window, base_dir, api)
        if tray_ok:
            print("트레이 아이콘 활성화됨 - 창을 닫아도 작업표시줄에서 계속 실행됩니다. "
                  "완전히 끄려면 트레이 아이콘 우클릭 > 종료를 눌러주세요.")

    # "시작 시 업데이트 확인" 설정이 켜져있으면, 창이 뜬 뒤 백그라운드에서 조용히
    # 한 번 확인한다 (실패해도 앱 시작 자체에는 영향 없게 별도 스레드+예외 처리).
    threading.Thread(target=_maybe_check_update_on_start, args=(base_dir, port), daemon=True).start()

    webview.start()


if __name__ == "__main__":
    main()
