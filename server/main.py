from fastapi import FastAPI
from dotenv import load_dotenv
import os
from fastapi.middleware.cors import CORSMiddleware
from typing import Any
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("GROQ_API_KEY")

@app.get("/")
async def root():
    return {"message": "API is running"}

@app.post("/solve")
async def solve(form: dict[str, Any]):
    print(form)
    print(API_KEY)

    return {
        "message": "Received",
        "question": form
    }
    
