import logging
from fastapi import APIRouter, HTTPException
from app.models import UserCreate
from app.database import supabase
from app.services.openai_service import get_embedding
from app.services.query_optimizer import optimize_user_interests
import json

logger = logging.getLogger("users")

router = APIRouter(
    prefix="/users",
    tags=["Users"]
)

@router.post("/", summary="Create a new user from onboarding")
def create_user(user: UserCreate):
    try:
        user_data = user.model_dump()

        if user.interest_text:
            embedding = get_embedding(user.interest_text)
            if embedding:
                user_data["interest_vector"] = embedding
            else:
                user_data["interest_vector"] = None

            optimized = optimize_user_interests(
                interest_text=user.interest_text,
                domains=user.domains,
            )
            user_data["optimized_queries"] = json.dumps(optimized)
            logger.info("[Onboarding] Generated %d optimized queries for new user",
                        len(optimized.get('search_queries', [])))
        
        response = supabase.table("users").insert(user_data).execute()
        
        if response.data:
            return response.data[0]
        else:
            raise HTTPException(status_code=400, detail="Failed to create user.")
            
    except Exception as e:
        logger.error("Error creating user: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{user_id}", summary="Get a user's profile")
def get_user(user_id: str):
    try:
        response = supabase.table("users").select("id, email, domains, interest_text, created_at").eq("id", user_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="User not found")
            
        return response.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))