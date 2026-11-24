"""Every action the agent can take, with its risk tier and the checks enforced in code before it runs.

The model never decides on its own to run a tool: the pipeline (agent.py) calls tools from deterministic rules,
and every call goes through `authorize`, which enforces the tier's requirements. A tool that isn't listed here
can't run. Adding a write or high-risk tool means adding it here first.

Tiers:
  read            public information: products, help articles, policies
  customer_read   the identified customer's own data: their orders (identity verified by the app, e.g. the
                  WhatsApp sender or a signed-in session; order ownership checked against that identity)
  write           changes something for the customer, only at their explicit request or confirmation
  high_risk       money or account changes: never executed by the AI; the conversation goes to a person
"""
import logging
from dataclasses import dataclass
from typing import Literal

log = logging.getLogger("unocx.tools")

Tier = Literal["read", "customer_read", "write", "high_risk"]


@dataclass(frozen=True)
class Tool:
    name: str
    tier: Tier
    description: str
    needs_identity: bool = False        # a verified customer identity (user.id / phone / email from the app)
    needs_confirmation: bool = False    # the customer asked for it, or said yes to the agent's offer
    ai_may_execute: bool = True         # False: always a handover to a person, whatever the request


REGISTRY: dict[str, Tool] = {t.name: t for t in [
    Tool("search_knowledge", "read", "Search the business's help articles and policies"),
    Tool("search_products", "read", "Search the store's products (chat widget)"),
    Tool("order_status", "customer_read", "Look up the identified customer's own orders", needs_identity=True),
    Tool("show_shipping_address", "customer_read", "Show the shipping address of the identified customer's own order",
         needs_identity=True),
    Tool("raise_complaint", "write", "Raise a complaint for the team about the customer's order",
         needs_identity=True, needs_confirmation=True),
    # Platform rule: refunds and exchanges are approved by people only. Listed so nothing can be wired to run them.
    Tool("refund", "high_risk", "Approve or issue a refund", ai_may_execute=False),
    Tool("exchange", "high_risk", "Approve an exchange", ai_may_execute=False),
    Tool("cancel_order", "high_risk", "Cancel an order", ai_may_execute=False),
    Tool("update_payment", "high_risk", "Change payment details", ai_may_execute=False),
    Tool("update_account", "write", "Change the customer's account details", ai_may_execute=False),
]}


class ToolDenied(Exception):
    """A tool call that isn't allowed; `reason` says why (for logs and flags, not for the customer)."""

    def __init__(self, tool: str, reason: str):
        super().__init__(f"{tool}: {reason}")
        self.tool, self.reason = tool, reason


def authorize(name: str, *, identified: bool = False, confirmed: bool = False) -> Tool:
    """Raises ToolDenied unless the tool may run now."""
    tool = REGISTRY.get(name)
    if tool is None:
        raise ToolDenied(name, "unknown_tool")
    if not tool.ai_may_execute:
        raise ToolDenied(name, "human_only")
    if tool.needs_identity and not identified:
        raise ToolDenied(name, "identity_required")
    if tool.needs_confirmation and not confirmed:
        raise ToolDenied(name, "confirmation_required")
    return tool


def human_only() -> list[str]:
    return [t.name for t in REGISTRY.values() if not t.ai_may_execute]
