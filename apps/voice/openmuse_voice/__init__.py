"""OpenMuse's own voice: Pipecat (Soniox, Claude, Inworld or Speechify) behind the same small
protocol OpenAI's live voice speaks, so the api drives it with the code it already has."""

import os
import sys

from loguru import logger

# Pipecat's debug lines include the whole prompt (the person's details, their day) and every
# word said, so Railway's logs keep only INFO and up unless VOICE_LOG_LEVEL asks for more. To
# stdout, so Railway doesn't mark every line as an error.
logger.remove()
logger.add(sys.stdout, level=os.environ.get("VOICE_LOG_LEVEL", "INFO").upper())
