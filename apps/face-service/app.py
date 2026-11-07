"""
face-service — turns one cabin photo into a face embedding.

    POST /embed   {"imageBase64": "<jpeg>"}
                  → {"face": {"score", "box": [x, y, w, h]}, "embedding": [128 floats]}
                  → {"face": null, "embedding": null}   when no face is found
    POST /snapshot {"url": "rtsp://mediamtx:8554/<path>"}
                  → {"imageBase64": "<jpeg>", "width", "height"}
                  → 404 when that stream is not live
    GET  /health  → {"status": "ok"}

Detection is OpenCV YuNet, recognition is OpenCV SFace (both from opencv_zoo,
Apache-2.0 / MIT — safe for commercial use). The embedding is L2-normalised,
so the caller compares two faces with a plain dot product (cosine similarity).

Matching itself lives in fleet-management-service: this service only knows
pixels, never drivers or tenants.

/snapshot exists because the MD300 refuses the D03/D00 photo commands
(`FFFE`) while its live stream works: fleet-management starts the cabin
camera's stream and asks here for one frame of it.
"""

from __future__ import annotations

import base64
import os
import time
from urllib.parse import urlparse

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_DIR = os.environ.get("FACE_MODEL_DIR", "/models")
DETECTOR_PATH = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
RECOGNIZER_PATH = os.path.join(MODEL_DIR, "face_recognition_sface_2021dec.onnx")
# Faces below this detector confidence are ignored (YuNet scores 0..1).
MIN_DETECTION_SCORE = float(os.environ.get("FACE_MIN_DETECTION_SCORE", "0.6"))
# Faces smaller than this (pixels, shorter box side) are too small to recognise.
MIN_FACE_PX = int(os.environ.get("FACE_MIN_FACE_PX", "40"))
MAX_IMAGE_BYTES = 8 * 1024 * 1024
# /snapshot only reads RTSP from these hosts (the MediaMTX container).
SNAPSHOT_HOSTS = {
    h.strip() for h in os.environ.get("FACE_SNAPSHOT_HOSTS", "mediamtx").split(",") if h.strip()
}
SNAPSHOT_TIMEOUT_MS = int(os.environ.get("FACE_SNAPSHOT_TIMEOUT_MS", "8000"))
# Frames read before keeping one: the first frames after joining mid-GOP can be
# smeared, and the stream needs a moment for exposure after it starts.
SNAPSHOT_WARMUP_S = float(os.environ.get("FACE_SNAPSHOT_WARMUP_S", "1.0"))
# FFmpeg capture options for every VideoCapture in this process.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

detector = cv2.FaceDetectorYN.create(DETECTOR_PATH, "", (320, 320), MIN_DETECTION_SCORE, 0.3, 50)
recognizer = cv2.FaceRecognizerSF.create(RECOGNIZER_PATH, "")

app = FastAPI(title="face-service")


class EmbedRequest(BaseModel):
    imageBase64: str


class SnapshotRequest(BaseModel):
    url: str


def decode_image(b64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="imageBase64 is not valid base64") from exc
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="image is empty or too large")
    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="image could not be decoded")
    return img


def detect(img: np.ndarray) -> np.ndarray | None:
    h, w = img.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    return faces


def enhance(img: np.ndarray) -> np.ndarray:
    """Night / IR frames are often dark and flat: equalise the luminance."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return cv2.cvtColor(clahe.apply(gray), cv2.COLOR_GRAY2BGR)


def best_face(faces: np.ndarray | None) -> np.ndarray | None:
    """The largest usable face — the driver sits closest to the cabin camera."""
    if faces is None or len(faces) == 0:
        return None
    usable = [f for f in faces if min(f[2], f[3]) >= MIN_FACE_PX]
    if not usable:
        return None
    return max(usable, key=lambda f: float(f[2] * f[3]))


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/embed")
def embed(req: EmbedRequest) -> dict:
    img = decode_image(req.imageBase64)
    source = img
    face = best_face(detect(img))
    if face is None:
        source = enhance(img)
        face = best_face(detect(source))
    if face is None:
        return {"face": None, "embedding": None}
    aligned = recognizer.alignCrop(source, face)
    feature = recognizer.feature(aligned).flatten().astype(np.float64)
    norm = float(np.linalg.norm(feature))
    if norm == 0.0:
        return {"face": None, "embedding": None}
    x, y, w, h = (int(round(v)) for v in face[:4])
    return {
        "face": {"score": round(float(face[14]), 4), "box": [x, y, w, h]},
        "embedding": [round(float(v), 6) for v in feature / norm],
    }


@app.post("/snapshot")
def snapshot(req: SnapshotRequest) -> dict:
    target = urlparse(req.url)
    if target.scheme != "rtsp" or target.hostname not in SNAPSHOT_HOSTS:
        raise HTTPException(status_code=400, detail="url must be rtsp:// on an allowed host")
    cap = cv2.VideoCapture(
        req.url,
        cv2.CAP_FFMPEG,
        [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, SNAPSHOT_TIMEOUT_MS, cv2.CAP_PROP_READ_TIMEOUT_MSEC, SNAPSHOT_TIMEOUT_MS],
    )
    try:
        if not cap.isOpened():
            raise HTTPException(status_code=404, detail="stream is not live")
        frame = None
        started = time.monotonic()
        deadline = started + SNAPSHOT_TIMEOUT_MS / 1000
        while time.monotonic() < deadline:
            ok, img = cap.read()
            if not ok:
                break
            frame = img
            if time.monotonic() - started >= SNAPSHOT_WARMUP_S:
                break
        if frame is None:
            raise HTTPException(status_code=404, detail="stream produced no frame")
    finally:
        cap.release()
    ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise HTTPException(status_code=500, detail="frame could not be encoded")
    h, w = frame.shape[:2]
    return {"imageBase64": base64.b64encode(jpeg.tobytes()).decode("ascii"), "width": w, "height": h}
