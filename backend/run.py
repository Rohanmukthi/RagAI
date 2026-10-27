import uvicorn
import os
import sys

# Ensure backend directory is in python path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

if __name__ == "__main__":
    port = int(os.environ.get("FASTAPI_PORT", 8001))
    print(f"Starting University Assistant FastAPI Backend on http://0.0.0.0:{port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True, app_dir=current_dir)
