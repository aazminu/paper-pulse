"""
Chat CRUD router — persistent conversations like ChatGPT / Claude.
"""
import json
from uuid import UUID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.services.openai_service import generate_chat_title

router = APIRouter(prefix="/chats", tags=["Chats"])


# ── Request / response helpers ────────────────────────────────────────────
class CreateChatRequest(BaseModel):
    user_id: str

class SaveMessageRequest(BaseModel):
    role: str  # "user" | "ai"
    content: str = ""
    sources: list = []
    attachments: list = []

class UpdateChatRequest(BaseModel):
    title: str | None = None
    starred: bool | None = None


# ── LIST chats ────────────────────────────────────────────────────────────
@router.get("/")
def list_chats(user_id: str):
    """Return all chats for a user, starred first, then by most recent."""
    try:
        resp = (
            supabase.table("chats")
            .select("*")
            .eq("user_id", user_id)
            .order("starred", desc=True)
            .order("updated_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── CREATE chat ───────────────────────────────────────────────────────────
@router.post("/")
def create_chat(req: CreateChatRequest):
    """Create a new empty chat and return it."""
    try:
        resp = (
            supabase.table("chats")
            .insert({"user_id": req.user_id, "title": "New Chat"})
            .execute()
        )
        return resp.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── GET single chat with messages ─────────────────────────────────────────
@router.get("/{chat_id}")
def get_chat(chat_id: UUID):
    """Return a chat and all its messages ordered chronologically."""
    try:
        chat_resp = (
            supabase.table("chats")
            .select("*")
            .eq("id", str(chat_id))
            .execute()
        )
        if not chat_resp.data:
            raise HTTPException(status_code=404, detail="Chat not found")

        messages_resp = (
            supabase.table("chat_messages")
            .select("*")
            .eq("chat_id", str(chat_id))
            .order("created_at", desc=False)
            .execute()
        )

        chat = chat_resp.data[0]
        chat["messages"] = messages_resp.data or []
        return chat
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── UPDATE chat (title / starred) ────────────────────────────────────────
@router.patch("/{chat_id}")
def update_chat(chat_id: UUID, req: UpdateChatRequest):
    """Update chat title and/or starred status."""
    try:
        updates = {}
        if req.title is not None:
            updates["title"] = req.title
        if req.starred is not None:
            updates["starred"] = req.starred
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")

        resp = (
            supabase.table("chats")
            .update(updates)
            .eq("id", str(chat_id))
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Chat not found")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── DELETE chat ───────────────────────────────────────────────────────────
@router.delete("/{chat_id}")
def delete_chat(chat_id: UUID):
    """Delete a chat and cascade-delete all its messages."""
    try:
        resp = (
            supabase.table("chats")
            .delete()
            .eq("id", str(chat_id))
            .execute()
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── ADD message to chat ──────────────────────────────────────────────────
@router.post("/{chat_id}/messages")
def add_message(chat_id: UUID, req: SaveMessageRequest):
    """Save a message to an existing chat. Auto-generates title on the first user message."""
    try:
        # Save the message
        msg_data = {
            "chat_id": str(chat_id),
            "role": req.role,
            "content": req.content,
            "sources": json.dumps(req.sources) if req.sources else "[]",
            "attachments": json.dumps(req.attachments) if req.attachments else "[]",
        }
        msg_resp = (
            supabase.table("chat_messages")
            .insert(msg_data)
            .execute()
        )

        # Auto-generate title after first user message
        if req.role == "user" and req.content:
            chat_resp = (
                supabase.table("chats")
                .select("title")
                .eq("id", str(chat_id))
                .execute()
            )
            if chat_resp.data and chat_resp.data[0]["title"] == "New Chat":
                title = generate_chat_title(req.content)
                supabase.table("chats").update({"title": title}).eq("id", str(chat_id)).execute()
                return {"message": msg_resp.data[0], "generated_title": title}

        return {"message": msg_resp.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
