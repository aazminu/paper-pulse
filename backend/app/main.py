import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler

from app.database import supabase
from app.routers import users
from app.routers import pipeline
from app.routers import feed
from app.routers import ask
from app.routers import chats
from app.routers import papers
from app.services.pipeline_service import run_daily_pipeline

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    
    # Schedule the pipeline to run every day at midnight UTC
    scheduler.add_job(run_daily_pipeline, 'cron', hour=0, minute=0)
    scheduler.start()
    print("Background scheduler started. Nightly pipeline set for midnight.")
    
    yield # The FastAPI application runs here
    
    # This runs gracefully when the server shuts down
    scheduler.shutdown()
    print("Background scheduler shut down.")

app = FastAPI(title="PaperPulse API", lifespan=lifespan)
cors_origin = os.getenv("CORS_ORIGIN", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[cors_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(pipeline.router)
app.include_router(feed.router)
app.include_router(ask.router)
app.include_router(chats.router)
app.include_router(papers.router)

@app.get("/")
def read_root():
    return {"status": "PaperPulse API is running smoothly!"}

@app.get("/health/db")
def check_db():
    try:
        response = supabase.auth.get_session()
        return {"status": "Database connection successful!"}
    except Exception as e:
        return {"status": "Database connection failed", "error": str(e)}