import ctypes
import json
import os
import sys
import time
from datetime import datetime, timezone
import psutil

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def foreground_sample():
    hwnd = user32.GetForegroundWindow()
    pid = ctypes.c_ulong()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    title_len = user32.GetWindowTextLengthW(hwnd)
    title = ctypes.create_unicode_buffer(title_len + 1)
    user32.GetWindowTextW(hwnd, title, title_len + 1)
    process_path = None
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if handle:
        try:
            size = ctypes.c_ulong(32768)
            buffer = ctypes.create_unicode_buffer(size.value)
            if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                process_path = buffer.value
        finally:
            kernel32.CloseHandle(handle)
    watched = []
    for process in psutil.process_iter(["pid", "name", "create_time", "cmdline"]):
        try:
            name = (process.info.get("name") or "").lower()
            if name not in {"cscript.exe", "wscript.exe"}:
                continue
            watched.append({
                "pid": process.info["pid"],
                "name": process.info.get("name"),
                "create_time": process.info.get("create_time"),
                "cmdline": process.info.get("cmdline"),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return {
        "at": datetime.now(timezone.utc).isoformat(),
        "foreground_hwnd": int(hwnd),
        "foreground_pid": int(pid.value),
        "foreground_process": process_path,
        "foreground_title": title.value,
        "watched_script_processes": watched,
    }


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: foreground-process-sampler.py OUTPUT_JSON DURATION_SECONDS INTERVAL_MS")
    output = os.path.abspath(sys.argv[1])
    duration = float(sys.argv[2])
    interval = max(0.02, float(sys.argv[3]) / 1000.0)
    started = time.monotonic()
    samples = []
    while time.monotonic() - started < duration:
        samples.append(foreground_sample())
        time.sleep(interval)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    with open(output, "w", encoding="utf-8") as handle:
        json.dump({"samples": samples}, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
