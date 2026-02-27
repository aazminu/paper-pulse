import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import supabase
from app.routers import users

load_dotenv()
app = FastAPI(title="PaperPulse API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)

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