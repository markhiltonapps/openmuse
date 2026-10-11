# OpenMuse's own voice: Pipecat with Soniox, Claude and Inworld or Speechify.
# Railway builds this from apps/voice. Docker Hub limits pulls from Railway's shared builders
# (429), so the base image comes from Google's mirror.
FROM mirror.gcr.io/library/python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY openmuse_voice ./openmuse_voice
RUN useradd --create-home voice && chown -R voice /app
USER voice
# "::" so Railway's private network (IPv6) reaches it; no public domain is needed.
ENV HOST=:: PORT=8080 VOICE_WORKERS=2 VOICE_CALLS_PER_WORKER=4
EXPOSE 8080
CMD ["python", "-m", "openmuse_voice"]
