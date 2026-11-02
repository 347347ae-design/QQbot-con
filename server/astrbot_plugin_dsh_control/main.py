"""DSH 群聊参数控制插件：实时读取 qqbot_groups.json（本机或服务器同一套）。"""

from __future__ import annotations

import json
import os
import random
import time

from astrbot import logger
from astrbot.api import star
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context

CONFIG_PATH = os.environ.get("DSH_QQBOT_GROUPS") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "qqbot_groups.json",
)

_cache = {"mtime": 0.0, "groups": {}}
_last_reply: dict[str, float] = {}


def _load_groups() -> dict:
    try:
        mtime = os.path.getmtime(CONFIG_PATH)
        if mtime != _cache["mtime"]:
            with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            groups = payload.get("groups", {}) if isinstance(payload, dict) else {}
            _cache["mtime"] = mtime
            _cache["groups"] = groups if isinstance(groups, dict) else {}
            logger.info("dsh_control: 已加载群规则 %d 个", len(_cache["groups"]))
    except FileNotFoundError:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("dsh_control: 读取配置失败 %s", exc)
    return _cache["groups"]


class Main(star.Star):
    def __init__(self, context: Context):
        super().__init__(context)

    @filter.event_message_type(filter.EventMessageType.GROUP_MESSAGE, priority=40)
    async def control(self, event: AstrMessageEvent):
        try:
            gid = str(event.get_group_id() or "")
            rule = _load_groups().get(gid)
            if not rule:
                return
            mode = rule.get("mode", "at")
            if mode == "off":
                # 完全静默：连 @ 也不回
                event.is_at_or_wake_command = False
                event.is_wake = False
                try:
                    event.should_call_llm(False)
                except Exception:  # noqa: BLE001
                    pass
                try:
                    event.stop_event()
                except Exception:  # noqa: BLE001
                    pass
                return
            if event.is_at_or_wake_command:
                return
            if mode != "freechat":
                return
            text = (event.message_str or "").strip()
            if not text:
                return
            keywords = rule.get("muteKeywords") or []
            if any(k and k in text for k in keywords):
                return
            now = time.time()
            last = _last_reply.get(gid, 0.0)
            mentioned = any(k in text for k in ("烟猫", "爱音"))
            cooldown = float(rule.get("mentionCooldownSec", 300) if mentioned else rule.get("cooldownSec", 900))
            if now - last < cooldown:
                return
            probability = float(rule.get("mentionProbability", 0.85) if mentioned else rule.get("probability", 0.2))
            if random.random() >= probability:
                return
            _last_reply[gid] = now
            event.is_at_or_wake_command = True
            event.is_wake = True
            logger.info("dsh_control: 群 %s 免@触发 (p=%s)", gid, probability)
        except Exception as exc:  # noqa: BLE001
            logger.debug("dsh_control: %s", exc)
