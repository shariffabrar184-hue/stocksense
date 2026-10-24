from __future__ import annotations

import concurrent.futures
import csv
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import smtplib
import sqlite3
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone

# Ensure standard web MIME types are recognized in all host environments
mimetypes.init()
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/json", ".json")
from email.message import EmailMessage
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

# ── Real-time price fetching via Yahoo Finance REST API ───────────────────────
# Uses Yahoo Finance's public chart endpoint directly — no yfinance needed.
# This avoids broken fast_info / history bugs in some yfinance versions.

_YF_AVAILABLE = True  # We always have urllib

# Cache: { sym -> {price, chg, hi, lo, updated_at, _ts} }
_PRICE_CACHE: dict = {}
_PRICE_CACHE_LOCK = threading.Lock()
_CACHE_TTL = 30  # seconds

_YF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}

# Symbols that have changed their Yahoo Finance ticker.
# Keys are our DB symbols; values are Yahoo Finance base tickers (without exchange suffix).
_SYMBOL_ALIASES: dict[str, str] = {
    "ZOMATO": "ETERNAL",      # Zomato Ltd renamed to Eternal Ltd (2025)
    "MCDOWELL": "UNITDSPR",   # United Spirits NSE ticker
    "AMARAJABAT": "ARE&M",    # Amara Raja Energy & Mobility
    "TATAMOTORS": "TMCV",     # Tata Motors demerged Oct 2025 → commercial vehicle entity TMCV
}

_EXCHANGE_SUFFIX = {"NSE": ".NS", "BSE": ".BO"}


def _fetch_one_price(yf_ticker: str) -> tuple[str, dict | None]:
    """Fetch price for a single Yahoo Finance ticker using the v8 chart API.

    URL-encodes the ticker so special chars (e.g. '&' in ARE&M.NS) are safe.
    """
    safe_ticker = quote(yf_ticker, safe="")
    url = (
        f"https://query2.finance.yahoo.com/v8/finance/chart/{safe_ticker}"
        "?interval=1d&range=2d"
    )
    try:
        req = urllib.request.Request(url, headers=_YF_HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
        results = (data.get("chart") or {}).get("result") or []
        if not results:
            return yf_ticker, None
        meta = results[0]["meta"]
        price = meta.get("regularMarketPrice")
        if price is None:
            return yf_ticker, None
        price = float(price)
        prev = meta.get("previousClose") or meta.get("chartPreviousClose") or price
        prev = float(prev)
        hi = float(meta.get("regularMarketDayHigh") or price)
        lo = float(meta.get("regularMarketDayLow") or price)
        chg = round(((price - prev) / prev) * 100, 2) if prev else 0.0
        return yf_ticker, {
            "price": round(price, 2),
            "chg": chg,
            "hi": round(hi, 2),
            "lo": round(lo, 2),
            "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        }
    except Exception:
        return yf_ticker, None


def _fetch_live_prices(yf_ticker_to_sym: dict[str, str]) -> dict[str, dict]:
    """Fetch prices in parallel. Returns {sym: {price, chg, hi, lo, updated_at}}."""
    result: dict[str, dict] = {}
    tickers = list(yf_ticker_to_sym.keys())
    with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
        for yf_t, data in executor.map(_fetch_one_price, tickers):
            if data is not None:
                sym = yf_ticker_to_sym[yf_t]
                result[sym] = data
    return result


# Negative cache TTL: failed tickers (404 / no data) are skipped for this many seconds
# before being retried. Prevents hammering Yahoo Finance for fictional/mock symbols.
_NEGATIVE_CACHE_TTL = 300  # 5 minutes


WELL_KNOWN_NSE = [
    "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR",
    "BHARTIARTL","SBIN","BAJFINANCE","WIPRO","MARUTI",
    "ASIANPAINT","AXISBANK","SUNPHARMA","POWERGRID","TITAN","NTPC",
    "ONGC","JSWSTEEL","TECHM","ULTRACEMCO","DRREDDY","CIPLA",
    "KOTAKBANK","HCLTECH","INDUSINDBK","TATASTEEL","COALINDIA",
    "NESTLEIND","BAJAJFINSV","DIVISLAB","DABUR","GRASIM","ADANIENT",
    "APOLLOHOSP","TATACONSUM","PIDILITIND","SIEMENS","PAYTM","NYKAA",
    "IRCTC","DMART","HINDALCO","BANDHANBNK","LUPIN","VOLTAS","PFC",
    "SHREECEM","NHPC","JKCEMENT","CROMPTON","HUDCO","DLF",
    "GRANULES","SJVN","ZOMATO","IRFC","HAL","BEL",
    "SAIL","RVNL","NLCINDIA","BHEL","CONCOR","IRCON",
    "HDFCLIFE","SBILIFE","ICICIPRULI","ICICIGI","NAUKRI",
    "ZYDUSLIFE","TORNTPHARM","AUROPHARMA","BIOCON","GLENMARK","PVRINOX",
    "MOTHERSON","BALKRISIND","EXIDEIND","MCDOWELL","UBL",
    "COLPAL","MARICO","GODREJCP","EMAMILTD","VBL","TRENT","DELHIVERY",
    "NUVAMA","FINEORG","POLYCAB","KEI","HAVELLS","BLUESTARCO",
    "CRISIL","MUTHOOTFIN","CHOLAFIN","DEEPAKNTR",
]

def _bg_price_updater():
    while True:
        try:
            with sqlite3.connect(DATA / "stocksense.sqlite3") as conn:
                conn.row_factory = sqlite3.Row
                try:
                    db_stocks = [dict(r) for r in conn.execute("SELECT * FROM stocks ORDER BY id ASC")]
                except Exception:
                    db_stocks = []
            sym_exc_map = {s["sym"]: s.get("exc", "NSE") for s in db_stocks if s.get("sym")}
            for sym in WELL_KNOWN_NSE:
                sym_exc_map.setdefault(sym, "NSE")
            
            yf_ticker_to_sym = {}
            for sym, exc in sym_exc_map.items():
                base = _SYMBOL_ALIASES.get(sym, sym)
                suffix = _EXCHANGE_SUFFIX.get(exc, ".NS")
                yf_ticker_to_sym[base + suffix] = sym
                
            fresh = _fetch_live_prices(yf_ticker_to_sym)
            ts = time.time()
            with _PRICE_CACHE_LOCK:
                for sym, data in fresh.items():
                    data["_ts"] = ts
                    _PRICE_CACHE[sym] = data
                for sym in sym_exc_map:
                    if sym not in fresh and sym not in _PRICE_CACHE:
                        _PRICE_CACHE[sym] = {"_failed": True, "_ts": ts}
                    elif sym not in fresh and _PRICE_CACHE.get(sym, {}).get("_failed"):
                        _PRICE_CACHE[sym]["_ts"] = ts
        except Exception as e:
            print("Background price updater error:", e)
        time.sleep(_CACHE_TTL)

def get_live_prices(sym_exc_map: dict[str, str]) -> dict[str, dict]:
    """Return instantly from the background cache."""
    with _PRICE_CACHE_LOCK:
        return {
            sym: {k: v for k, v in _PRICE_CACHE[sym].items() if not k.startswith("_")}
            for sym in sym_exc_map
            if sym in _PRICE_CACHE and not _PRICE_CACHE[sym].get("_failed")
        }


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DATA = ROOT / "data"
REPORTS = DATA / "reports"
DB_PATH = DATA / "stocksense.sqlite3"
ENV_PATH = ROOT / ".env"

PUBLIC_TABLES = ["users", "stocks", "predictions", "watchlist", "alerts", "reports", "activity_log"]
WRITABLE_TABLES = set(PUBLIC_TABLES)
ADMIN_TABLES = {"users"}


def load_env() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def server_log(message: str) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    log_line = f"{now_iso()} {message}"
    print(log_line, flush=True)
    with (DATA / "server.log").open("a", encoding="utf-8") as f:
        f.write(f"{log_line}\n")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored or "$" not in stored:
        return False
    salt, digest = stored.split("$", 1)
    return hmac.compare_digest(hash_password(password, salt).split("$", 1)[1], digest)


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              name TEXT NOT NULL,
              email TEXT UNIQUE NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('user','employee','admin')),
              joined TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS stocks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              sym TEXT UNIQUE,
              name TEXT,
              exc TEXT,
              sec TEXT,
              price REAL,
              chg REAL,
              pe REAL,
              hi REAL,
              lo REAL,
              mc TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS predictions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER,
              user_name TEXT,
              symbol TEXT,
              stock TEXT,
              prediction TEXT,
              signal TEXT,
              confidence TEXT,
              target_price TEXT,
              horizon TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS watchlist (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER,
              symbol TEXT,
              watchlist_name TEXT,
              notes TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS alerts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER,
              symbol TEXT,
              alert_type TEXT,
              type TEXT,
              target TEXT,
              confidence_threshold TEXT,
              channel TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              type TEXT,
              stock TEXT,
              range TEXT,
              notes TEXT,
              user_id INTEGER,
              user_name TEXT,
              status TEXT,
              file_html TEXT,
              file_csv TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS activity_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              msg TEXT,
              user TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS email_outbox (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              recipient TEXT NOT NULL,
              subject TEXT NOT NULL,
              body TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            """
        )
        # Seed default accounts
        admin_pass = os.environ.get("ADMIN_PASSWORD", "Tasneem@2802")
        seed_user(conn, "admin", admin_pass, "Abrar shariff", "shariffabrar433@gmail.com", "admin")
        seed_user(conn, "abrar", admin_pass, "Abrar shariff", "shariffabrar184@gmail.com", "admin")
        seed_user(conn, "analyst", "emp123", "Analyst Kumar", "analyst@stocksense.in", "employee")
        seed_user(conn, "john", "user123", "John Doe", "john@example.com", "user")
        seed_user(conn, "priya", "user123", "Priya Sharma", "priya@example.com", "user")

        # Automatically update any existing admin or abrar accounts to ensure credentials match
        admin_hash = hash_password(admin_pass)
        conn.execute(
            """
            UPDATE users 
            SET name = 'Abrar shariff', password_hash = ?, role = 'admin'
            WHERE username IN ('admin', 'abrar') OR lower(name) = 'abrar shariff'
            """,
            (admin_hash,),
        )
        conn.execute("UPDATE OR IGNORE users SET email = ? WHERE username = 'admin'", ("shariffabrar433@gmail.com",))
        conn.execute("UPDATE OR IGNORE users SET email = ? WHERE username = 'abrar'", ("shariffabrar184@gmail.com",))
        seed_stocks(conn)


def seed_user(conn: sqlite3.Connection, username: str, password: str, name: str, email: str, role: str) -> None:
    exists = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if exists:
        return
    conn.execute(
        """
        INSERT INTO users(username,password_hash,name,email,role,joined,created_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (username, hash_password(password), name, email, role, today(), now_iso()),
    )


def seed_stocks(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) AS c FROM stocks").fetchone()["c"]:
        return
    stocks = [
        ("RELIANCE", "Reliance Industries Ltd", "NSE", "Energy", 2945.3, 1.24, 28.5, 3217, 2220, "19.9L Cr"),
        ("TCS", "Tata Consultancy Services", "NSE", "Technology", 4123.5, -0.82, 32.1, 4592, 3198, "15.0L Cr"),
        ("HDFCBANK", "HDFC Bank Ltd", "NSE", "Finance", 1756.8, 0.56, 19.8, 1978, 1427, "13.3L Cr"),
        ("INFY", "Infosys Ltd", "NSE", "Technology", 1892.45, 1.13, 26.4, 2025, 1351, "7.9L Cr"),
        ("ICICIBANK", "ICICI Bank Ltd", "NSE", "Finance", 1243.6, 0.91, 18.2, 1338, 968, "8.7L Cr"),
        ("HINDUNILVR", "Hindustan Unilever Ltd", "NSE", "FMCG", 2589.75, -0.45, 58.3, 2892, 2172, "6.1L Cr"),
        ("BHARTIARTL", "Bharti Airtel Ltd", "NSE", "Telecom", 1876.2, 2.34, 72.1, 1964, 1117, "11.2L Cr"),
        ("SBIN", "State Bank of India", "NSE", "Finance", 834.15, 1.67, 11.2, 912, 543, "7.4L Cr"),
        ("BAJFINANCE", "Bajaj Finance Ltd", "NSE", "Finance", 7124.3, -1.23, 35.4, 8192, 6063, "4.3L Cr"),
        ("WIPRO", "Wipro Ltd", "NSE", "Technology", 567.4, 0.78, 22.3, 672, 415, "2.9L Cr"),
        ("TATAMOTORS", "Tata Motors Ltd", "NSE", "Auto", 1023.85, 2.15, 14.7, 1179, 600, "3.8L Cr"),
        ("MARUTI", "Maruti Suzuki India Ltd", "NSE", "Auto", 13456.7, 0.34, 30.2, 14238, 10003, "4.1L Cr"),
    ]
    conn.executemany(
        """
        INSERT INTO stocks(sym,name,exc,sec,price,chg,pe,hi,lo,mc,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
        """,
        [(*stock, now_iso()) for stock in stocks],
    )


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def ensure_columns(conn: sqlite3.Connection, table: str, data: dict) -> None:
    cols = table_columns(conn, table)
    for key in data:
        if key in cols or key in {"id", "password", "password_hash"}:
            continue
        if not key.replace("_", "").isalnum():
            continue
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {key} TEXT")
        cols.add(key)


def clean_user(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    data.pop("password_hash", None)
    data.setdefault("password", "")
    return data


def rows(conn: sqlite3.Connection, table: str) -> list[dict]:
    order = "id DESC" if table in {"reports", "predictions", "activity_log"} else "id ASC"
    result = [dict(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY {order}")]
    if table == "users":
        return [clean_user(r) for r in result]
    return result


def all_tables() -> dict:
    with db() as conn:
        return {table: rows(conn, table) for table in PUBLIC_TABLES}


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).replace(microsecond=0).isoformat()
    conn.execute(
        "INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
        (token, user_id, now_iso(), expires),
    )
    return token


def log_activity(conn: sqlite3.Connection, msg: str, user: str = "system") -> None:
    conn.execute(
        "INSERT INTO activity_log(msg,user,created_at) VALUES(?,?,?)",
        (msg, user, now_iso()),
    )


def send_registration_email(conn: sqlite3.Connection, user: dict, ip: str) -> str:
    # Just reuse send_login_email for registration with an empty login_value
    return send_login_email(conn, user, "", ip)


def send_login_email(conn: sqlite3.Connection, user: dict, login_value: str, ip: str) -> str:
    recipient = user["email"]
    login_time = now_iso()
    subject = "Welcome to StockSense! 📈"

    # Plain-text version
    body_text = (
        f"Welcome to StockSense, {user['name']}!\n\n"
        "We are glad to see you logging in.\n\n"
        "Thank you for being a valued part of our platform.\n\n"
        f"Date: {today()}\n\n"
        "— StockSense Team"
    )

    # HTML version (professional look)
    body_html = f"""\
<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:12px">
  <div style="text-align:center;padding:16px 0">
    <h1 style="margin:0;font-size:24px;color:#0f172a">📈 StockSense</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#64748b">Real-Time Market Intelligence</p>
  </div>
  <div style="background:#fff;border-radius:10px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
    <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a">Welcome to StockSense, {user['name']}!</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px">
      We are so glad to see you logging in. Enjoy our real-time market intelligence and seamless experience.<br><br>
      Thank you for being a valued part of StockSense!
    </p>
    <p style="color:#64748b;font-size:13px;margin:16px 0 0;border-top:1px solid #f1f5f9;padding-top:16px">
      <strong>Date:</strong> {today()}
    </p>
  </div>
  <p style="text-align:center;font-size:12px;color:#94a3b8;margin:16px 0 0">
    &copy; StockSense &mdash; your market intelligence platform.
  </p>
</div>"""

    status = "queued"
    if os.getenv("SMTP_HOST"):
        try:
            msg = EmailMessage()
            msg["From"] = os.getenv("SMTP_FROM", os.getenv("SMTP_USER", "stocksense@localhost"))
            msg["To"] = recipient
            msg["Subject"] = subject
            msg.set_content(body_text)
            msg.add_alternative(body_html, subtype="html")
            with smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT", "587")), timeout=15) as smtp:
                if os.getenv("SMTP_TLS", "true").lower() == "true":
                    smtp.starttls()
                if os.getenv("SMTP_USER"):
                    smtp.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD", ""))
                smtp.send_message(msg)
            status = "sent"
            server_log(f"Login email SENT to {recipient}")
        except Exception as e:
            status = f"error: {e}"
            server_log(f"Login email FAILED to {recipient}: {e}")
    else:
        outbox = DATA / "email_outbox.log"
        outbox.write_text(
            (outbox.read_text(encoding="utf-8") if outbox.exists() else "")
            + f"\n--- {login_time} TO {recipient} ---\nSubject: {subject}\n{body_text}\n",
            encoding="utf-8",
        )
    conn.execute(
        "INSERT INTO email_outbox(recipient,subject,body,status,created_at) VALUES(?,?,?,?,?)",
        (recipient, subject, body_text, status, now_iso()),
    )
    return status


def generate_report_files(conn: sqlite3.Connection, report_id: int) -> None:
    report = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if not report:
        return
    data = dict(report)
    safe = f"report_{report_id}"
    html_path = REPORTS / f"{safe}.html"
    csv_path = REPORTS / f"{safe}.csv"
    stocks = rows(conn, "stocks")[:25]
    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>StockSense Report #{report_id}</title>
<style>body{{font-family:Inter,Arial,sans-serif;margin:40px;color:#101827}}h1{{color:#0369a1}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #d8e2ee;padding:8px;text-align:left}}th{{background:#eef6ff}}</style></head>
<body><h1>StockSense {data.get('type') or 'Report'}</h1>
<p><b>Report ID:</b> {report_id}<br><b>Stock:</b> {data.get('stock') or 'ALL'}<br><b>Generated by:</b> {data.get('user_name') or 'system'}<br><b>Date:</b> {data.get('created_at')}</p>
<p>{data.get('notes') or 'AI market report generated and stored by the StockSense backend.'}</p>
<h2>Market Snapshot</h2><table><tr><th>Symbol</th><th>Name</th><th>Sector</th><th>Price</th><th>Change</th></tr>
{''.join(f"<tr><td>{s.get('sym','')}</td><td>{s.get('name','')}</td><td>{s.get('sec','')}</td><td>{s.get('price','')}</td><td>{s.get('chg','')}</td></tr>" for s in stocks)}
</table></body></html>"""
    html_path.write_text(html, encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["report_id", "type", "stock", "range", "user_name", "created_at"])
        writer.writerow([report_id, data.get("type"), data.get("stock"), data.get("range"), data.get("user_name"), data.get("created_at")])
        writer.writerow([])
        writer.writerow(["symbol", "name", "sector", "price", "change"])
        for stock in stocks:
            writer.writerow([stock.get("sym"), stock.get("name"), stock.get("sec"), stock.get("price"), stock.get("chg")])
    conn.execute("UPDATE reports SET file_html = ?, file_csv = ? WHERE id = ?", (str(html_path), str(csv_path), report_id))


class Handler(SimpleHTTPRequestHandler):
    server_version = "StockSenseBackend/1.0"

    def log_message(self, format: str, *args) -> None:
        server_log(f"{self.client_address[0]} - {format % args}")

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        target = unquote(parsed.path).lstrip("/")
        if not target:
            target = "index.html"
        return str((FRONTEND / target).resolve())

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            return self.json({"ok": True, "database": str(DB_PATH), "time": now_iso()})
        if path == "/api/bootstrap":
            return self.json({"tables": all_tables()})
        if path == "/api/stocks/live":
            return self.stocks_live()
        if path.startswith("/api/reports/") and path.endswith("/download"):
            return self.download_report(path)
        if path.startswith("/api/"):
            return self.error("API route not found", HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/auth/register":
            return self.register()
        if path == "/api/auth/login":
            return self.login()
        if path == "/api/sync":
            return self.sync()
        if path == "/api/sql":
            return self.sql()
        if path.startswith("/api/tables/"):
            table = path.split("/")[-1]
            return self.insert(table)
        return self.error("API route not found", HTTPStatus.NOT_FOUND)

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/tables/"):
            _, _, _, table, row_id = path.split("/", 4)
            return self.update(table, row_id)
        return self.error("API route not found", HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/tables/"):
            _, _, _, table, row_id = path.split("/", 4)
            return self.delete(table, row_id)
        return self.error("API route not found", HTTPStatus.NOT_FOUND)

    def read_json(self) -> dict:
        size = int(self.headers.get("Content-Length", "0") or 0)
        if not size:
            return {}
        return json.loads(self.rfile.read(size).decode("utf-8"))

    def json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error(self, message: str, status: int = 400) -> None:
        self.json({"error": message}, status)

    def current_user(self, conn: sqlite3.Connection) -> dict | None:
        auth = self.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if not token:
            return None
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?",
            (token, now_iso()),
        ).fetchone()
        return clean_user(row) if row else None

    def require_user(self, conn: sqlite3.Connection) -> dict | None:
        user = self.current_user(conn)
        if not user:
            self.error("Please login again.", HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def register(self) -> None:
        data = self.read_json()
        required = ["username", "name", "email", "password", "role"]
        if any(not data.get(k) for k in required):
            return self.error("All registration fields are required.")
        if data["role"] not in {"user", "employee", "admin"}:
            return self.error("Invalid role.")
        with db() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO users(username,password_hash,name,email,role,joined,created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        data["username"].strip().lower(),
                        hash_password(data["password"]),
                        data["name"].strip(),
                        data["email"].strip().lower(),
                        data["role"],
                        today(),
                        now_iso(),
                    ),
                )
                log_activity(conn, f"New account registered: {data['username']}", data["username"])
            except sqlite3.IntegrityError:
                return self.error("Username or email already exists.")
            
            ip_addr = self.client_address[0]
            def _bg_email():
                with db() as c:
                    send_registration_email(c, {
                        "username": data["username"].strip().lower(),
                        "name": data["name"].strip(),
                        "email": data["email"].strip().lower(),
                        "role": data["role"]
                    }, ip_addr)
            threading.Thread(target=_bg_email, daemon=True).start()
        self.json({"tables": all_tables()})

    def login(self) -> None:
        data = self.read_json()
        login_value = (data.get("login") or data.get("username") or "").strip().lower()
        password = data.get("password") or ""
        preferred_role = data.get("role") or "user"
        with db() as conn:
            # Look for matching account by username, email, or full name (case-insensitive)
            # If multiple matching accounts exist, prioritize the requested role
            row = conn.execute(
                """
                SELECT * FROM users 
                WHERE lower(username) = ? OR lower(email) = ? OR lower(name) = ?
                ORDER BY CASE WHEN role = ? THEN 0 ELSE 1 END
                LIMIT 1
                """,
                (login_value, login_value, login_value, preferred_role),
            ).fetchone()

            if not row or not verify_password(password, row["password_hash"]):
                return self.error("Incorrect username/email or password.", HTTPStatus.UNAUTHORIZED)

            token = create_session(conn, row["id"])
            user = clean_user(row)
            actual_role = user.get("role", "user")
            
            # Send login email in the background to avoid blocking the fast login response
            ip_addr = self.client_address[0]
            def _bg_email():
                with db() as c:
                    send_login_email(c, user, login_value, ip_addr)
            threading.Thread(target=_bg_email, daemon=True).start()
            email_status = "queued"
            
            log_activity(conn, f'User "{user["name"]}" ({actual_role}) logged in', user["name"])
        self.json({"token": token, "user": user, "email_status": email_status, "tables": all_tables()})

    def insert(self, table: str) -> None:
        table = table.lower()
        if table not in WRITABLE_TABLES:
            return self.error("Unknown table.", HTTPStatus.NOT_FOUND)
        data = self.read_json()
        with db() as conn:
            user = self.require_user(conn)
            if not user:
                return
            if table in ADMIN_TABLES and user["role"] != "admin":
                return self.error("Admin access required.", HTTPStatus.FORBIDDEN)
            if table == "users":
                data["password_hash"] = hash_password(data.pop("password", "changeme"))
                data.setdefault("joined", today())
            data.setdefault("created_at", now_iso())
            ensure_columns(conn, table, data)
            cols = [k for k in data if k != "id" and k in table_columns(conn, table)]
            vals = [data[k] for k in cols]
            conn.execute(
                f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join(['?'] * len(cols))})",
                vals,
            )
            row_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            if table == "reports":
                generate_report_files(conn, row_id)
            row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
        self.json(clean_user(row) if table == "users" else dict(row))

    def update(self, table: str, row_id: str) -> None:
        table = table.lower()
        if table not in WRITABLE_TABLES:
            return self.error("Unknown table.", HTTPStatus.NOT_FOUND)
        data = self.read_json()
        with db() as conn:
            user = self.require_user(conn)
            if not user:
                return
            if table == "users" and user["role"] != "admin" and str(user["id"]) != str(row_id):
                return self.error("Admin access required.", HTTPStatus.FORBIDDEN)
            if table == "users" and data.get("password"):
                data["password_hash"] = hash_password(data.pop("password"))
            data["updated_at"] = now_iso()
            ensure_columns(conn, table, data)
            cols = [k for k in data if k != "id" and k in table_columns(conn, table)]
            conn.execute(
                f"UPDATE {table} SET {','.join([c + ' = ?' for c in cols])} WHERE id = ?",
                [data[c] for c in cols] + [row_id],
            )
            if table == "reports":
                generate_report_files(conn, int(row_id))
            row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
        self.json(clean_user(row) if table == "users" else dict(row))

    def delete(self, table: str, row_id: str) -> None:
        table = table.lower()
        if table not in WRITABLE_TABLES:
            return self.error("Unknown table.", HTTPStatus.NOT_FOUND)
        with db() as conn:
            user = self.require_user(conn)
            if not user:
                return
            if table in ADMIN_TABLES and user["role"] != "admin":
                return self.error("Admin access required.", HTTPStatus.FORBIDDEN)
            conn.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
        self.json({"ok": True})

    def sync(self) -> None:
        payload = self.read_json()
        tables = payload.get("tables") or {}
        with db() as conn:
            user = self.require_user(conn)
            if not user:
                return
            for table, records in tables.items():
                if table not in WRITABLE_TABLES or table == "users" or not isinstance(records, list):
                    continue
                for record in records:
                    if not isinstance(record, dict):
                        continue
                    record.setdefault("created_at", now_iso())
                    ensure_columns(conn, table, record)
                    cols = [k for k in record if k != "id" and k in table_columns(conn, table)]
                    if record.get("id"):
                        conn.execute(
                            f"UPDATE {table} SET {','.join([c + ' = ?' for c in cols])} WHERE id = ?",
                            [record[c] for c in cols] + [record["id"]],
                        )
                    else:
                        conn.execute(
                            f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join(['?'] * len(cols))})",
                            [record[c] for c in cols],
                        )
        self.json({"ok": True})

    def sql(self) -> None:
        sql = (self.read_json().get("sql") or "").strip()
        with db() as conn:
            user = self.require_user(conn)
            if not user:
                return
            if user["role"] != "admin":
                return self.error("Admin access required.", HTTPStatus.FORBIDDEN)
            if sql.upper() == "SHOW TABLES":
                result = {"columns": ["table_name", "row_count"], "rows": [[t, len(rows(conn, t))] for t in PUBLIC_TABLES]}
                return self.json(result)
            if not sql.lower().startswith("select "):
                return self.error("Only SELECT queries are enabled from the dashboard.")
            try:
                cur = conn.execute(sql)
                result = {"columns": [c[0] for c in cur.description], "rows": [list(r) for r in cur.fetchall()]}
            except sqlite3.Error as e:
                return self.error(str(e))
        self.json(result)

    def stocks_live(self) -> None:
        """Return real-time prices for all stocks currently stored in the DB.
        Response: {prices: {SYMBOL: {price, chg, hi, lo, updated_at}}}
        """
        with db() as conn:
            db_stocks = rows(conn, "stocks")

        # Build exchange map from DB stocks
        sym_exc_map: dict[str, str] = {s["sym"]: s.get("exc", "NSE") for s in db_stocks if s.get("sym")}

        for sym in WELL_KNOWN_NSE:
            sym_exc_map.setdefault(sym, "NSE")

        prices = get_live_prices(sym_exc_map)
        self.json({"prices": prices, "count": len(prices), "yf_available": _YF_AVAILABLE})

    def download_report(self, path: str) -> None:
        parts = path.strip("/").split("/")
        report_id = parts[2] if len(parts) >= 3 else ""
        query = parse_qs(urlparse(self.path).query)
        fmt = (query.get("format") or ["html"])[0]
        with db() as conn:
            report = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
            if not report:
                return self.error("Report not found.", HTTPStatus.NOT_FOUND)
            file_path = Path(report["file_csv"] if fmt == "csv" else report["file_html"])
            if not file_path.exists():
                generate_report_files(conn, int(report_id))
                report = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
                file_path = Path(report["file_csv"] if fmt == "csv" else report["file_html"])
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/csv" if fmt == "csv" else "text/html")
        self.send_header("Content-Disposition", f'attachment; filename="{file_path.name}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    load_env()
    init_db()
    # Start background price updater thread
    threading.Thread(target=_bg_price_updater, daemon=True).start()
    
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    server_log(f"StockSense running on http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
