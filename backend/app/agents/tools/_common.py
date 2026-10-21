from typing import Any

try:  # ADK mendeteksi parameter `tool_context` dan tidak mengirimnya ke model
    from google.adk.tools import ToolContext
except ImportError:  # unit test tanpa ADK terpasang
    ToolContext = Any  # type: ignore[misc,assignment]


def tool_error(code: str, message: str) -> dict[str, Any]:
    """Error yang terbaca agen, bukan stack trace (SRS 7.1)."""
    return {"status": "error", "error_code": code, "message": message}


def state_value(tool_context: Any, key: str) -> Any:
    if tool_context is None:
        return None
    return tool_context.state.get(key)
