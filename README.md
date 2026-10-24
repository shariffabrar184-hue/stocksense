# StockSense Fullstack

This is the same StockSense UI split into a clean VS Code / Antigravity project with a Python + SQLite backend.

## Structure

- `frontend/index.html` - main StockSense page
- `frontend/assets/styles.css` - extracted CSS
- `frontend/assets/app.js` - extracted app JavaScript
- `frontend/assets/api.js` - backend API client
- `backend/app.py` - Python server, auth APIs, admin APIs, SQLite storage, report files, login email
- `data/stocksense.sqlite3` - created automatically on first run
- `data/reports/` - generated report HTML/CSV files
- `data/email_outbox.log` - test login email messages when SMTP is not configured

## Run

```powershell
cd "C:\Users\Abrar shariff\OneDrive\문서\New project\stocksense-fullstack"
.\run.ps1
```

Open:

```text
http://127.0.0.1:8000
```

## Logins

- Admin: `admin` or `abrar` / `Tasneem@2802` (Name: Abrar shariff)
- Employee: `analyst` / `emp123`
- User: `john` / `user123`
- User: `priya` / `user123`

You can also login with the account's email address or full name instead of username. On every successful login the backend sends a login notification to that account email. If SMTP is not configured, the message is saved to `data/email_outbox.log`.

## Real Email Setup

Copy `.env.example` to `.env`, then fill SMTP values:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_TLS=true
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM=StockSense <your_email@gmail.com>
```

Restart the backend after changing `.env`.
