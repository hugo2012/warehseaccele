import os
import shutil
import tempfile

from fastapi import FastAPI, UploadFile, File
from predict import predict_packaging

app = FastAPI()

from fastapi.middleware.cors import CORSMiddleware

# Allow browser cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)
@app.get("/")
def health():
    return {
        "status": "running",
        "application": "Packaging Inspection AI"
    }


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename)[1]

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        shutil.copyfileobj(file.file, temp)
        temp_path = temp.name

    try:
        return predict_packaging(temp_path)
    finally:
        os.remove(temp_path)