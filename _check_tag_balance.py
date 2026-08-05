"""HTML 태그가 안 닫혀서 페이지 전체가 의도치 않은 링크/구조에 갇히는 버그를
잡아내기 위한 검증 스크립트. 파이썬 표준 html.parser로 태그 스택을 추적해서
불균형이 있으면 알려준다."""
import os
import sys
import sqlite3
from html.parser import HTMLParser

sys.path.insert(0, '.')
import itda_review_app as m

VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
             "link", "meta", "param", "source", "track", "wbr"}


class TagBalanceChecker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        pass  # <tag ... /> 자기종결은 스택에 안 쌓음

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            return
        if not self.stack:
            self.errors.append(f"</{tag}> 짝이 되는 여는 태그가 없음 (스택이 비어있음)")
            return
        if self.stack[-1] == tag:
            self.stack.pop()
        else:
            # 가장 가까운 열린 태그와 이름이 다름 - 잘못 닫혔거나 순서가 꼬임
            if tag in self.stack:
                # 스택 어딘가엔 있다 -> 그 사이의 태그들이 안 닫힌 채 스킵됨
                idx = len(self.stack) - 1 - self.stack[::-1].index(tag)
                skipped = self.stack[idx + 1:]
                self.errors.append(
                    f"</{tag}> 나왔는데 그 사이에 안 닫힌 태그들: {skipped}"
                )
                self.stack = self.stack[:idx]
            else:
                self.errors.append(f"</{tag}> 인데 이 이름의 여는 태그가 스택에 없음")


def check_page(name, html):
    checker = TagBalanceChecker()
    checker.feed(html)
    if checker.errors:
        print(f"[FAIL] {name}")
        for e in checker.errors:
            print("   -", e)
        return False
    elif checker.stack:
        print(f"[FAIL] {name} - 안 닫힌 태그 남음: {checker.stack}")
        return False
    else:
        print(f"[OK]   {name} - 태그 균형 정상")
        return True


if os.path.exists('test_tagcheck.db'):
    os.remove('test_tagcheck.db')
sqlite3.connect('test_tagcheck.db').close()
m.DB_PATH = 'test_tagcheck.db'
m.CONFIG_PATH = 'test_tagcheck_config.json'
m.init_db_schema()
client = m.app.test_client()

all_ok = True
pages = ['/', '/review', '/add', '/analyze', '/settings', '/list', '/postit', '/postit/widget']
for path in pages:
    r = client.get(path)
    ok = check_page(path, r.get_data(as_text=True))
    all_ok = all_ok and ok

os.remove('test_tagcheck.db')
if os.path.exists('test_tagcheck_config.json'):
    os.remove('test_tagcheck_config.json')

print()
if all_ok:
    print("=== 전체 페이지 태그 균형 정상! ===")
else:
    print("=== 문제 있는 페이지 있음, 위 내용 확인 필요 ===")
    sys.exit(1)
