"""
Chat model factory for the Python agents.

Priority: Lovable AI Gateway (keeps billing/BYO-provider in one place with
the TS app) -> direct OpenAI -> direct Anthropic -> direct Google Gemini.
Only implemented the branches that have a configured key; add others the
same way if you set OPENAI_API_KEY / ANTHROPIC_API_KEY later.
"""
from __future__ import annotations

from langchain_core.language_models.chat_models import BaseChatModel

from app.core.config import get_settings


def get_chat_model(model_name: str | None = None) -> BaseChatModel:
    settings = get_settings()

    if settings.lovable_api_key:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model_name or settings.default_model,
            api_key=settings.lovable_api_key,
            base_url=settings.lovable_gateway_base_url,
            default_headers={"Lovable-API-Key": settings.lovable_api_key},
        )

    if settings.openrouter_api_key:
        from langchain_openai import ChatOpenAI

        # OpenRouter is OpenAI-compatible. Default to a Gemini model over
        # OpenRouter since that's the key that's configured; override with
        # DEFAULT_MODEL if you want a different OpenRouter model id.
        return ChatOpenAI(
            model=model_name or "google/gemini-2.5-flash",
            api_key=settings.openrouter_api_key,
            base_url=settings.openrouter_base_url,
        )

    if settings.google_api_key and not settings.openrouter_api_key:
        from langchain_google_genai import ChatGoogleGenerativeAI

        model = (model_name or settings.default_model).removeprefix("google/")
        return ChatGoogleGenerativeAI(model=model, google_api_key=settings.google_api_key)

    if settings.openai_api_key:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=model_name or settings.default_model, api_key=settings.openai_api_key)

    if settings.anthropic_api_key:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=model_name or settings.default_model, api_key=settings.anthropic_api_key)

    if settings.google_api_key:
        from langchain_google_genai import ChatGoogleGenerativeAI

        # Gemini model names don't take a "google/" prefix the way the
        # Lovable gateway's do — strip one if it's there so DEFAULT_MODEL
        # can stay consistent-looking with the TS side's model strings.
        model = (model_name or settings.default_model).removeprefix("google/")
        return ChatGoogleGenerativeAI(model=model, google_api_key=settings.google_api_key)

    raise RuntimeError(
        "No model provider configured. Set LOVABLE_API_KEY, OPENAI_API_KEY, "
        "ANTHROPIC_API_KEY, or GOOGLE_API_KEY in python-service/.env."
    )
