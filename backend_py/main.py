import os
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from routes import match, parse_resume, generate, jobs

app = FastAPI(title="EasyFill Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(match.router, prefix="/match")
app.include_router(parse_resume.router, prefix="/parse-resume")
app.include_router(generate.router, prefix="/generate")
app.include_router(jobs.router, prefix="/jobs")


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
