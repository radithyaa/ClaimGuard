"""Root agent investigasi (SRS 3.3): Investigator -> Evaluator -> Drafter.

Kontrak untuk Backend B (investigation_runner):
    root = build_root_agent()
    state = initial_state(...)            # dipakai saat create_session
    Runner(app_name=APP_NAME, agent=root, session_service=InMemorySessionService())
    run_async(..., new_message=START_MESSAGE, run_config=RunConfig(max_llm_calls=20),
              abort_signal=<asyncio.Event untuk FR-20>)
    outcome = persist_outcome(final_session.state)   # app/agents/outcome.py
Event model membawa `custom_metadata["source"]` = "live" | "cache" (FR-21).
"""

from typing import Any

from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.models.base_llm import BaseLlm
from google.genai import types

from app.agents import callbacks as cb
from app.agents.prompts import render
from app.agents.tools.case_tools import get_case_context, get_courier_policy
from app.agents.tools.video_tools import clip_cctv_video
from app.agents.tools.vision_tools import analyze_media
from app.core.config import get_settings
from app.schemas.agent_outputs import ClaimDraft, Evaluation
from app.services import gemini_client

APP_NAME = "claimguard"
START_MESSAGE = types.Content(role="user", parts=[types.Part(text="Mulai investigasi kasus ini.")])
_FACT_KEYS = ("shipment_id", "tracking_number", "courier", "case_type")


def initial_state(
    *, investigation_id: str, shipment_id: str, tracking_number: str, courier: str,
    case_type: str, item_value: int,
) -> dict[str, Any]:
    state: dict[str, Any] = {
        "investigation_id": investigation_id, "shipment_id": shipment_id,
        "tracking_number": tracking_number, "courier": courier, "case_type": case_type,
        "item_value": item_value,
    }
    cb.register_alias(state, shipment_id, "SHIPMENT")
    cb.register_alias(state, investigation_id, "INVESTIGATION")
    return state


def _instruction(name: str):
    # InstructionProvider: hanya nilai tepercaya dari state yang masuk ke instruksi (bukan teks pembeli)
    return lambda ctx: render(name, **{k: ctx.state.get(k, "") for k in _FACT_KEYS})


def build_root_agent(models: dict[str, str | BaseLlm] | None = None) -> SequentialAgent:
    """`models` untuk test: {"investigator": FakeLlm(...), ...}. Default: model Gemini dari config."""
    gemini_client.configure_vertex_env()
    default = get_settings().gemini_model
    m = {"investigator": default, "evaluator": default, "drafter": default, **(models or {})}
    common = dict(disallow_transfer_to_parent=True, disallow_transfer_to_peers=True,
                  **cb.MODEL_CALLBACKS)

    investigator = LlmAgent(
        name="investigator",
        description="Mengumpulkan bukti: konteks kasus, klip CCTV, analisis vision, kebijakan kurir.",
        model=m["investigator"],
        instruction=_instruction("investigator"),
        tools=[get_case_context, clip_cctv_video, analyze_media, get_courier_policy],
        before_tool_callback=cb.before_tool,
        after_tool_callback=cb.after_tool,
        output_key="investigation_notes",
        generate_content_config=types.GenerateContentConfig(temperature=0.2),
        **common,
    )
    evaluator = LlmAgent(
        name="evaluator",
        description="Memutuskan claim / needs_evidence / fraud_suspect beserta alasannya.",
        model=m["evaluator"],
        instruction=_instruction("evaluator"),
        output_schema=Evaluation,
        output_key="evaluation",
        after_agent_callback=cb.enforce_min_confidence,
        generate_content_config=types.GenerateContentConfig(temperature=0.0),
        **common,
    )
    drafter = LlmAgent(
        name="drafter",
        description="Menyusun draf klaim dari fakta di state.",
        model=m["drafter"],
        instruction=_instruction("drafter"),
        output_schema=ClaimDraft,
        output_key="claim_draft",
        before_agent_callback=cb.skip_drafter_unless_claim,
        after_agent_callback=cb.validate_draft,
        generate_content_config=types.GenerateContentConfig(temperature=0.3),
        **common,
    )
    return SequentialAgent(name="investigation_pipeline", sub_agents=[investigator, evaluator, drafter])
