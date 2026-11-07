# face-service — OpenCV YuNet + SFace face embeddings over HTTP (CPU only).
# No apt packages: models are fetched and health is checked with Python itself.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FACE_MODEL_DIR=/models

# Where pip installs from. Leave empty for pypi.org; set a mirror where pypi.org
# is unreachable, e.g. --build-arg PIP_INDEX_URL=https://mirror-pypi.runflare.com/simple
ARG PIP_INDEX_URL=
COPY apps/face-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --timeout 60 --retries 5 \
      ${PIP_INDEX_URL:+--index-url "$PIP_INDEX_URL"} -r /app/requirements.txt

# Models from opencv_zoo (Apache-2.0 / MIT). Set OPENCV_ZOO_REF to a commit to
# pin them: a different model changes the embeddings stored in fleet.driver_photos.
ARG OPENCV_ZOO_REF=main
# (No RUN heredoc: the legacy Docker builder does not support it.)
RUN mkdir -p /models && python -c "\
import urllib.request; \
base = 'https://github.com/opencv/opencv_zoo/raw/${OPENCV_ZOO_REF}/models/'; \
[urllib.request.urlretrieve(base + p, '/models/' + p.split('/')[-1]) for p in ( \
  'face_detection_yunet/face_detection_yunet_2023mar.onnx', \
  'face_recognition_sface/face_recognition_sface_2021dec.onnx')]" \
 && python -c "import cv2; \
cv2.FaceDetectorYN.create('/models/face_detection_yunet_2023mar.onnx', '', (320, 320)); \
cv2.FaceRecognizerSF.create('/models/face_recognition_sface_2021dec.onnx', '')"

COPY apps/face-service/app.py /app/app.py
WORKDIR /app

RUN useradd --uid 10001 --no-create-home face
USER face

EXPOSE 3013
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:3013/health', timeout=4)" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3013", "--workers", "1"]
