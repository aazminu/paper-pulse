from fastapi import APIRouter, HTTPException
from app.models import FeedItemUpdate
from app.database import supabase

router = APIRouter(
    prefix="/feed",
    tags=["Feed"]
)

@router.get("/{user_id}", summary="Get a user's daily paper feed")
def get_user_feed(user_id: str):
    try:
        response = supabase.table("feed_items") \
            .select("*, papers(*)") \
            .eq("user_id", user_id) \
            .order("relevance_score", desc=True) \
            .limit(25) \
            .execute()
        
        if not response.data:
            return []

        formatted_feed = []
        for item in response.data:
            if "papers" in item:
                item["paper"] = item.pop("papers")
            formatted_feed.append(item)

        return formatted_feed

    except Exception as e:
        print(f"Error fetching feed: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch feed.")

@router.patch("/{feed_item_id}", summary="Save or unsave a paper")
def update_feed_item(feed_item_id: str, update_data: FeedItemUpdate):
    try:
        response = supabase.table("feed_items") \
            .update({"is_saved": update_data.is_saved}) \
            .eq("id", feed_item_id) \
            .execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Feed item not found.")
            
        return {"status": "success", "is_saved": response.data[0]["is_saved"]}

    except Exception as e:
        print(f"Error updating feed item: {e}")
        raise HTTPException(status_code=500, detail="Failed to update feed item.")