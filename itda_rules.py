"""
잇다 (Itda) - 1단계 규칙 기반 Event Engine
IP Messenger 실제 로그 31,630건 분석 기반 (v2)
"""
import re

# ---------- 전처리 ----------
def preprocess(body: str) -> str:
    if not body:
        return ""
    lines = body.split('\n')
    lines = [l for l in lines if not l.strip().startswith('>')]
    text = '\n'.join(lines)
    text = re.sub(r'（?\(?IPMsg Delayed Send:.*?\)）?', '', text)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)
    text = text.translate(str.maketrans('．，？！～：', '.,?!~:'))
    text = re.sub(r'\s+', ' ', text).strip()
    return text

NOTICE_KEYWORDS = ['공지', '안내드립니다', '알려드립니다', '협조해 주시', '담당하게 되어']

CALENDAR_SUBTYPES = {
    '외박_외출': ['외박', '외출'],
    '전동_전원': ['전동', '전원'],
    '외진_검사': ['외진', 'CT', 'MRI', 'X-ray', '방사선', '예약'],
    '회의': ['회의', '미팅'],
    '퇴원': ['퇴원'],
}
DATE_TIME_PATTERNS = [
    r'\d{1,2}\s*(/|\.)\s*\d{1,2}',
    r'\d{1,2}\s*(시|:|A|P|AM|PM|am|pm)',
    r'(오전|오후|금일|내일|모레|토요일|일요일)',
]

TODO_KEYWORDS = ['부탁드립니다', '요청드립니다', '확인 부탁', '제출', '작성', '증량', '감량',
                  '재평가', 'HOLD', 'hold', '오더 변경', '스케줄 조정', '전환 부탁']
TODO_PATTERNS = [
    r'(해주세요|해주십시오|바랍니다|주시기 바랍니다|부탁드립니다)\s*[.!~]*$',
    r'(부탁|요청|확인).{0,5}(드립니다|드려요|합니다)',
    r'(가능할까요|될까요|괜찮을까요|어떨까요|어떻게할까요|해도될까요|해도괜찮을까요)\s*\??\s*$',
    r'(까요|나요)\?\s*$',
]

REFERENCE_KEYWORDS = ['거부', 'fever', '어지러', 'bed side']
PATIENT_ROOM_PATTERN = r'\d{3,4}호?\s*[가-힣]{2,4}(님|A|B|C)?'
CLINICAL_TERMS = ['치료', '처방', '증상', '컨디션', '재활', '보행', '운동', '기구', '전기']

SCHEDULE_TOOL_PATTERNS = [
    r'(전체시간표|개인시간표|통합\s*시간표)',
    r'시간표.{0,10}(쓸게요|쓸까요|썼습니다|껐습니다|끄겠습니다|끌게요|완료했습니다|변경사항)',
]

CASUAL_SHORT_PATTERNS = [
    r'^(가능합니다|가능해요|가능하십니다|가겠습니다|알겠습니다|하겠습니다|했습니다|없습니다|맞습니다|아니요|아니에요)[\s!~^.,ㅎㅋㅠ]*$',
    r'^(저희?가?\s*.{0,6}(하겠습니다|할게요|했습니다|드릴게요))[\s!~^.,ㅎㅋㅠ]*$',
    r'^(네|넵|넹|예|응|어)+[\s!~^.,ㅎㅋㅠ]*.{0,10}$',
]


def _has_date_time(text: str) -> bool:
    return any(re.search(p, text) for p in DATE_TIME_PATTERNS)


def _has_todo_pattern(text: str) -> bool:
    if any(kw in text for kw in TODO_KEYWORDS):
        return True
    return any(re.search(p, text) for p in TODO_PATTERNS)


def _is_schedule_tool_chat(text: str) -> bool:
    return any(re.search(p, text) for p in SCHEDULE_TOOL_PATTERNS)


def _is_casual_short(text: str) -> bool:
    if len(text) > 30:
        return False
    return any(re.match(p, text) for p in CASUAL_SHORT_PATTERNS)


def _has_patient_clinical_note(text: str) -> bool:
    return bool(re.search(PATIENT_ROOM_PATTERN, text)) and any(kw in text for kw in CLINICAL_TERMS)


def rule_classify(raw_body: str):
    """
    규칙 기반 분류. 반환: (category, reason, cleaned_text)
    category가 'ambiguous_ai'면 규칙으로 확정 못한 것 -> 2단계(ML)로 이관.
    """
    text = preprocess(raw_body)
    if not text:
        return 'ignore', 'empty', text

    if _is_casual_short(text):
        return 'ignore', 'casual_short_v2', text

    is_todo = _has_todo_pattern(text)

    if any(kw in text for kw in NOTICE_KEYWORDS):
        return 'notice', 'notice_keyword', text

    if _is_schedule_tool_chat(text) and not is_todo:
        return 'schedule_tool', 'schedule_coordination_v2', text

    matched_subtype = None
    for subtype, kws in CALENDAR_SUBTYPES.items():
        if any(kw in text for kw in kws):
            matched_subtype = subtype
            break

    if matched_subtype:
        if is_todo:
            return 'todo', f'todo_over_calendar({matched_subtype})', text
        elif _has_date_time(text):
            return 'calendar', matched_subtype, text
        else:
            return 'ambiguous_ai', f'{matched_subtype}_no_datetime', text

    if is_todo:
        return 'todo', 'todo_keyword_or_question', text

    if any(kw in text for kw in REFERENCE_KEYWORDS):
        return 'reference', 'reference_keyword', text
    if _has_patient_clinical_note(text):
        return 'reference', 'patient_clinical_note_v2', text

    return 'ambiguous_ai', 'no_rule_match', text
