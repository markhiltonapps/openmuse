"""A stand-in for Anthropic's Messages API, for running the voice service without keys.

Streams like the real one. The first question gets a short answer; anything mentioning the
calendar (and every second question) gets "One sec" plus a hand_off call; a hand-off's answer
gets a short reply. MOCK_FIRST_TOKEN_MS sets how long the first words take (default 350 ms).

    python tests/mock_anthropic.py 8799    # then ANTHROPIC_BASE_URL=http://127.0.0.1:8799
"""

import asyncio
import json
import os
import sys

from aiohttp import web

FIRST_TOKEN = float(os.environ.get("MOCK_FIRST_TOKEN_MS", "350")) / 1000
count = 0


def last_user(messages):
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content, False
        parts = content or []
        if any(part.get("type") == "tool_result" for part in parts):
            return "", True
        return " ".join(part.get("text", "") for part in parts if part.get("type") == "text"), False
    return "", False


async def messages(request: web.Request):
    global count
    count += 1
    body = await request.json()
    text, answered = last_user(body.get("messages", []))
    tools = [tool.get("name") for tool in body.get("tools", [])]
    if answered:
        blocks = [{"type": "text", "text": "You've got the dentist at three, then nothing else."}]
    elif ("calendar" in text.lower() or count % 2 == 0) and "hand_off" in tools:
        blocks = [
            {"type": "text", "text": "One sec."},
            {
                "type": "tool_use",
                "id": f"toolu_{count}",
                "name": "hand_off",
                "input": {"request": "their calendar this afternoon"},
            },
        ]
    else:
        blocks = [{"type": "text", "text": "Hi! I'm doing well. What can I do for you?"}]
    response = web.StreamResponse(headers={"content-type": "text/event-stream"})
    await response.prepare(request)

    async def send(kind, data):
        await response.write(f"event: {kind}\ndata: {json.dumps({'type': kind, **data})}\n\n".encode())

    usage = {
        "input_tokens": 40,
        "cache_read_input_tokens": 2100,
        "cache_creation_input_tokens": 0,
        "output_tokens": 1,
    }
    await send(
        "message_start",
        {
            "message": {
                "id": f"msg_{count}",
                "type": "message",
                "role": "assistant",
                "model": body.get("model"),
                "content": [],
                "stop_reason": None,
                "usage": usage,
            }
        },
    )
    await asyncio.sleep(FIRST_TOKEN)
    for index, block in enumerate(blocks):
        if block["type"] == "text":
            await send("content_block_start", {"index": index, "content_block": {"type": "text", "text": ""}})
            for word in block["text"].split(" "):
                await send(
                    "content_block_delta",
                    {"index": index, "delta": {"type": "text_delta", "text": word + " "}},
                )
                await asyncio.sleep(0.01)
        else:
            await send(
                "content_block_start",
                {"index": index, "content_block": {**block, "input": {}}},
            )
            await send(
                "content_block_delta",
                {
                    "index": index,
                    "delta": {"type": "input_json_delta", "partial_json": json.dumps(block["input"])},
                },
            )
        await send("content_block_stop", {"index": index})
    stop = "tool_use" if any(b["type"] == "tool_use" for b in blocks) else "end_turn"
    await send(
        "message_delta",
        {
            "delta": {"stop_reason": stop, "stop_sequence": None},
            # Cumulative, as the real API reports it.
            "usage": {**usage, "output_tokens": 18},
        },
    )
    await send("message_stop", {})
    return response


app = web.Application()
app.router.add_post("/v1/messages", messages)

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=int(sys.argv[1] if len(sys.argv) > 1 else 8799))
