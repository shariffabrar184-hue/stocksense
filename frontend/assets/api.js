const StockSenseAPI = {
  token: localStorage.getItem('stocksense_token') || '',

  // If running directly on a deployed domain (Render, cloud, etc.) or when served by backend,
  // use relative API paths (''). Only route to localhost:8000 if opened directly via file://
  // or from a local live-reload dev server (e.g. port 5500).
  API_BASE: (function() {
    if (typeof location === 'undefined') return '';
    if (location.protocol === 'file:') return 'http://127.0.0.1:8000';
    const host = location.hostname || '';
    const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(host);
    const port = location.port || '';
    if (isLocalhost && port && port !== '8000' && port !== '10000') {
      return 'http://127.0.0.1:8000';
    }
    return '';
  })(),

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

