#!/usr/bin/env python3
"""Rename a Codex thread through the local shared app-server."""

import base64
import hashlib
import json
import os
import socket
import struct
import sys
from pathlib import Path


TIMEOUT_SECONDS = 2
WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class BufferedSocket:
    def __init__(self, sock, initial=b""):
        self.sock = sock
        self.buffer = initial

    def read_exact(self, size):
        while len(self.buffer) < size:
            chunk = self.sock.recv(max(4096, size - len(self.buffer)))
            if not chunk:
                raise EOFError("app-server closed the socket")
            self.buffer += chunk
        data, self.buffer = self.buffer[:size], self.buffer[size:]
        return data


def send_frame(sock, opcode, payload):
    mask = os.urandom(4)
    length = len(payload)
    if length < 126:
        header = bytes([0x80 | opcode, 0x80 | length])
    elif length < 65536:
        header = bytes([0x80 | opcode, 0x80 | 126]) + struct.pack("!H", length)
    else:
        header = bytes([0x80 | opcode, 0x80 | 127]) + struct.pack("!Q", length)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    sock.sendall(header + mask + masked)


def send_json(sock, value):
    send_frame(sock, 0x1, json.dumps(value, separators=(",", ":")).encode())


def receive_json(reader):
    while True:
        first, second = reader.read_exact(2)
        if not first & 0x80:
            raise ValueError("fragmented app-server WebSocket frame")
        opcode = first & 0x0F
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", reader.read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", reader.read_exact(8))[0]
        mask = reader.read_exact(4) if second & 0x80 else None
        payload = reader.read_exact(length)
        if mask:
            payload = bytes(
                byte ^ mask[index % 4] for index, byte in enumerate(payload)
            )
        if opcode == 0x1:
            return json.loads(payload)
        if opcode == 0x8:
            raise EOFError("app-server closed the WebSocket")
        if opcode == 0x9:
            send_frame(reader.sock, 0xA, payload)


def receive_response(reader, request_id):
    while True:
        message = receive_json(reader)
        if not isinstance(message, dict):
            raise ValueError("malformed app-server response")
        if message.get("id") != request_id:
            continue
        if "error" in message:
            raise RuntimeError(message["error"])
        if "result" not in message:
            raise ValueError("app-server response is missing result")
        return message["result"]


def connect(socket_path):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(TIMEOUT_SECONDS)
    sock.connect(socket_path)

    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(
        (
            "GET / HTTP/1.1\r\n"
            "Host: localhost\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode()
    )

    response = b""
    while b"\r\n\r\n" not in response:
        chunk = sock.recv(4096)
        if not chunk:
            raise EOFError("app-server closed during WebSocket handshake")
        response += chunk
    headers, initial = response.split(b"\r\n\r\n", 1)
    expected_accept = base64.b64encode(
        hashlib.sha1((key + WEBSOCKET_GUID).encode()).digest()
    ).decode()
    if (
        b"101 Switching Protocols" not in headers
        or expected_accept.encode() not in headers
    ):
        raise ConnectionError("app-server WebSocket handshake failed")
    return sock, BufferedSocket(sock, initial)


def set_thread_name(thread_id, name):
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    socket_path = os.environ.get(
        "CODEX_APP_SERVER_SOCKET",
        str(codex_home / "app-server-control" / "app-server-control.sock"),
    )
    sock, reader = connect(socket_path)
    try:
        # Codex app-server protocol: initialize request, initialized notification,
        # then the stable thread/name/set request with {threadId, name}.
        send_json(
            sock,
            {
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "codex-session-namer",
                        "title": "Codex Session Namer",
                        "version": "1.0.0",
                    }
                },
            },
        )
        receive_response(reader, 1)
        send_json(sock, {"method": "initialized", "params": {}})
        send_json(
            sock,
            {
                "method": "thread/name/set",
                "id": 2,
                "params": {"threadId": thread_id, "name": name},
            },
        )
        receive_response(reader, 2)
    finally:
        sock.close()


def main():
    if len(sys.argv) != 3 or not sys.argv[1] or not sys.argv[2]:
        return 2
    try:
        set_thread_name(sys.argv[1], sys.argv[2])
    except (OSError, EOFError, ValueError, RuntimeError):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
