import logging
import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
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
from app.routers import graph
from app.services.pipeline_service import run_daily_pipeline

load_dotenv()

logger = logging.getLogger("app")

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        from app.services.neo4j_service import init_schema, close_driver
        init_schema()
    except Exception as e:
        logger.warning("Neo4j schema init skipped: %s", e)

    scheduler = BackgroundScheduler()
    scheduler.add_job(run_daily_pipeline, 'cron', hour=0, minute=0)
    scheduler.start()
    logger.info("Background scheduler started. Nightly pipeline set for midnight.")
    
    yield

    scheduler.shutdown()
    try:
        close_driver()
    except Exception:
        pass
    logger.info("Background scheduler shut down.")

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
app.include_router(graph.router)

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