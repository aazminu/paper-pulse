"""
Chat CRUD router - persistent conversations like ChatGPT / Claude.
"""
import json
import logging
from uuid import UUID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.services.openai_service import generate_chat_title

logger = logging.getLogger("chats")

router = APIRouter(prefix="/chats", tags=["Chats"])


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


@router.get("/search")
def search_chats(user_id: str, q: str):
    """Search across chat titles and message content for a user.
    Returns matching chats with a snippet of the first matching message."""
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters")
    query_term = q.strip().lower()
    try:
        chats_resp = (
            supabase.table("chats")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        all_chats = chats_resp.data or []
        chat_ids = [c["id"] for c in all_chats]
        if not chat_ids:
            return []

        messages_resp = (
            supabase.table("chat_messages")
            .select("chat_id, role, content, created_at")
            .in_("chat_id", chat_ids)
            .ilike("content", f"%{query_term}%")
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )
        matched_messages = messages_resp.data or []

        msg_match_map: dict[str, dict] = {}
        for msg in matched_messages:
            cid = msg["chat_id"]
            if cid not in msg_match_map:
                content = msg["content"]
                idx = content.lower().find(query_term)
                start = max(0, idx - 40)
                end = min(len(content), idx + len(query_term) + 40)
                snippet = ("..." if start > 0 else "") + content[start:end] + ("..." if end < len(content) else "")
                msg_match_map[cid] = {
                    "snippet": snippet,
                    "role": msg["role"],
                    "match_type": "message",
                }

        results = []
        for chat in all_chats:
            title_match = query_term in chat["title"].lower()
            msg_match = chat["id"] in msg_match_map
            if title_match or msg_match:
                entry = {**chat, "match": msg_match_map.get(chat["id"], {"match_type": "title"})}
                results.append(entry)

        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@router.post("/{chat_id}/messages")
def add_message(chat_id: UUID, req: SaveMessageRequest):
    """Save a message to an existing chat. Auto-generates title on the first user message."""
    try:
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

        generated_title = None
        if req.content:
            chat_resp = (
                supabase.table("chats")
                .select("title")
                .eq("id", str(chat_id))
                .execute()
            )
            if chat_resp.data and chat_resp.data[0]["title"] in ("New Chat", ""):
                title_source = req.content
                if req.role == "ai":
                    first_msg = (
                        supabase.table("chat_messages")
                        .select("content")
                        .eq("chat_id", str(chat_id))
                        .eq("role", "user")
                        .order("created_at", desc=False)
                        .limit(1)
                        .execute()
                    )
                    if first_msg.data and first_msg.data[0]["content"]:
                        title_source = first_msg.data[0]["content"]
                try:
                    title = generate_chat_title(title_source)
                    supabase.table("chats").update({"title": title}).eq("id", str(chat_id)).execute()
                    generated_title = title
                except Exception as title_err:
                    logger.error("Title generation failed: %s", title_err)

        result = {"message": msg_resp.data[0]}
        if generated_title:
            result["generated_title"] = generated_title
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
