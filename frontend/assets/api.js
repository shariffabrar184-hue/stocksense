const StockSenseAPI = {
  token: localStorage.getItem('stocksense_token') || '',

  // Automatically point to the Python backend at port 8000.
  // When served directly from the backend (port 8000), API_BASE is empty (relative URLs).
  // When the page is opened via file:// or a different port (e.g. VS Code Live Server on 5500),
  // we route all API calls to the backend explicitly.
  API_BASE: (location.protocol === 'file:' || location.port !== '8000')
    ? 'http://127.0.0.1:8000'
    : '',

  setToken(token) {
    this.token = token || '';
    if (this.token) localStorage.setItem('stocksense_token', this.token);
    else localStorage.removeItem('stocksense_token');
  },

  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const url = this.API_BASE + path;
    const res = await fetch(url, { ...options, headers });
    const type = res.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const message = body && body.error ? body.error : `Request failed: ${res.status}`;
      throw new Error(message);
    }
    return body;
  },

  bootstrap() {
    return this.request('/api/bootstrap');
  },

  login(payload) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  register(payload) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  insert(table, data) {
    return this.request(`/api/tables/${encodeURIComponent(table)}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  update(table, id, data) {
    return this.request(`/api/tables/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  delete(table, id) {
    return this.request(`/api/tables/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  sql(sql) {
    return this.request('/api/sql', {
      method: 'POST',
      body: JSON.stringify({ sql })
    });
  },

  async refreshTables() {
    const data = await this.bootstrap();
    if (data.token && !this.token) this.setToken(data.token);
    return data.tables || {};
  },

  getLivePrices() {
    return this.request('/api/stocks/live');
  }
};

