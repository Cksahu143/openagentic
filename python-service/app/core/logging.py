"""
Structured logging, mirroring the intent of src/lib/logger.ts on the TS side:
every module/agent action should be traceable, and logging must never raise.
"""
import logging
import sys
from typing import Any

import structlog


def configure_logging(environment: str = "development") -> None:
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if environment == "development":
        renderer = structlog.dev.ConsoleRenderer()
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[*shared_processors, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(processor=renderer)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


def get_logger(module: str) -> Any:
    """Bound logger tagged with `module`, matching the TS logger's shape
    (module, message, level, metadata)."""
    return structlog.get_logger().bind(module=module)
