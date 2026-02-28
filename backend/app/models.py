from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date, datetime

# ----------------------------------
# USER MODELS
# ----------------------------------
class UserCreate(BaseModel):
    id: str = Field(..., description="The Clerk User ID")
    email: str
    domains: List[str] = Field(default_factory=list, description="List of ArXiv domains e.g., ['cs', 'math']")
    interest_text: Optional[str] = None

class UserResponse(BaseModel):
    id: str
    email: str
    domains: List[str]
    interest_text: Optional[str]
    created_at: datetime

# ----------------------------------
# PAPER MODELS
# ----------------------------------
class PaperCreate(BaseModel):
    arxiv_id: str
    title: str
    authors: List[str]
    published_date: date
    abstract: str
    url: str
    source: str = Field(default="arxiv", description="Paper source: arxiv, semantic_scholar, pubmed, or openalex")
    doi: Optional[str] = Field(default=None, description="DOI identifier if available")
    full_text: Optional[str] = Field(default=None, description="Full paper text extracted from PDF (ArXiv papers)")

class PaperResponse(BaseModel):
    arxiv_id: str
    title: str
    authors: List[str]
    published_date: date
    abstract: str
    summary: Optional[str] = None
    url: str
    source: str = "arxiv"
    doi: Optional[str] = None
    full_text: Optional[str] = None
    created_at: datetime

# ----------------------------------
# FEED ITEM MODELS
# ----------------------------------
class FeedItemUpdate(BaseModel):
    is_saved: bool

class FeedItemResponse(BaseModel):
    id: str
    user_id: str
    paper_id: str
    relevance_score: Optional[float] = None
    is_saved: bool
    created_at: datetime
    # We embed the actual paper details so the frontend can render the card easily
    paper: Optional[PaperResponse] = None