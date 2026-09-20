import asyncio
import time
from collections import deque
from threading import Lock

MAX_REQUESTS_PER_MINUTE = 15

gemini_requests: deque[float] = deque()
gemini_rate_limit_lock = asyncio.Lock()


async def wait_for_gemini_rate_limit():
    while True:
        async with gemini_rate_limit_lock:
            now = time.monotonic()

            # Remove requests older than 60 seconds
            while (
                gemini_requests
                and now - gemini_requests[0] >= 60
            ):
                gemini_requests.popleft()

            # We have capacity
            if len(gemini_requests) < MAX_REQUESTS_PER_MINUTE:
                gemini_requests.append(now)
                return

            wait_time = 60 - (now - gemini_requests[0])
            print(f"[Gemini] Rate limit reached. Waiting for {wait_time:.2f} seconds...")

        await asyncio.sleep(wait_time)


MAX_REQUESTS_PER_MINUTE_IMAGE = 30

image_requests: deque[float] = deque()
image_rate_limit_lock = Lock()

def wait_for_image_rate_limit():
    while True:
        with image_rate_limit_lock:
            now = time.monotonic()

            # Remove requests older than 60 seconds
            while (
                image_requests
                and now - image_requests[0] >= 60
            ):
                image_requests.popleft()

            # We have capacity
            if len(image_requests) < MAX_REQUESTS_PER_MINUTE_IMAGE:
                image_requests.append(now)
                return

            # Wait until the oldest request falls outside
            # the 60-second window
            wait_time = 60 - (now - image_requests[0])

        # Don't hold the lock while sleeping
        time.sleep(wait_time)