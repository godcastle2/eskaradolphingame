# Dolphin Ring Rush

Mobile web game where players guide a dolphin through rings and compete on an online leaderboard.

## Local Run

```bash
python server.py
```

Open:

- PC: `http://localhost:8000`
- Phone on same Wi-Fi: `http://<PC-IP>:8000`
- QR page: `http://<PC-IP>:8000/qr.html`

## Public Deployment

This project is ready to deploy as a small Python web server with SQLite.

Recommended simple path:

1. Push this folder to GitHub.
2. Create a new Web Service on Render.
3. Select the repository.
4. Render will detect `render.yaml`.
5. Deploy.
6. Share the deployed URL or open `/qr.html` to show a QR code.

The included `render.yaml` creates a persistent disk and stores the leaderboard DB at:

```text
/data/scores.sqlite3
```

## Files

- `index.html`: game UI
- `qr.html`: QR share page
- `src/config.js`: physics, difficulty, ring, and visual tuning
- `src/game.js`: canvas rendering, controls, scoring, collision, ranking API calls
- `src/physics.js`: lightweight game physics helpers
- `src/styles.css`: mobile UI styling
- `server.py`: static file server and SQLite ranking API
- `tests/physics_test.py`: physics regression tests

## Ranking API

- `POST /api/scores`: `{ "player": "name", "score": 10 }`
- `GET /api/rankings?limit=10`: top rankings
- `GET /healthz`: deployment health check

## Notes

- `scores.sqlite3` is local runtime data and is excluded from Docker builds.
- For real events, use the deployed public URL in the QR code.
