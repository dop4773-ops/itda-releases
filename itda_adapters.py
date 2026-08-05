"""
잇다 (Itda) - MessageSource 어댑터
서로 다른 메신저의 DB 스키마를 공통 인터페이스로 추상화한다.

핵심 구분:
- fetch_structured_events(): 이미 정형 데이터로 존재하는 이벤트 (규칙엔진 불필요, 바로 category 확정)
  예) MiraeLanMessenger의 outing_schedules(외박/외출), ward_transfers(전동), notices(공지)
- fetch_free_text_messages(): 자유 텍스트 대화. 규칙엔진(1단계) -> ML(2단계) -> LLM(3단계) 파이프라인 대상
  예) IP Messenger의 msg_tbl 전체, MiraeLanMessenger의 messages
"""
from abc import ABC, abstractmethod
from datetime import datetime, timezone
import sqlite3


class MessageSource(ABC):
    source_name: str

    @abstractmethod
    def fetch_structured_events(self) -> list[dict]:
        """반환 각 dict: event_id, category, event_subtype, sender, sender_dept, content, created_utc"""
        raise NotImplementedError

    @abstractmethod
    def fetch_free_text_messages(self) -> list[dict]:
        """반환 각 dict: event_id, body, sender, sender_dept, created_utc"""
        raise NotImplementedError


# ------------------------------------------------------------
# IP Messenger 어댑터
# ------------------------------------------------------------
class IPMessengerAdapter(MessageSource):
    source_name = "ipmsg"

    def __init__(self, db_path: str):
        self.db_path = db_path

    def fetch_structured_events(self) -> list[dict]:
        # IP Messenger는 정형 이벤트 테이블이 없음 - 전부 자유 텍스트
        return []

    def fetch_free_text_messages(self) -> list[dict]:
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("""
            SELECT m.msg_id, m.body, m.packet_no, s.nick, s.gname
            FROM msg_tbl m
            LEFT JOIN msghost_tbl ms ON m.msg_id = ms.msg_id AND ms.idx = 0
            LEFT JOIN host_tbl s ON ms.host_id = s.host_id
            ORDER BY m.msg_id ASC
        """)
        rows = cur.fetchall()
        conn.close()

        results = []
        for msg_id, body, packet_no, sender, sender_dept in rows:
            created_utc = (
                datetime.fromtimestamp(packet_no, timezone.utc).isoformat()
                if packet_no else None
            )
            results.append({
                "event_id": str(msg_id),
                "body": body,
                "sender": sender,
                "sender_dept": sender_dept,
                "created_utc": created_utc,
            })
        return results


# ------------------------------------------------------------
# MiraeLanMessenger 어댑터
# ------------------------------------------------------------
class MiraeLanAdapter(MessageSource):
    source_name = "miraelan"

    def __init__(self, db_path: str):
        self.db_path = db_path

    def fetch_structured_events(self) -> list[dict]:
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        events = []

        # 외박/외출/외진 -> calendar (is_deleted=0만)
        cur.execute("""
            SELECT schedule_id, schedule_date, patient_name, ward, room, category, reason,
                   departure_time, return_time, author_name, created_utc
            FROM outing_schedules WHERE is_deleted = 0
        """)
        for sid, sdate, pname, ward, room, category, reason, dep, ret, author, created in cur.fetchall():
            content = f"{pname} ({ward} {room}호) {category}"
            if reason:
                content += f" - {reason}"
            time_part = f"{dep}~{ret}".strip("~")
            content += f" | {sdate} {time_part}".rstrip()
            events.append({
                "event_id": sid,
                "category": "calendar",
                "event_subtype": f"외박_외출({category})",
                "sender": author,
                "sender_dept": None,
                "content": content,
                "created_utc": created,
            })

        # 병동 이동 -> calendar (is_deleted=0만)
        cur.execute("""
            SELECT transfer_id, transfer_date, transfer_time, patient_name,
                   from_ward, from_room, to_ward, to_room, note, author_name, created_utc
            FROM ward_transfers WHERE is_deleted = 0
        """)
        for tid, tdate, ttime, pname, fw, fr, tw, tr, note, author, created in cur.fetchall():
            content = f"{pname} {fw}{fr}호 -> {tw}{tr}호 전동 ({tdate} {ttime})"
            if note:
                content += f" - {note}"
            events.append({
                "event_id": tid,
                "category": "calendar",
                "event_subtype": "전동_전원",
                "sender": author,
                "sender_dept": None,
                "content": content,
                "created_utc": created,
            })

        # 공지 -> notice (is_deleted=0만)
        cur.execute("""
            SELECT notice_id, title, body, author_name, author_department, created_utc
            FROM notices WHERE is_deleted = 0
        """)
        for nid, title, body, author, dept, created in cur.fetchall():
            content = f"[{title}] {body}"
            events.append({
                "event_id": nid,
                "category": "notice",
                "event_subtype": None,
                "sender": author,
                "sender_dept": dept,
                "content": content,
                "created_utc": created,
            })

        conn.close()
        return events

    def fetch_free_text_messages(self) -> list[dict]:
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("""
            SELECT m.message_id, m.body, m.sender_name, p.department, m.created_utc
            FROM messages m
            LEFT JOIN peers p ON m.sender_id = p.user_id
            ORDER BY m.created_utc ASC
        """)
        rows = cur.fetchall()
        conn.close()

        results = []
        for mid, body, sender, dept, created in rows:
            results.append({
                "event_id": mid,
                "body": body,
                "sender": sender,
                "sender_dept": dept,
                "created_utc": created,
            })
        return results
