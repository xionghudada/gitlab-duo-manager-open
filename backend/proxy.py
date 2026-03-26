import asyncio
import json
import logging
import time

import httpx
from fastapi import Request, Response
from fastapi.responses import StreamingResponse

from keys import KeyManager, is_ignorable_error
from logs import LogManager, LogEntry

logger = logging.getLogger("proxy")

MODELS = [
    {"id": "claude-opus-4-6", "name": "Claude Opus 4.6"},
    {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6"},
    {"id": "claude-sonnet-4-5-20250514", "name": "Claude Sonnet 4"},
    {"id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5"},
]

NON_RETRYABLE_STATUSES = {400, 401, 403, 404, 429}
RETRY_DELAY_S = 0.75


async def proxy_messages(request: Request, key_mgr: KeyManager, log_mgr: LogManager, auto_continue: bool = True) -> Response:
    body = await request.body()
    try:
        payload = json.loads(body)
        is_stream = payload.get("stream", False)
        model = payload.get("model", "")
    except Exception:
        is_stream = False
        model = ""
        payload = {}

    max_retries = key_mgr.settings.max_retries

    # Cap max_tokens to prevent GitLab ~93s upstream timeout
    cap = key_mgr.settings.max_tokens_cap
    if cap > 0 and payload:
        orig = payload.get("max_tokens")
        if orig is None or orig > cap:
            payload["max_tokens"] = cap

    if is_stream and payload:
        tried: set[str] = set()
        keys = []
        for _ in range(max_retries + 1):
            key = key_mgr.select_key(exclude_ids=tried)
            if not key:
                break
            tried.add(key.id)
            keys.append(key)
        if not keys:
            return _json_error("No available keys", 503)
        return _stream_with_continuation(request, payload, keys, key_mgr, log_mgr, time.time(), auto_continue)

    # Non-streaming retry path
    request_body = json.dumps(payload).encode() if payload else body
    tried: set[str] = set()
    last_result: Response | None = None
    for attempt in range(max_retries + 1):
        key = key_mgr.select_key(exclude_ids=tried)
        if not key:
            return last_result or _json_error("No available keys", 503)
        tried.add(key.id)
        start_time = time.time()

        result = await _do_proxy(request, key_mgr, key, request_body)
        if isinstance(result, tuple):
            response, usage = result
        else:
            response, usage = result, {}

        duration_ms = int((time.time() - start_time) * 1000)
        if 200 <= response.status_code < 400:
            key_mgr.record_success(key)
            key_mgr.record_usage(key, usage.get("input_tokens", 0), usage.get("output_tokens", 0))
            log_mgr.add(LogEntry(
                key_id=key.id, key_name=key.name, model=model,
                status=response.status_code, duration_ms=duration_ms,
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
            ))
            return response

        last_result = response
        if response.status_code == 401:
            key_mgr.invalidate_token(key)
        if response.status_code != 499:
            key_mgr.record_failure(key)
        log_mgr.add(LogEntry(
            key_id=key.id, key_name=key.name, model=model,
            status=response.status_code, duration_ms=duration_ms,
            error=f"HTTP {response.status_code}",
        ))
        logger.warning(f"Attempt {attempt + 1}/{max_retries + 1} failed for '{key.name}' (HTTP {response.status_code})")

    return last_result or _json_error("All retries exhausted", 502)


# ---------------------------------------------------------------------------
# Streaming with auto-continuation
# ---------------------------------------------------------------------------

def _stream_with_continuation(
    request: Request, payload: dict, keys: list, key_mgr: KeyManager,
    log_mgr: LogManager, start_time: float, auto_continue: bool = True,
) -> StreamingResponse:
    model = payload.get("model", "")
    original_messages = payload.get("messages", [])
    max_cont = key_mgr.settings.max_continuations

    acc_text = ""
    total_input = 0
    total_output = 0

    async def generate():
        nonlocal acc_text, total_input, total_output

        stop_reason = None
        got_message_stop = False
        in_tool_use = False
        tool_use_buf: list[bytes] = []
        parsed_block_idx = -1
        parsed_block_open = False
        client_block_idx = -1
        client_block_open = False
        cap_triggered = False
        client_text_len = 0

        def _parse_sse_line(stripped: str):
            nonlocal acc_text, total_input, total_output, stop_reason, got_message_stop
            nonlocal in_tool_use, parsed_block_idx, parsed_block_open
            if not stripped.startswith("data:"):
                return
            data_str = stripped[5:].strip()
            if data_str == "[DONE]":
                return
            try:
                evt = json.loads(data_str)
            except (json.JSONDecodeError, ValueError):
                return
            etype = evt.get("type", "")
            if etype == "message_start":
                u = evt.get("message", {}).get("usage", {})
                total_input += u.get("input_tokens", 0)
            elif etype == "content_block_start":
                parsed_block_idx = evt.get("index", parsed_block_idx + 1)
                parsed_block_open = True
                if evt.get("content_block", {}).get("type") == "tool_use":
                    in_tool_use = True
            elif etype == "content_block_delta":
                acc_text += evt.get("delta", {}).get("text", "")
            elif etype == "content_block_stop":
                parsed_block_open = False
                in_tool_use = False
            elif etype == "message_delta":
                total_output += evt.get("usage", {}).get("output_tokens", 0)
                stop_reason = evt.get("delta", {}).get("stop_reason")
            elif etype == "message_stop":
                got_message_stop = True

        target = f"{key_mgr.settings.anthropic_proxy}/v1/messages"

        # === Phase 0: Connect with key retry ===
        selected_key = None
        resp = None
        client = None

        for key in keys:
            try:
                entry = await key_mgr.get_token(key)
            except Exception as e:
                logger.warning(f"Token fetch failed for '{key.name}': {e}")
                continue
            fwd_headers = {
                "content-type": "application/json",
                "authorization": f"Bearer {entry.token}",
                "anthropic-version": request.headers.get("anthropic-version", "2023-06-01"),
            }
            fwd_headers.update(entry.headers)
            c = httpx.AsyncClient(timeout=httpx.Timeout(300, connect=30))
            try:
                r = await c.send(
                    c.build_request("POST", target, content=json.dumps(payload).encode(), headers=fwd_headers),
                    stream=True,
                )
                if r.status_code == 200:
                    selected_key, resp, client = key, r, c
                    break
                error_body = await r.aread()
                await r.aclose()
                await c.aclose()
                if r.status_code == 401:
                    key_mgr.invalidate_token(key)
                key_mgr.record_failure(key)
                _log_result(key, model, start_time, 0, 0, False, key_mgr, log_mgr, r.status_code)
                if r.status_code in NON_RETRYABLE_STATUSES:
                    yield error_body
                    return
            except Exception as e:
                try:
                    await c.aclose()
                except Exception:
                    pass
                key_mgr.record_failure(key)
                logger.warning(f"Connection failed for '{key.name}': {e}")

        if not selected_key or not resp or not client:
            yield json.dumps({"error": {"message": "No available keys"}}).encode()
            return

        # === Phase 1: Raw forwarding with tool_use safety net ===
        try:
            parse_buf = ""
            async for chunk in resp.aiter_bytes():
                was_in_tool_use = in_tool_use
                parse_buf += chunk.decode(errors="replace")
                while "\n" in parse_buf:
                    line, parse_buf = parse_buf.split("\n", 1)
                    _parse_sse_line(line.strip())

                if cap_triggered:
                    pass
                elif stop_reason == "max_tokens" and max_cont > 0 and auto_continue:
                    cap_triggered = True
                elif in_tool_use:
                    tool_use_buf.append(chunk)
                elif was_in_tool_use:
                    tool_use_buf.append(chunk)
                    for b in tool_use_buf:
                        yield b
                    tool_use_buf.clear()
                    client_block_idx = parsed_block_idx
                    client_block_open = parsed_block_open
                    client_text_len = len(acc_text)
                else:
                    yield chunk
                    client_block_idx = parsed_block_idx
                    client_block_open = parsed_block_open
                    client_text_len = len(acc_text)

            if tool_use_buf:
                logger.info(f"Discarded incomplete tool_use block ({len(tool_use_buf)} chunks)")
                tool_use_buf.clear()

            await resp.aclose()
            await client.aclose()

        except Exception as e:
            try:
                await resp.aclose()
            except Exception:
                pass
            try:
                await client.aclose()
            except Exception:
                pass
            if tool_use_buf:
                logger.info(f"Discarded incomplete tool_use on error ({len(tool_use_buf)} chunks)")
                tool_use_buf.clear()
            logger.warning(f"Stream error during initial request: {e}")

        if cap_triggered:
            gap = acc_text[client_text_len:]
            if gap:
                if not client_block_open:
                    client_block_idx += 1
                    yield _sse("content_block_start", json.dumps({
                        "type": "content_block_start",
                        "index": client_block_idx,
                        "content_block": {"type": "text", "text": ""},
                    }))
                    client_block_open = True
                yield _sse("content_block_delta", json.dumps({
                    "type": "content_block_delta",
                    "index": client_block_idx,
                    "delta": {"type": "text_delta", "text": gap},
                }))
            logger.info(f"Cap hit (max_tokens), entering continuation ({len(acc_text)} chars)")
        elif got_message_stop:
            _log_result(selected_key, model, start_time, total_input, total_output, True, key_mgr, log_mgr)
            return

        # === Phase 2: Continuation with key rotation ===
        if not acc_text or max_cont <= 0:
            if cap_triggered:
                yield _close_events(client_block_idx, client_block_open, total_output, stop_reason or "max_tokens")
            _log_result(selected_key, model, start_time, total_input, total_output, not acc_text, key_mgr, log_mgr,
                        error="Stream truncated, no continuation" if acc_text else "Stream failed")
            return

        if not cap_triggered:
            logger.info(f"Stream truncated ({len(acc_text)} chars). Starting auto-continuation...")
        cont_keys = [selected_key] + [k for k in keys if k.id != selected_key.id]

        for cont in range(max_cont):
            yield b": heartbeat\n\n"
            await asyncio.sleep(RETRY_DELAY_S)

            cont_payload = {
                **payload,
                "messages": [
                    *original_messages,
                    {"role": "assistant", "content": acc_text},
                    {"role": "user", "content": "Continue to output the remaining content; there is no need to repeat what has already been output."},
                ],
            }

            cont_resp = None
            cont_client = None
            for ck in cont_keys:
                try:
                    entry = await key_mgr.get_token(ck)
                except Exception:
                    continue
                cont_headers = {
                    "content-type": "application/json",
                    "authorization": f"Bearer {entry.token}",
                    "anthropic-version": request.headers.get("anthropic-version", "2023-06-01"),
                }
                cont_headers.update(entry.headers)
                cc = httpx.AsyncClient(timeout=httpx.Timeout(300, connect=30))
                try:
                    cr = await cc.send(
                        cc.build_request("POST", target, content=json.dumps(cont_payload).encode(), headers=cont_headers),
                        stream=True,
                    )
                    if cr.status_code == 200:
                        cont_resp, cont_client = cr, cc
                        break
                    await cr.aread()
                    await cr.aclose()
                    await cc.aclose()
                    if cr.status_code in NON_RETRYABLE_STATUSES:
                        break
                except Exception:
                    try:
                        await cc.aclose()
                    except Exception:
                        pass

            if not cont_resp or not cont_client:
                logger.error(f"All keys failed for continuation {cont + 1}")
                break

            if not client_block_open:
                client_block_idx += 1
                yield _sse("content_block_start", json.dumps({
                    "type": "content_block_start",
                    "index": client_block_idx,
                    "content_block": {"type": "text", "text": ""},
                }))
                client_block_open = True

            cont_stop_reason = None
            cont_got_stop = False

            try:
                buf = ""
                async for chunk in cont_resp.aiter_text():
                    buf += chunk
                    while "\n" in buf:
                        line, buf = buf.split("\n", 1)
                        stripped = line.strip()
                        if not stripped.startswith("data:"):
                            continue
                        data_str = stripped[5:].strip()
                        if data_str == "[DONE]":
                            continue
                        try:
                            evt = json.loads(data_str)
                        except (json.JSONDecodeError, ValueError):
                            continue

                        etype = evt.get("type", "")
                        if etype == "content_block_delta":
                            delta = evt.get("delta", {})
                            if delta.get("type") == "text_delta":
                                acc_text += delta.get("text", "")
                                evt["index"] = client_block_idx
                                yield _sse(etype, json.dumps(evt))
                        elif etype == "message_start":
                            u = evt.get("message", {}).get("usage", {})
                            total_input += u.get("input_tokens", 0)
                        elif etype == "message_delta":
                            total_output += evt.get("usage", {}).get("output_tokens", 0)
                            cont_stop_reason = evt.get("delta", {}).get("stop_reason")
                        elif etype == "message_stop":
                            cont_got_stop = True

                await cont_resp.aclose()
                await cont_client.aclose()

            except Exception as e:
                try:
                    await cont_resp.aclose()
                except Exception:
                    pass
                try:
                    await cont_client.aclose()
                except Exception:
                    pass
                if is_ignorable_error(e):
                    break
                logger.warning(f"Stream error during continuation {cont + 1}: {e}")

            if cont_got_stop:
                if cont_stop_reason == "max_tokens" and cont + 1 < max_cont:
                    logger.info(f"Continuation {cont + 1} also capped ({len(acc_text)} chars), continuing...")
                    continue
                logger.info(f"Continuation {cont + 1} completed ({len(acc_text)} total chars)")
                yield _close_events(client_block_idx, client_block_open, total_output, cont_stop_reason or "end_turn")
                _log_result(selected_key, model, start_time, total_input, total_output, True, key_mgr, log_mgr)
                return

            reason = "DROP" if not cont_got_stop else f"stop_reason={cont_stop_reason}"
            logger.info(f"Continuation {cont + 1}/{max_cont} truncated ({reason}, {len(acc_text)} chars)")

        yield _close_events(client_block_idx, client_block_open, total_output, cont_stop_reason or stop_reason or "end_turn")
        _log_result(selected_key, model, start_time, total_input, total_output, True, key_mgr, log_mgr)

    return StreamingResponse(generate(), media_type="text/event-stream")


def _log_result(key, model, start_time, inp, out, ok, key_mgr, log_mgr, status=None, error=""):
    duration_ms = int((time.time() - start_time) * 1000)
    if ok:
        key_mgr.record_success(key)
        key_mgr.record_usage(key, inp, out)
        log_mgr.add(LogEntry(key_id=key.id, key_name=key.name, model=model,
                             status=200, duration_ms=duration_ms,
                             input_tokens=inp, output_tokens=out, is_stream=True))
    else:
        key_mgr.record_failure(key)
        log_mgr.add(LogEntry(key_id=key.id, key_name=key.name, model=model,
                             status=status or 502, duration_ms=duration_ms,
                             is_stream=True, error=error or "Stream failed"))


def _sse(event_type: str, data_str: str) -> bytes:
    return f"event: {event_type}\ndata: {data_str}\n\n".encode()


def _close_events(block_idx: int, block_open: bool, output_tokens: int, stop_reason: str = "end_turn") -> bytes:
    parts = []
    if block_open:
        parts.append(_sse("content_block_stop", json.dumps({"type": "content_block_stop", "index": block_idx})))
    parts.append(_sse("message_delta", json.dumps({
        "type": "message_delta",
        "delta": {"stop_reason": stop_reason, "stop_sequence": None},
        "usage": {"output_tokens": output_tokens},
    })))
    parts.append(_sse("message_stop", json.dumps({"type": "message_stop"})))
    return b"".join(parts)


# ---------------------------------------------------------------------------
# Non-streaming proxy
# ---------------------------------------------------------------------------

async def _do_proxy(request: Request, key_mgr: KeyManager, key, body: bytes):
    try:
        entry = await key_mgr.get_token(key)
    except Exception as e:
        logger.error(f"Token fetch failed for '{key.name}': {e}")
        return _json_error("Upstream token fetch failed", 502)

    target = f"{key_mgr.settings.anthropic_proxy}/v1/messages"
    fwd_headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {entry.token}",
        "anthropic-version": request.headers.get("anthropic-version", "2023-06-01"),
    }
    fwd_headers.update(entry.headers)

    try:
        return await _direct_proxy(target, body, fwd_headers)
    except httpx.HTTPError as e:
        if is_ignorable_error(e):
            logger.debug(f"Ignorable error for '{key.name}': {e}")
            return _json_error("Client disconnected", 499)
        logger.error(f"Upstream error for '{key.name}': {e}")
        return _json_error("Upstream proxy request failed", 502)


async def _direct_proxy(target: str, body: bytes, headers: dict) -> tuple[Response, dict]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=30)) as client:
        resp = await client.post(target, content=body, headers=headers)
        usage = {}
        if 200 <= resp.status_code < 300:
            try:
                data = resp.json()
                u = data.get("usage", {})
                usage = {"input_tokens": u.get("input_tokens", 0), "output_tokens": u.get("output_tokens", 0)}
            except Exception:
                pass
        return Response(content=resp.content, status_code=resp.status_code, media_type="application/json"), usage


def _json_error(message: str, status: int = 502) -> Response:
    return Response(
        content=json.dumps({"error": {"message": message}}),
        status_code=status,
        media_type="application/json",
    )
