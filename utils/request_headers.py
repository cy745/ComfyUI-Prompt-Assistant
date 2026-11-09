"""
请求头构建与错误体解析（纯逻辑模块）

本模块 **不依赖 ComfyUI**（不导入 folder_paths / server / torch 等），
因此可以被单独 import 并用普通 Python 做单元测试。

内容：
1. build_request_headers()     —— 统一构建 OpenAI 兼容请求头
   - Content-Type
   - Authorization（有 api_key 时）
   - 自报身份的 User-Agent（避免被服务端按 httpx 默认 UA 拦截）
   - OpenCode 专有头 x-opencode-session（host 为 opencode.ai 时自动注入）
   - 服务配置里的 custom_headers（过滤非法头名/头值）
2. parse_error_body() / classify_http_error() —— 解析并归类 HTTP 错误体
   - OpenCode 400: {"type":"error","error":{"type":"MissingSessionID","message":...}}
   - OpenCode 401: {"error":{"type":"authentication_error","code":"api_key_expired",...}}
   - 只有"疑似参数不兼容"的 400 才允许降级重试

参考文档: https://opencode.ai/v2/docs/console/go/
  - 客户端需发送稳定 session ID 到 x-opencode-session
  - 使用自报身份的 User-Agent
  - Go 的 OpenAI 兼容 base: https://opencode.ai/inference/go/openai/v1
"""

import json
import os
import re
import uuid
from typing import Any, Dict, Iterable, Mapping, Optional
from urllib.parse import urlsplit

# --- 常量 ---
PLUGIN_NAME = "ComfyUI-Prompt-Assistant"
# pyproject.toml 读取失败时的兜底版本号（仅兜底用）
_FALLBACK_VERSION = "2.0.6"

CONTENT_TYPE_JSON = "application/json"
OPENCODE_HOST = "opencode.ai"
OPENCODE_HOST_SUFFIX = ".opencode.ai"
OPENCODE_SESSION_HEADER = "x-opencode-session"

# 禁止被 custom_headers 覆盖的敏感头（除非调用方显式允许）
PROTECTED_HEADERS = frozenset({"authorization", "content-type"})

# 进程内稳定的 OpenCode session ID（模块级只生成一次）
_PROCESS_SESSION_ID = uuid.uuid4()

# 版本号缓存
_plugin_version = ""


# ==================== 版本号 / UA ====================

def _read_plugin_version() -> str:
    """从插件根目录的 pyproject.toml 读取版本号（带缓存，失败回退常量）"""
    global _plugin_version
    if _plugin_version:
        return _plugin_version

    try:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        toml_path = os.path.join(root, "pyproject.toml")
        with open(toml_path, "r", encoding="utf-8") as f:
            content = f.read()
        match = re.search(r'^\s*version\s*=\s*"([^"]+)"', content, re.MULTILINE)
        if match:
            _plugin_version = match.group(1).strip()
    except Exception:
        pass

    if not _plugin_version:
        _plugin_version = _FALLBACK_VERSION
    return _plugin_version


def get_user_agent() -> str:
    """构造自报身份的 User-Agent，例如 ComfyUI-Prompt-Assistant/2.0.6"""
    return f"{PLUGIN_NAME}/{_read_plugin_version()}"


def get_process_session_id() -> str:
    """获取进程内稳定的 session ID（同一进程多次请求保持一致）"""
    return str(_PROCESS_SESSION_ID)


# ==================== host 判断 ====================

def extract_host(url: str) -> str:
    """
    从 URL（或裸露的 host[:port]）中提取小写 host

    例:
        'https://opencode.ai/zen/go/v1' -> 'opencode.ai'
        'opencode.ai:443'              -> 'opencode.ai'
        ''                             -> ''
    """
    if not isinstance(url, str) or not url.strip():
        return ""

    text = url.strip()
    if "://" not in text:
        # urlsplit 需要 netloc 标记才能正确解析，补一个协议头
        text = "//" + text.lstrip("/")

    try:
        hostname = urlsplit(text).hostname or ""
    except ValueError:
        return ""

    return hostname.strip().lower().rstrip(".")


def is_opencode_host(host: str) -> bool:
    """判断 host 是否为 opencode.ai 或其子域名"""
    if not isinstance(host, str):
        return False
    host = host.strip().lower().rstrip(".")
    if not host:
        return False
    return host == OPENCODE_HOST or host.endswith(OPENCODE_HOST_SUFFIX)


def url_targets_opencode(base_url: str) -> bool:
    """判断 base_url 是否指向 opencode.ai"""
    return is_opencode_host(extract_host(base_url))


# ==================== 请求头校验 / 清洗 ====================

# RFC7230 token 允许的字符集合
_TOKEN_CHARS = frozenset(
    "!#$%&'*+-.^_`|~"
    "0123456789"
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
)

# 需要剔除的控制字符（含 CR / LF / TAB / DEL）
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def is_valid_header_name(name: Any) -> bool:
    """校验 header 名是否符合 RFC7230 token 规则（只允许 token 字符）"""
    if not isinstance(name, str):
        return False
    if not name or len(name) > 128:
        return False
    return all(ch in _TOKEN_CHARS for ch in name)


def sanitize_header_value(value: Any) -> Optional[str]:
    """
    清洗 header 值：

    - 非字符串的标量（int/float/bool）转为字符串
    - 剔除 CR / LF / TAB 等控制字符（防止头注入）
    - 剔除无法按 latin-1 编码的字符（httpx 发送非 latin-1 会抛 UnicodeEncodeError）
    - 两端去空白

    返回 None 表示该头应被丢弃（空值 / 无法表示的类型）
    """
    if value is None:
        return None
    if isinstance(value, bool):
        value = "true" if value else "false"
    elif isinstance(value, (int, float)):
        value = str(value)
    elif not isinstance(value, str):
        # dict / list 等复杂类型不发送
        return None

    cleaned = _CONTROL_CHARS.sub("", value)
    cleaned = "".join(ch for ch in cleaned if 0x20 <= ord(ch) <= 0x7E or 0xA0 <= ord(ch) <= 0xFF)
    cleaned = cleaned.strip()
    return cleaned or None


def _normalize_session_id(value: Any) -> str:
    """规范化服务配置里的 opencode_session_id"""
    if not isinstance(value, str):
        return ""
    return sanitize_header_value(value) or ""


# ==================== 请求头构建 ====================

def build_request_headers(
    base_url: str = "",
    api_key: Optional[str] = None,
    extra_headers: Optional[Mapping[str, Any]] = None,
    session_id: Optional[str] = None,
    allow_override: bool = False,
) -> Dict[str, str]:
    """
    构建 OpenAI 兼容请求头

    参数:
        base_url: 服务地址（用于识别 opencode.ai 域名）
        api_key: API Key（为空则不发送 Authorization）
        extra_headers: 服务配置里的 custom_headers（会被过滤）
        session_id: 服务配置里的 opencode_session_id（覆盖进程级 UUID）
        allow_override: 是否允许 custom_headers 覆盖 Authorization / Content-Type

    返回:
        Dict[str, str]: 可直接交给 httpx 的请求头
    """
    headers: Dict[str, str] = {"Content-Type": CONTENT_TYPE_JSON}

    key = api_key.strip() if isinstance(api_key, str) else ""
    if key:
        headers["Authorization"] = f"Bearer {key}"

    # 始终自报身份，避免使用 httpx 默认 UA 被服务端拦截
    headers["User-Agent"] = get_user_agent()

    # OpenCode 要求稳定的 session ID 才能高效路由
    if url_targets_opencode(base_url):
        headers[OPENCODE_SESSION_HEADER] = _normalize_session_id(session_id) or get_process_session_id()

    # 合并用户自定义请求头
    if isinstance(extra_headers, Mapping):
        for raw_name, raw_value in extra_headers.items():
            if not is_valid_header_name(raw_name):
                continue

            name = raw_name.strip()
            if not allow_override and name.lower() in PROTECTED_HEADERS:
                continue

            value = sanitize_header_value(raw_value)
            if value is None:
                continue

            # 同名（大小写不同）时先删除旧键，避免重复头
            for existing in [k for k in headers if k.lower() == name.lower()]:
                headers.pop(existing, None)
            headers[name] = value

    return headers


# ==================== 错误体解析 ====================

def _as_text(value: Any) -> str:
    """把错误体字段安全转成字符串"""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    return ""


def _extract_detail_message(detail: Any) -> str:
    """compat: FastAPI 风格 detail=[{loc, msg}] 拼接成一句"""
    if isinstance(detail, str):
        return detail.strip()
    if isinstance(detail, list):
        parts = []
        for item in detail:
            if isinstance(item, dict):
                msg = _as_text(item.get("msg")) or _as_text(item.get("message"))
                if msg:
                    parts.append(msg)
            elif isinstance(item, str) and item.strip():
                parts.append(item.strip())
        return "; ".join(parts)
    if isinstance(detail, dict):
        return _as_text(detail.get("message")) or _as_text(detail.get("msg"))
    return ""


def parse_error_body(body: Any) -> Dict[str, Any]:
    """
    解析 OpenAI 兼容错误体

    返回:
        {
          "message": 面向用户的错误消息（解析不出时回退原始响应前 200 字）,
          "code":    错误码（如 api_key_expired）/ 类型（如 MissingSessionID）,
          "type":    错误类型（如 authentication_error）,
          "raw":     原始响应文本（截断）,
          "is_json": 响应体是否为 JSON
        }
    """
    if isinstance(body, (bytes, bytearray)):
        raw = bytes(body).decode("utf-8", errors="ignore")
    elif isinstance(body, str):
        raw = body
    elif body is None:
        raw = ""
    else:
        raw = str(body)

    raw = raw.strip()
    result: Dict[str, Any] = {
        "message": "",
        "code": "",
        "type": "",
        "raw": raw[:2000],
        "is_json": False,
    }

    if not raw:
        return result

    try:
        data = json.loads(raw)
    except Exception:
        data = None

    if data is None:
        # 非 JSON 响应（HTML 502、纯文本错误等）：直接回显正文前 200 字
        result["message"] = raw[:200]
        return result

    result["is_json"] = True

    message = ""
    code = ""
    error_type = ""

    if isinstance(data, dict):
        error = data.get("error")

        if isinstance(error, dict):
            message = _as_text(error.get("message")) or _as_text(error.get("msg"))
            code = _as_text(error.get("code"))
            error_type = _as_text(error.get("type"))
            if not message:
                # 少数服务商把详细信息再嵌一层
                inner = error.get("error")
                if isinstance(inner, dict):
                    message = _as_text(inner.get("message"))
        elif isinstance(error, str):
            message = error.strip()
        elif error is not None:
            message = _extract_detail_message(error)

        if not message:
            message = (
                _as_text(data.get("message"))
                or _extract_detail_message(data.get("detail"))
                or _as_text(data.get("msg"))
                or _as_text(data.get("description"))
            )
        if not code:
            code = _as_text(data.get("code"))
        if not error_type:
            error_type = _as_text(data.get("type"))

    if not message and error_type:
        message = error_type
    if not message:
        message = raw[:200]

    result["message"] = message
    result["code"] = code or error_type
    result["type"] = error_type
    return result


# --- 错误归类关键词 ---
# 明确与参数无关（400 时不降级重试）
NON_RETRYABLE_400_KEYWORDS = (
    "missingsessionid", "x-opencode-session", "missing session",
    "authentication", "unauthorized", "api key", "api_key",
    "expired", "forbidden", "permission",
    "invalid model", "model not found", "model_not_found",
    "no such model", "unknown model", "model unavailable",
    "quota", "insufficient", "billing", "balance",
    "rate limit", "too many requests",
    "认证", "无权限", "余额", "配额", "模型不存在",
)

# 疑似参数不兼容（400 时才允许降级重试）
PARAM_RETRYABLE_KEYWORDS = (
    "unsupported", "invalid parameter", "invalid_parameter",
    "invalid_request", "unknown field", "unknown field",
    "unknown parameter", "unknown_parameter",
    "extra inputs", "extra_forbidden", "not supported",
    "unrecognized", "unexpected", "disallowed", "does not support",
    "invalid value", "invalid type",
    "参数", "不支持", "无效", "非法", "未知字段", "多余", "格式错误",
)

# 认证类关键词（沿用 utils/common._is_auth_error 的语义）
AUTH_KEYWORDS = (
    "invalid token", "authorization", "authenticate", "api key", "api_key",
    "unauthorized", "auth failed", "invalid key", "missing key",
    "invalid credentials", "身份验证", "认证失败", "token",
)

# 认证/Key 相关提示
MSG_AUTH_ERROR = "API Key无效或缺失"
MSG_KEY_EXPIRED_OPENCODE = (
    "API Key 已过期：请在 OpenCode Console 重新创建 API Key 并替换"
    "（https://opencode.ai/console）"
)
MSG_KEY_EXPIRED_GENERIC = "API Key 已过期：请到服务商控制台重新创建 API Key 并替换"
MSG_MISSING_SESSION = (
    "服务端要求 x-opencode-session 请求头（请求未携带或未被转发）。"
    "请确认插件已更新，并检查代理/网关是否丢弃自定义请求头"
)


def _contains_any(text: str, keywords: Iterable[str]) -> bool:
    return any(kw in text for kw in keywords)


def is_retryable_param_error(error_text: str) -> bool:
    """
    判断一条错误文本是否"疑似参数不兼容"（可用于 HTTP 400 与 SSE 流内错误）

    明显与参数无关（会话头缺失 / 认证 / 模型不存在 等）→ False
    """
    if not isinstance(error_text, str) or not error_text.strip():
        return False

    text = error_text.lower()
    if _contains_any(text, NON_RETRYABLE_400_KEYWORDS):
        return False
    return _contains_any(text, PARAM_RETRYABLE_KEYWORDS)


def classify_http_error(
    status_code: int,
    error_info: Optional[Dict[str, Any]] = None,
    is_opencode: bool = False,
) -> Dict[str, Any]:
    """
    归类 HTTP 错误，返回面向用户的错误消息与是否需要降级重试

    参数:
        status_code: HTTP 状态码
        error_info: parse_error_body() 的返回值
        is_opencode: 当前请求是否发往 opencode.ai

    返回:
        {"error": str, "should_retry": bool, "kind": str}
    """
    info = error_info or {}
    message = info.get("message") or ""
    fields = " ".join(
        str(info.get(key) or "") for key in ("message", "code", "type")
    ).strip()
    lowered = fields.lower()

    # --- 401：区分 Key 过期与其他认证失败 ---
    if status_code == 401:
        if "api_key_expired" in lowered or "expired" in lowered or "已过期" in fields:
            return {
                "error": MSG_KEY_EXPIRED_OPENCODE if is_opencode else MSG_KEY_EXPIRED_GENERIC,
                "should_retry": False,
                "kind": "auth_expired",
            }
        return {"error": MSG_AUTH_ERROR, "should_retry": False, "kind": "auth"}

    # --- 400：只有疑似参数不兼容才允许降级重试 ---
    if status_code == 400:
        if _contains_any(lowered, NON_RETRYABLE_400_KEYWORDS):
            if _contains_any(lowered, ("missingsessionid", "x-opencode-session", "missing session")):
                return {
                    "error": f"{MSG_MISSING_SESSION}（服务端原始信息: {message}）",
                    "should_retry": False,
                    "kind": "missing_session",
                }
            return {
                "error": message or f"HTTP {status_code}",
                "should_retry": False,
                "kind": "fatal_400",
            }

        if _contains_any(lowered, PARAM_RETRYABLE_KEYWORDS):
            return {
                "error": message or f"HTTP {status_code}",
                "should_retry": True,
                "kind": "params",
            }

        # 400 但带认证字样：提示换 Key，且不重试
        if _contains_any(lowered, AUTH_KEYWORDS):
            if "expired" in lowered or "已过期" in fields:
                return {
                    "error": MSG_KEY_EXPIRED_OPENCODE if is_opencode else MSG_KEY_EXPIRED_GENERIC,
                    "should_retry": False,
                    "kind": "auth_expired",
                }
            return {"error": MSG_AUTH_ERROR, "should_retry": False, "kind": "auth"}

        return {
            "error": message or f"HTTP {status_code}",
            "should_retry": False,
            "kind": "unknown_400",
        }

    # --- 其他状态码：保持原有语义（认证类消息统一替换为可读提示）---
    if _contains_any(lowered, AUTH_KEYWORDS):
        if "expired" in lowered or "已过期" in fields:
            return {
                "error": MSG_KEY_EXPIRED_OPENCODE if is_opencode else MSG_KEY_EXPIRED_GENERIC,
                "should_retry": False,
                "kind": "auth_expired",
            }
        return {"error": MSG_AUTH_ERROR, "should_retry": False, "kind": "auth"}

    return {
        "error": message or f"HTTP {status_code}",
        "should_retry": False,
        "kind": "http",
    }
