from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import json
import os
import sqlite3
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(ROOT, "scores.sqlite3"))


def init_db():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player TEXT NOT NULL,
                score INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores(score DESC, created_at ASC)")


def clean_player(value):
    value = (value or "Guest").strip()[:16]
    return value or "Guest"


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self.json_response({"ok": True})
            return
        if parsed.path == "/api/rankings":
            limit = int(parse_qs(parsed.query).get("limit", ["10"])[0])
            limit = max(1, min(limit, 50))
            with sqlite3.connect(DB_PATH) as db:
                db.row_factory = sqlite3.Row
                rows = db.execute(
                    "SELECT id, player, score, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT ?",
                    (limit,),
                ).fetchall()
            rankings = [
                {
                    "rank": index + 1,
                    "id": row["id"],
                    "player": row["player"],
                    "score": row["score"],
                    "createdAt": row["created_at"],
                }
                for index, row in enumerate(rows)
            ]
            self.json_response({"rankings": rankings})
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/scores":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or "{}")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        player = clean_player(payload.get("player"))
        score = max(0, int(payload.get("score", 0)))
        now = int(time.time())
        with sqlite3.connect(DB_PATH) as db:
            cur = db.execute(
                "INSERT INTO scores(player, score, created_at) VALUES (?, ?, ?)",
                (player, score, now),
            )
            score_id = cur.lastrowid
            rank = db.execute(
                "SELECT COUNT(*) + 1 FROM scores WHERE score > ? OR (score = ? AND created_at < ?)",
                (score, score, now),
            ).fetchone()[0]
        self.json_response({"id": score_id, "player": player, "score": score, "rank": rank})

    def json_response(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    init_db()
    os.chdir(ROOT)
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving Dolphin Ring Rush at http://localhost:{port}")
    server.serve_forever()
