// ═══════════════════════════════════════════════════════════
//  DATABASE LAYER — Simulated SQL (SQLite via storage API)
// ═══════════════════════════════════════════════════════════

const DB = {
  tables: {
    users: [],
    stocks: [],
    predictions: [],
    watchlist: [],
    alerts: [],
    reports: [],
    activity_log: []
  },

  async init() {
    try {
      this.tables = { ...this.tables, ...(await StockSenseAPI.refreshTables()) };
      log('SQLite database ready — ' + this.tables.users.length + ' accounts loaded');
    } catch (e) {
      console.error('Backend bootstrap failed', e);
      this.tables.users = [
        { id: 1, username: 'admin', name: 'Abrar shariff', email: 'shariffabrar433@gmail.com', role: 'admin', joined: new Date().toISOString().split('T')[0] },
        { id: 2, username: 'abrar', name: 'Abrar shariff', email: 'shariffabrar184@gmail.com', role: 'admin', joined: new Date().toISOString().split('T')[0] },
        { id: 3, username: 'analyst', name: 'Analyst Kumar', email: 'analyst@stocksense.in', role: 'employee', joined: new Date().toISOString().split('T')[0] },
        { id: 4, username: 'john', name: 'John Doe', email: 'john@example.com', role: 'user', joined: new Date().toISOString().split('T')[0] }
      ];
      log('Backend offline — temporary frontend data loaded');
    }
  },

  async seed() { /* backend handles seed data */ },

  saveUsers() { this.save(); },

  save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      StockSenseAPI.request('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ tables: this.tables })
      }).catch(e => console.warn('SQLite sync failed', e));
    }, 250);
  },

  // SQL-like query execution
  query(sql) {
    const q = sql.trim().toUpperCase();
    const results = [];

    if (q === 'SHOW TABLES') {
      return { columns: ['table_name', 'row_count'], rows: Object.entries(this.tables).map(([k, v]) => [k, v.length]) };
    }

    // Parse SELECT
    const selMatch = sql.match(/SELECT\s+(.*?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.*?))?(?:\s+ORDER BY\s+(.*?))?(?:\s+LIMIT\s+(\d+))?$/is);
    if (selMatch) {
      const [, cols, table, where, orderBy, limit] = selMatch;
      let rows = [...(this.tables[table.toLowerCase()] || [])];

      if (where) {
        const wm = where.match(/(\w+)\s*=\s*['"]?([^'"]+)['"]?/i);
        if (wm) rows = rows.filter(r => String(r[wm[1]]) === String(wm[2]));
      }
      if (orderBy) {
        const [col, dir] = orderBy.trim().split(/\s+/);
        rows.sort((a, b) => {
          const av = a[col.toLowerCase()], bv = b[col.toLowerCase()];
          return dir?.toUpperCase() === 'DESC' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
        });
      }
      if (limit) rows = rows.slice(0, parseInt(limit));

      const columns = cols.trim() === '*' ? (rows[0] ? Object.keys(rows[0]) : []) : cols.split(',').map(c => c.trim().toLowerCase());
      return {
        columns,
        rows: rows.map(r => columns.map(c => r[c] !== undefined ? r[c] : null))
      };
    }

    // Parse DELETE
    const delMatch = sql.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+id\s*=\s*(\d+)/i);
    if (delMatch) {
      const [, table, id] = delMatch;
      const t = this.tables[table.toLowerCase()];
      if (t) { const idx = t.findIndex(r => r.id == id); if (idx > -1) t.splice(idx, 1); }
      this.save();
      return { columns: ['result'], rows: [['Row deleted']] };
    }

    return { columns: ['error'], rows: [['Query not supported in simulation']] };
  },

  // CRUD helpers
  insert(table, data) {
    const t = this.tables[table];
    const maxId = t.length ? Math.max(...t.map(r => r.id || 0)) : 0;
    const row = { id: maxId + 1, ...data, created_at: new Date().toISOString() };
    t.push(row);
    StockSenseAPI.insert(table, data)
      .then(serverRow => Object.assign(row, serverRow))
      .catch(e => { console.warn(`Insert failed for ${table}`, e); this.save(); });
    return row;
  },

  update(table, id, data) {
    const t = this.tables[table];
    const idx = t.findIndex(r => r.id == id);
    if (idx > -1) {
      t[idx] = { ...t[idx], ...data, updated_at: new Date().toISOString() };
      StockSenseAPI.update(table, id, data)
        .then(serverRow => Object.assign(t[idx], serverRow))
        .catch(e => { console.warn(`Update failed for ${table}`, e); this.save(); });
      return t[idx];
    }
    return null;
  },

  delete(table, id) {
    const t = this.tables[table];
    const idx = t.findIndex(r => r.id == id);
    if (idx > -1) {
      t.splice(idx, 1);
      StockSenseAPI.delete(table, id).catch(e => { console.warn(`Delete failed for ${table}`, e); this.save(); });
      return true;
    }
    return false;
  },

  findAll(table, where = {}) {
    return (this.tables[table] || []).filter(r => Object.entries(where).every(([k, v]) => r[k] == v));
  },

  findById(table, id) {
    return (this.tables[table] || []).find(r => r.id == id);
  }
};

// ═══════════════════════════════════════════════════════════
//  STOCK DATA (In-memory; also synced to DB.tables.stocks)
// ═══════════════════════════════════════════════════════════
const BASE_STOCKS = [
  { sym: 'RELIANCE', name: 'Reliance Industries Ltd', exc: 'NSE', sec: 'Energy', price: 2945.3, chg: 1.24, pe: 28.5, hi: 3217, lo: 2220, mc: '19.9L Cr' },
  { sym: 'TCS', name: 'Tata Consultancy Services', exc: 'NSE', sec: 'Technology', price: 4123.5, chg: -0.82, pe: 32.1, hi: 4592, lo: 3198, mc: '15.0L Cr' },
  { sym: 'HDFCBANK', name: 'HDFC Bank Ltd', exc: 'NSE', sec: 'Finance', price: 1756.8, chg: 0.56, pe: 19.8, hi: 1978, lo: 1427, mc: '13.3L Cr' },
  { sym: 'INFY', name: 'Infosys Ltd', exc: 'NSE', sec: 'Technology', price: 1892.45, chg: 1.13, pe: 26.4, hi: 2025, lo: 1351, mc: '7.9L Cr' },
  { sym: 'ICICIBANK', name: 'ICICI Bank Ltd', exc: 'NSE', sec: 'Finance', price: 1243.6, chg: 0.91, pe: 18.2, hi: 1338, lo: 968, mc: '8.7L Cr' },
  { sym: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', exc: 'NSE', sec: 'FMCG', price: 2589.75, chg: -0.45, pe: 58.3, hi: 2892, lo: 2172, mc: '6.1L Cr' },
  { sym: 'BHARTIARTL', name: 'Bharti Airtel Ltd', exc: 'NSE', sec: 'Telecom', price: 1876.2, chg: 2.34, pe: 72.1, hi: 1964, lo: 1117, mc: '11.2L Cr' },
  { sym: 'SBIN', name: 'State Bank of India', exc: 'NSE', sec: 'Finance', price: 834.15, chg: 1.67, pe: 11.2, hi: 912, lo: 543, mc: '7.4L Cr' },
  { sym: 'BAJFINANCE', name: 'Bajaj Finance Ltd', exc: 'NSE', sec: 'Finance', price: 7124.3, chg: -1.23, pe: 35.4, hi: 8192, lo: 6063, mc: '4.3L Cr' },
  { sym: 'WIPRO', name: 'Wipro Ltd', exc: 'NSE', sec: 'Technology', price: 567.4, chg: 0.78, pe: 22.3, hi: 672, lo: 415, mc: '2.9L Cr' },
  { sym: 'TATAMOTORS', name: 'Tata Motors Ltd', exc: 'NSE', sec: 'Auto', price: 1023.85, chg: 2.15, pe: 14.7, hi: 1179, lo: 600, mc: '3.8L Cr' },
  { sym: 'MARUTI', name: 'Maruti Suzuki India Ltd', exc: 'NSE', sec: 'Auto', price: 13456.7, chg: 0.34, pe: 30.2, hi: 14238, lo: 10003, mc: '4.1L Cr' },
  { sym: 'ASIANPAINT', name: 'Asian Paints Ltd', exc: 'NSE', sec: 'Consumer', price: 2834.6, chg: -0.67, pe: 54.1, hi: 3397, lo: 2326, mc: '2.7L Cr' },
  { sym: 'AXISBANK', name: 'Axis Bank Ltd', exc: 'NSE', sec: 'Finance', price: 1187.9, chg: 1.44, pe: 15.6, hi: 1324, lo: 965, mc: '3.6L Cr' },
  { sym: 'SUNPHARMA', name: 'Sun Pharmaceutical', exc: 'NSE', sec: 'Pharma', price: 1823.4, chg: 0.95, pe: 35.7, hi: 2045, lo: 1310, mc: '4.4L Cr' },
  { sym: 'POWERGRID', name: 'Power Grid Corp of India', exc: 'NSE', sec: 'Energy', price: 342.5, chg: 0.82, pe: 18.4, hi: 366, lo: 213, mc: '3.2L Cr' },
  { sym: 'TITAN', name: 'Titan Company Ltd', exc: 'NSE', sec: 'Consumer', price: 3756.85, chg: -0.34, pe: 88.4, hi: 4082, lo: 2972, mc: '3.3L Cr' },
  { sym: 'NTPC', name: 'NTPC Ltd', exc: 'NSE', sec: 'Energy', price: 378.2, chg: 1.05, pe: 19.8, hi: 448, lo: 264, mc: '3.7L Cr' },
  { sym: 'ONGC', name: 'Oil & Natural Gas Corp', exc: 'NSE', sec: 'Energy', price: 296.4, chg: -0.55, pe: 9.2, hi: 329, lo: 191, mc: '3.7L Cr' },
  { sym: 'JSWSTEEL', name: 'JSW Steel Ltd', exc: 'NSE', sec: 'Metals', price: 987.6, chg: 1.78, pe: 16.3, hi: 1075, lo: 697, mc: '2.7L Cr' },
  { sym: 'TECHM', name: 'Tech Mahindra Ltd', exc: 'NSE', sec: 'Technology', price: 1734.2, chg: 0.62, pe: 29.8, hi: 1895, lo: 1173, mc: '1.7L Cr' },
  { sym: 'ULTRACEMCO', name: 'UltraTech Cement Ltd', exc: 'NSE', sec: 'Infra', price: 12034.5, chg: -0.23, pe: 43.1, hi: 13198, lo: 9023, mc: '3.5L Cr' },
  { sym: 'DRREDDY', name: 'Dr Reddys Laboratories', exc: 'NSE', sec: 'Pharma', price: 6723.8, chg: 1.34, pe: 24.5, hi: 7398, lo: 5012, mc: '1.1L Cr' },
  { sym: 'CIPLA', name: 'Cipla Ltd', exc: 'NSE', sec: 'Pharma', price: 1678.9, chg: 0.87, pe: 28.2, hi: 1815, lo: 1214, mc: '1.4L Cr' },
  { sym: 'KOTAKBANK', name: 'Kotak Mahindra Bank', exc: 'NSE', sec: 'Finance', price: 2134.7, chg: -0.91, pe: 23.7, hi: 2308, lo: 1695, mc: '4.2L Cr' },
  { sym: 'HCLTECH', name: 'HCL Technologies Ltd', exc: 'NSE', sec: 'Technology', price: 2023.4, chg: 1.56, pe: 27.1, hi: 2198, lo: 1378, mc: '5.5L Cr' },
  { sym: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd', exc: 'BSE', sec: 'Auto', price: 5872.3, chg: -0.43, pe: 21.4, hi: 6312, lo: 3875, mc: '1.2L Cr' },
  { sym: 'INDUSINDBK', name: 'IndusInd Bank Ltd', exc: 'NSE', sec: 'Finance', price: 1456.8, chg: 2.08, pe: 14.3, hi: 1674, lo: 1012, mc: '1.1L Cr' },
  { sym: 'TATASTEEL', name: 'Tata Steel Ltd', exc: 'NSE', sec: 'Metals', price: 178.45, chg: 0.68, pe: 12.1, hi: 196, lo: 117, mc: '2.2L Cr' },
  { sym: 'COALINDIA', name: 'Coal India Ltd', exc: 'NSE', sec: 'Energy', price: 498.2, chg: 1.23, pe: 9.8, hi: 543, lo: 345, mc: '3.1L Cr' },
  { sym: 'NESTLEIND', name: 'Nestle India Ltd', exc: 'NSE', sec: 'FMCG', price: 23456.7, chg: -0.28, pe: 75.4, hi: 24780, lo: 19876, mc: '2.3L Cr' },
  { sym: 'BAJAJFINSV', name: 'Bajaj Finserv Ltd', exc: 'NSE', sec: 'Finance', price: 1987.3, chg: 0.93, pe: 28.4, hi: 2145, lo: 1589, mc: '3.2L Cr' },
  { sym: 'DIVISLAB', name: 'Divis Laboratories Ltd', exc: 'NSE', sec: 'Pharma', price: 5234.8, chg: 1.67, pe: 52.3, hi: 5678, lo: 3456, mc: '1.4L Cr' },
  { sym: 'DABUR', name: 'Dabur India Ltd', exc: 'NSE', sec: 'FMCG', price: 589.4, chg: -0.72, pe: 45.8, hi: 654, lo: 483, mc: '1.0L Cr' },
  { sym: 'GRASIM', name: 'Grasim Industries Ltd', exc: 'NSE', sec: 'Infra', price: 2678.9, chg: 0.54, pe: 21.3, hi: 2934, lo: 1978, mc: '1.8L Cr' },
  { sym: 'ADANIENT', name: 'Adani Enterprises Ltd', exc: 'NSE', sec: 'Energy', price: 2934.5, chg: 3.12, pe: 85.3, hi: 3892, lo: 1897, mc: '3.3L Cr' },
  { sym: 'APOLLOHOSP', name: 'Apollo Hospitals Enterprise', exc: 'NSE', sec: 'Healthcare', price: 6712.3, chg: 1.45, pe: 64.2, hi: 7234, lo: 5012, mc: '0.96L Cr' },
  { sym: 'TATACONSUM', name: 'Tata Consumer Products', exc: 'NSE', sec: 'FMCG', price: 1234.5, chg: 0.67, pe: 67.3, hi: 1389, lo: 956, mc: '1.1L Cr' },
  { sym: 'PIDILITIND', name: 'Pidilite Industries Ltd', exc: 'NSE', sec: 'Chemicals', price: 3012.7, chg: -0.34, pe: 82.1, hi: 3234, lo: 2456, mc: '1.5L Cr' },
  { sym: 'SIEMENS', name: 'Siemens Ltd', exc: 'NSE', sec: 'Technology', price: 8234.6, chg: 1.23, pe: 67.8, hi: 9012, lo: 5678, mc: '0.29L Cr' },
  { sym: 'ZOMATO', name: 'Zomato Ltd', exc: 'NSE', sec: 'Consumer', price: 267.8, chg: 4.23, pe: 312.4, hi: 304, lo: 128, mc: '2.3L Cr' },
  { sym: 'PAYTM', name: 'One97 Communications', exc: 'NSE', sec: 'Technology', price: 634.2, chg: 2.78, pe: -1, hi: 782, lo: 316, mc: '0.40L Cr' },
  { sym: 'NYKAA', name: 'FSN E-Commerce Ventures', exc: 'NSE', sec: 'Consumer', price: 198.4, chg: 1.56, pe: 187.3, hi: 234, lo: 135, mc: '0.95L Cr' },
  { sym: 'IRCTC', name: 'Indian Railway Catering', exc: 'NSE', sec: 'Consumer', price: 934.2, chg: -0.87, pe: 54.3, hi: 1098, lo: 734, mc: '0.74L Cr' },
  { sym: 'DMART', name: 'Avenue Supermarts Ltd', exc: 'NSE', sec: 'Consumer', price: 4678.3, chg: 0.43, pe: 123.4, hi: 5234, lo: 3678, mc: '3.0L Cr' },
  { sym: 'HDFC', name: 'HDFC Ltd', exc: 'NSE', sec: 'Finance', price: 2945.7, chg: 0.78, pe: 24.3, hi: 3123, lo: 2345, mc: '5.0L Cr' },
  { sym: 'VEDANTA', name: 'Vedanta Ltd', exc: 'NSE', sec: 'Metals', price: 489.3, chg: 2.67, pe: 8.4, hi: 526, lo: 234, mc: '1.9L Cr' },
  { sym: 'HINDALCO', name: 'Hindalco Industries Ltd', exc: 'NSE', sec: 'Metals', price: 723.4, chg: 1.34, pe: 14.2, hi: 812, lo: 487, mc: '1.6L Cr' },
  { sym: 'BANDHANBNK', name: 'Bandhan Bank Ltd', exc: 'NSE', sec: 'Finance', price: 234.8, chg: -1.23, pe: 11.3, hi: 278, lo: 176, mc: '0.38L Cr' },
  { sym: 'LUPIN', name: 'Lupin Ltd', exc: 'NSE', sec: 'Pharma', price: 2034.5, chg: 0.89, pe: 34.2, hi: 2198, lo: 1456, mc: '0.93L Cr' },
  { sym: 'MINDA', name: 'Minda Pharmaceuticals Ltd', exc: 'NSE', sec: 'Pharma', price: 467.57, chg: -2.27, pe: 103.1, hi: 657.81, lo: 294.77, mc: '155.95L Cr' },
  { sym: 'MAHINDRA', name: 'Mahindra Petroleum Ltd', exc: 'NSE', sec: 'Energy', price: 807.5, chg: -2.51, pe: 84.0, hi: 919.08, lo: 651.04, mc: '214.85L Cr' },
  { sym: 'CEAT', name: 'CEAT Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3094.42, chg: -2.95, pe: 53.8, hi: 3363.94, lo: 1961.4, mc: '31876.19L Cr' },
  { sym: 'SOLARA', name: 'Solara Defence Ltd', exc: 'NSE', sec: 'Defence', price: 3189.2, chg: 5.23, pe: 85.0, hi: 4406.71, lo: 2603.92, mc: '31967.94L Cr' },
  { sym: 'VOLTAS', name: 'Voltas Consumer Goods Ltd', exc: 'NSE', sec: 'FMCG', price: 1336.44, chg: 5.35, pe: 130.6, hi: 1606.47, lo: 1013.95, mc: '3813.40L Cr' },
  { sym: 'PFC', name: 'PFC Steel Ltd', exc: 'NSE', sec: 'Metals', price: 830.6, chg: 1.59, pe: 110.7, hi: 926.42, lo: 608.67, mc: '10579.52L Cr' },
  { sym: 'ADANITOT', name: 'Adani Total Motors Ltd', exc: 'NSE', sec: 'Auto', price: 10426.91, chg: -2.21, pe: -1, hi: 12263.94, lo: 7233.24, mc: '41588.86L Cr' },
  { sym: 'GUJARATF', name: 'Gujarat Fluorochemicals Apparel Ltd', exc: 'BSE', sec: 'Textiles', price: 190.57, chg: 4.35, pe: 25.7, hi: 210.74, lo: 164.03, mc: '1540.41L Cr' },
  { sym: 'MANAPPUR', name: 'Manappuram Builders Ltd', exc: 'BSE', sec: 'Infra', price: 1905.68, chg: 0.44, pe: 129.9, hi: 2117.47, lo: 1250.11, mc: '15576.55L Cr' },
  { sym: 'AARTI', name: 'Aarti Builders Ltd', exc: 'BSE', sec: 'Infra', price: 3040.06, chg: -1.99, pe: 141.7, hi: 4019.3, lo: 1945.92, mc: '40531.03L Cr' },
  { sym: 'TATASTEE', name: 'Tata Steel Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1334.66, chg: 0.04, pe: 132.0, hi: 1542.01, lo: 1034.64, mc: '4366.31L Cr' },
  { sym: 'DIVI', name: 'Divi Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 2127.92, chg: -2.51, pe: 28.4, hi: 3045.9, lo: 1963.76, mc: '23570.33L Cr' },
  { sym: 'SHREECEM', name: 'Shree Cement Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 490.18, chg: -2.11, pe: 87.3, hi: 530.13, lo: 419.68, mc: '7826.49L Cr' },
  { sym: 'ALKYL', name: 'Alkyl Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 2361.68, chg: -1.85, pe: 66.4, hi: 2679.84, lo: 1862.78, mc: '7211.90L Cr' },
  { sym: 'COCHINSH', name: 'Cochin Shipyard Commerce Ltd', exc: 'BSE', sec: 'Consumer', price: 2986.18, chg: -0.12, pe: 22.5, hi: 3403.88, lo: 2145.06, mc: '8358.72L Cr' },
  { sym: 'DATAPATT', name: 'Data Patterns Power Ltd', exc: 'NSE', sec: 'Energy', price: 199.39, chg: -2.21, pe: 129.6, hi: 215.01, lo: 136.24, mc: '592.64L Cr' },
  { sym: 'ALKYL67', name: 'Alkyl Health Ltd', exc: 'BSE', sec: 'Healthcare', price: 1123.39, chg: -2.6, pe: -1, hi: 1373.25, lo: 840.58, mc: '7683.01L Cr' },
  { sym: 'NHPC', name: 'NHPC Drugs Ltd', exc: 'NSE', sec: 'Pharma', price: 706.1, chg: 3.51, pe: 32.8, hi: 892.87, lo: 458.3, mc: '1215.39L Cr' },
  { sym: 'SEQUENT', name: 'Sequent Chemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 1662.33, chg: -3.99, pe: 126.2, hi: 2389.76, lo: 1536.37, mc: '4928.35L Cr' },
  { sym: 'JKCEMENT', name: 'JK Cement Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 663.37, chg: -2.85, pe: -1, hi: 800.14, lo: 613.14, mc: '3046.20L Cr' },
  { sym: 'VARROC', name: 'Varroc FMCG Ltd', exc: 'BSE', sec: 'FMCG', price: 3222.72, chg: 5.19, pe: 83.6, hi: 4348.06, lo: 1998.11, mc: '19127.73L Cr' },
  { sym: 'LAURUS', name: 'Laurus Chemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 387.7, chg: 4.01, pe: -1, hi: 417.62, lo: 349.56, mc: '2952.03L Cr' },
  { sym: 'BAJAJ', name: 'Bajaj Housing Ltd', exc: 'NSE', sec: 'Realty', price: 599.97, chg: -3.68, pe: 87.0, hi: 705.89, lo: 414.74, mc: '2580.63L Cr' },
  { sym: 'BHARATFO', name: 'Bharat Forge Commerce Ltd', exc: 'BSE', sec: 'Consumer', price: 523.0, chg: 0.07, pe: 140.7, hi: 551.1, lo: 427.5, mc: '642.03L Cr' },
  { sym: 'LAL', name: 'Lal Vehicles Ltd', exc: 'NSE', sec: 'Auto', price: 7835.33, chg: 4.31, pe: 58.6, hi: 8721.5, lo: 6987.63, mc: '67879.50L Cr' },
  { sym: 'SEQUEN76', name: 'Sequent Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3003.59, chg: 4.82, pe: 132.3, hi: 3471.51, lo: 2737.47, mc: '7310.64L Cr' },
  { sym: 'CROMPTON', name: 'Crompton Commerce Ltd', exc: 'NSE', sec: 'Consumer', price: 3644.54, chg: 0.55, pe: 136.7, hi: 3900.82, lo: 2995.81, mc: '3243.33L Cr' },
  { sym: 'AMARA', name: 'Amara Metals Ltd', exc: 'NSE', sec: 'Metals', price: 793.57, chg: 2.91, pe: 67.0, hi: 836.32, lo: 497.04, mc: '12683.89L Cr' },
  { sym: 'GLOBALHE', name: 'Global Health Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 12601.63, chg: -0.2, pe: -1, hi: 15069.79, lo: 11676.43, mc: '12127.92L Cr' },
  { sym: 'GARDENRE', name: 'Garden Reach Steel Ltd', exc: 'NSE', sec: 'Metals', price: 843.91, chg: -0.96, pe: 131.8, hi: 1214.84, lo: 727.72, mc: '3818.49L Cr' },
  { sym: 'MAHIND81', name: 'Mahindra Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 6217.35, chg: 2.87, pe: 140.0, hi: 8523.33, lo: 5610.68, mc: '27640.21L Cr' },
  { sym: 'GODREJ', name: 'Godrej Systems Ltd', exc: 'NSE', sec: 'Defence', price: 2147.63, chg: -2.28, pe: 71.7, hi: 2517.19, lo: 1886.42, mc: '327.34L Cr' },
  { sym: 'ESSAR', name: 'Essar Utilities Ltd', exc: 'BSE', sec: 'Energy', price: 447.65, chg: -0.99, pe: 103.5, hi: 621.1, lo: 320.47, mc: '220.85L Cr' },
  { sym: 'AMARA84', name: 'Amara Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 2986.83, chg: -3.42, pe: 110.6, hi: 3510.93, lo: 2425.82, mc: '11961.52L Cr' },
  { sym: 'HUDCO', name: 'HUDCO Developers Ltd', exc: 'NSE', sec: 'Realty', price: 291.99, chg: -4.48, pe: 83.1, hi: 390.62, lo: 251.02, mc: '1451.67L Cr' },
  { sym: 'MAZAGOND', name: 'Mazagon Dock Bank Ltd', exc: 'BSE', sec: 'Finance', price: 1284.0, chg: 2.7, pe: 49.8, hi: 1557.95, lo: 951.24, mc: '1033.91L Cr' },
  { sym: 'DLF', name: 'DLF Builders Ltd', exc: 'BSE', sec: 'Infra', price: 3434.99, chg: 1.19, pe: 125.9, hi: 4024.26, lo: 2313.69, mc: '32965.31L Cr' },
  { sym: 'MISHRADH', name: 'Mishra Dhatu Metals Ltd', exc: 'BSE', sec: 'Metals', price: 431.1, chg: 0.61, pe: 144.2, hi: 579.56, lo: 358.07, mc: '1634.61L Cr' },
  { sym: 'GUJARATA', name: 'Gujarat Adani Real Estate Ltd', exc: 'BSE', sec: 'Realty', price: 110.97, chg: 2.23, pe: 33.9, hi: 117.6, lo: 76.09, mc: '898.14L Cr' },
  { sym: 'DATAPA90', name: 'Data Patterns Investments Ltd', exc: 'BSE', sec: 'Finance', price: 887.44, chg: -2.56, pe: 76.7, hi: 1018.42, lo: 736.24, mc: '80.80L Cr' },
  { sym: 'WHIRLPOO', name: 'Whirlpool Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 3335.26, chg: 3.54, pe: 72.4, hi: 4245.66, lo: 3072.16, mc: '1153.73L Cr' },
  { sym: 'JSW', name: 'JSW Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1915.07, chg: 3.81, pe: 135.1, hi: 2580.48, lo: 1467.2, mc: '2532.79L Cr' },
  { sym: 'GRANULES', name: 'Granules Labs Ltd', exc: 'BSE', sec: 'Pharma', price: 3887.62, chg: 1.77, pe: 16.2, hi: 4526.32, lo: 2702.29, mc: '13555.92L Cr' },
  { sym: 'REC', name: 'REC Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 1926.33, chg: 2.56, pe: -1, hi: 2336.71, lo: 1521.63, mc: '3442.62L Cr' },
  { sym: 'GLOBAL95', name: 'Global Health Infrastructure Ltd', exc: 'BSE', sec: 'Infra', price: 4538.47, chg: 4.07, pe: 60.2, hi: 4776.1, lo: 3281.84, mc: '58479.22L Cr' },
  { sym: 'SJVN', name: 'SJVN Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 1414.82, chg: 3.5, pe: 75.8, hi: 1640.02, lo: 1089.38, mc: '7402.04L Cr' },
  { sym: 'AARTI97', name: 'Aarti Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 3172.54, chg: 5.31, pe: 136.5, hi: 4082.29, lo: 2639.71, mc: '2326.08L Cr' },
  { sym: 'AMARA98', name: 'Amara Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 577.06, chg: -1.23, pe: 53.9, hi: 808.96, lo: 402.44, mc: '4691.58L Cr' },
  { sym: 'ADANIPOR', name: 'Adani Ports Materials Ltd', exc: 'NSE', sec: 'Chemicals', price: 1752.01, chg: -3.98, pe: 37.5, hi: 1887.7, lo: 1638.22, mc: '58.13L Cr' },
  { sym: 'MFAC', name: 'MFAC Energy Ltd', exc: 'NSE', sec: 'Energy', price: 1274.92, chg: -2.11, pe: 21.6, hi: 1821.99, lo: 972.46, mc: '2455.08L Cr' },
  { sym: 'INDIABUL', name: 'Indiabulls Properties Ltd', exc: 'NSE', sec: 'Realty', price: 788.9, chg: -3.42, pe: -1, hi: 926.79, lo: 660.37, mc: '6087.99L Cr' },
  { sym: 'REC3', name: 'REC FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 2084.71, chg: -3.48, pe: 128.3, hi: 2689.62, lo: 1339.15, mc: '32193.60L Cr' },
  { sym: 'ESSAR4', name: 'Essar Minerals Ltd', exc: 'BSE', sec: 'Metals', price: 615.68, chg: 1.98, pe: -1, hi: 749.91, lo: 475.04, mc: '1968.78L Cr' },
  { sym: 'TATAST5', name: 'Tata Steel Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 447.8, chg: 2.84, pe: 44.2, hi: 614.95, lo: 353.03, mc: '1911.59L Cr' },
  { sym: 'SYMPHONY', name: 'Symphony Foods Ltd', exc: 'BSE', sec: 'FMCG', price: 6547.75, chg: -1.71, pe: 113.8, hi: 8367.63, lo: 5459.95, mc: '22020.07L Cr' },
  { sym: 'GOODYEAR', name: 'Goodyear Alloys Ltd', exc: 'NSE', sec: 'Metals', price: 626.06, chg: -1.1, pe: 106.7, hi: 726.55, lo: 377.86, mc: '1124.88L Cr' },
  { sym: 'ADANIGRE', name: 'Adani Green FMCG Ltd', exc: 'BSE', sec: 'FMCG', price: 9848.27, chg: 2.41, pe: 76.2, hi: 13464.29, lo: 6229.71, mc: '30382.11L Cr' },
  { sym: 'STRIDES', name: 'Strides Commerce Ltd', exc: 'BSE', sec: 'Consumer', price: 1498.79, chg: -0.24, pe: 53.0, hi: 1995.1, lo: 1041.39, mc: '976.99L Cr' },
  { sym: 'SOLARA10', name: 'Solara Energy Ltd', exc: 'BSE', sec: 'Energy', price: 213.9, chg: -2.58, pe: 45.1, hi: 275.04, lo: 185.25, mc: '2504.66L Cr' },
  { sym: 'SHREEC11', name: 'Shree Cement Petrochemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 1177.61, chg: -1.48, pe: 23.4, hi: 1257.93, lo: 729.04, mc: '6507.49L Cr' },
  { sym: 'BIRLA', name: 'Birla Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 737.29, chg: -1.66, pe: 54.4, hi: 1058.9, lo: 507.53, mc: '1562.38L Cr' },
  { sym: 'JUPITER', name: 'Jupiter Securities Ltd', exc: 'BSE', sec: 'Finance', price: 1034.32, chg: 2.36, pe: 122.6, hi: 1478.72, lo: 651.43, mc: '2892.31L Cr' },
  { sym: 'AMBUJA', name: 'Ambuja Projects Ltd', exc: 'NSE', sec: 'Infra', price: 6250.41, chg: 4.59, pe: 90.3, hi: 7635.08, lo: 4994.2, mc: '7288.35L Cr' },
  { sym: 'AMARA15', name: 'Amara Securities Ltd', exc: 'NSE', sec: 'Finance', price: 1932.72, chg: -3.69, pe: 85.0, hi: 2150.37, lo: 1435.97, mc: '12665.97L Cr' },
  { sym: 'BOSCH', name: 'Bosch Infotech Ltd', exc: 'NSE', sec: 'Technology', price: 2660.79, chg: 4.1, pe: -1, hi: 3042.27, lo: 1842.85, mc: '25010.23L Cr' },
  { sym: 'GLAND', name: 'Gland Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 2275.42, chg: 1.98, pe: 124.9, hi: 2454.19, lo: 1497.39, mc: '10531.58L Cr' },
  { sym: 'AARTI18', name: 'Aarti Properties Ltd', exc: 'BSE', sec: 'Realty', price: 373.76, chg: 2.5, pe: 77.6, hi: 466.27, lo: 234.78, mc: '131.99L Cr' },
  { sym: 'VOLTAS19', name: 'Voltas Minerals Ltd', exc: 'BSE', sec: 'Metals', price: 81.73, chg: 1.37, pe: -1, hi: 110.82, lo: 72.54, mc: '721.29L Cr' },
  { sym: 'JSW20', name: 'JSW Medical Ltd', exc: 'BSE', sec: 'Healthcare', price: 2172.06, chg: -2.69, pe: 97.0, hi: 2707.89, lo: 1372.6, mc: '5143.83L Cr' },
  { sym: 'MRF', name: 'MRF Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 6046.81, chg: 2.44, pe: 142.1, hi: 8316.94, lo: 4792.3, mc: '17687.63L Cr' },
  { sym: 'JKCEME22', name: 'JK Cement Minerals Ltd', exc: 'NSE', sec: 'Metals', price: 1166.61, chg: 3.75, pe: -1, hi: 1630.63, lo: 888.6, mc: '667.53L Cr' },
  { sym: 'ADANIG23', name: 'Adani Green Realty Ltd', exc: 'BSE', sec: 'Realty', price: 515.31, chg: -2.46, pe: 139.5, hi: 631.38, lo: 435.12, mc: '1222.58L Cr' },
  { sym: 'SUPRAJIT', name: 'Suprajit Housing Ltd', exc: 'NSE', sec: 'Realty', price: 724.29, chg: -4.36, pe: 37.6, hi: 1004.27, lo: 463.34, mc: '8934.47L Cr' },
  { sym: 'VARROC25', name: 'Varroc Diagnostics Ltd', exc: 'BSE', sec: 'Healthcare', price: 3744.08, chg: 2.55, pe: 75.0, hi: 4638.5, lo: 2845.03, mc: '2158.53L Cr' },
  { sym: 'MINDA26', name: 'Minda Developers Ltd', exc: 'NSE', sec: 'Realty', price: 870.83, chg: -1.1, pe: 43.7, hi: 915.27, lo: 743.79, mc: '8520.85L Cr' },
  { sym: 'WELSPUN', name: 'Welspun Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 4359.99, chg: 0.34, pe: 115.6, hi: 5235.84, lo: 4039.52, mc: '74391.41L Cr' },
  { sym: 'ADANIWIL', name: 'Adani Wilmar Electric Ltd', exc: 'BSE', sec: 'Energy', price: 341.59, chg: -4.06, pe: 107.3, hi: 469.54, lo: 251.11, mc: '3730.50L Cr' },
  { sym: 'LAL29', name: 'Lal Diagnostics Ltd', exc: 'BSE', sec: 'Healthcare', price: 3866.33, chg: 5.15, pe: 19.6, hi: 5366.53, lo: 2454.73, mc: '1773.79L Cr' },
  { sym: 'HDIL', name: 'HDIL Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 3509.55, chg: 0.19, pe: 54.1, hi: 4657.46, lo: 2903.95, mc: '51051.02L Cr' },
  { sym: 'DATAPA31', name: 'Data Patterns Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 2392.23, chg: 4.22, pe: -1, hi: 2577.31, lo: 1963.8, mc: '43951.09L Cr' },
  { sym: 'EMAMI', name: 'Emami Foods Ltd', exc: 'NSE', sec: 'FMCG', price: 10962.49, chg: -0.06, pe: 136.0, hi: 11712.28, lo: 9632.19, mc: '24541.72L Cr' },
  { sym: 'YATHARTH', name: 'Yatharth Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 3905.7, chg: -2.8, pe: -1, hi: 5461.48, lo: 3190.56, mc: '17215.79L Cr' },
  { sym: 'EXIDE', name: 'Exide Health Ltd', exc: 'NSE', sec: 'Healthcare', price: 3443.59, chg: -1.95, pe: -1, hi: 4724.1, lo: 3152.34, mc: '7767.26L Cr' },
  { sym: 'ENDURANC', name: 'Endurance Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1979.01, chg: 2.4, pe: 48.8, hi: 2869.07, lo: 1778.47, mc: '1642.84L Cr' },
  { sym: 'VARROC36', name: 'Varroc Steel Ltd', exc: 'BSE', sec: 'Metals', price: 893.86, chg: 5.28, pe: 44.8, hi: 1140.9, lo: 750.87, mc: '779.64L Cr' },
  { sym: 'BOSCH37', name: 'Bosch Real Estate Ltd', exc: 'BSE', sec: 'Realty', price: 672.96, chg: 1.57, pe: 97.3, hi: 873.74, lo: 563.41, mc: '6430.43L Cr' },
  { sym: 'DATAPA38', name: 'Data Patterns Chemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 2273.22, chg: -1.41, pe: 89.0, hi: 3052.81, lo: 1435.64, mc: '10074.86L Cr' },
  { sym: 'GLAND39', name: 'Gland Medical Ltd', exc: 'NSE', sec: 'Healthcare', price: 1272.25, chg: 0.81, pe: 125.4, hi: 1466.63, lo: 1130.57, mc: '9917.10L Cr' },
  { sym: 'AARTI40', name: 'Aarti Foods Ltd', exc: 'BSE', sec: 'FMCG', price: 16114.02, chg: -3.09, pe: 129.7, hi: 21587.74, lo: 15195.2, mc: '251429.20L Cr' },
  { sym: 'BIRLA41', name: 'Birla Alloys Ltd', exc: 'NSE', sec: 'Metals', price: 965.56, chg: 0.87, pe: 102.6, hi: 1273.51, lo: 776.89, mc: '14944.68L Cr' },
  { sym: 'MFAC42', name: 'MFAC Investments Ltd', exc: 'NSE', sec: 'Finance', price: 1493.71, chg: -1.22, pe: 98.9, hi: 1948.04, lo: 1138.94, mc: '13674.13L Cr' },
  { sym: 'GODREJ43', name: 'Godrej Financial Ltd', exc: 'NSE', sec: 'Finance', price: 279.24, chg: 5.46, pe: 39.0, hi: 353.24, lo: 205.53, mc: '1969.86L Cr' },
  { sym: 'NHPC44', name: 'NHPC FMCG Ltd', exc: 'BSE', sec: 'FMCG', price: 11808.71, chg: 4.35, pe: 125.9, hi: 15307.17, lo: 10966.38, mc: '45868.65L Cr' },
  { sym: 'BLUESTAR', name: 'Blue Star Utilities Ltd', exc: 'BSE', sec: 'Energy', price: 578.06, chg: -3.51, pe: 83.9, hi: 833.06, lo: 419.4, mc: '911.66L Cr' },
  { sym: 'ORIENT', name: 'Orient Securities Ltd', exc: 'BSE', sec: 'Finance', price: 274.18, chg: 1.89, pe: 12.3, hi: 324.47, lo: 259.4, mc: '919.98L Cr' },
  { sym: 'HEIDELBE', name: 'HeidelbergCement Petrochemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 2135.06, chg: -1.21, pe: 135.6, hi: 2244.23, lo: 1922.5, mc: '859.42L Cr' },
  { sym: 'MAHIND48', name: 'Mahindra Retail Ltd', exc: 'NSE', sec: 'Consumer', price: 727.65, chg: -4.35, pe: 39.5, hi: 858.27, lo: 480.97, mc: '572.71L Cr' },
  { sym: 'ALKYL49', name: 'Alkyl Auto Ltd', exc: 'NSE', sec: 'Auto', price: 11312.15, chg: 3.28, pe: 20.8, hi: 14157.56, lo: 10530.43, mc: '7790.53L Cr' },
  { sym: 'MAHIND50', name: 'Mahindra Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1226.4, chg: 5.49, pe: 66.8, hi: 1340.68, lo: 1041.63, mc: '9800.85L Cr' },
  { sym: 'MINDA51', name: 'Minda Minerals Ltd', exc: 'NSE', sec: 'Metals', price: 153.56, chg: 1.83, pe: 52.2, hi: 222.33, lo: 120.65, mc: '849.64L Cr' },
  { sym: 'COCHIN52', name: 'Cochin Shipyard Investments Ltd', exc: 'NSE', sec: 'Finance', price: 2580.46, chg: 2.71, pe: 70.5, hi: 2945.33, lo: 1854.39, mc: '9878.75L Cr' },
  { sym: 'GARDEN53', name: 'Garden Reach Financial Ltd', exc: 'BSE', sec: 'Finance', price: 910.85, chg: -0.76, pe: 138.8, hi: 980.85, lo: 811.68, mc: '180.22L Cr' },
  { sym: 'RAINBOWC', name: 'Rainbow Children Foods Ltd', exc: 'BSE', sec: 'FMCG', price: 16263.62, chg: 1.36, pe: 52.8, hi: 17871.97, lo: 11770.95, mc: '162955.60L Cr' },
  { sym: 'HAL', name: 'HAL Paints Ltd', exc: 'NSE', sec: 'Chemicals', price: 3395.72, chg: -0.98, pe: 35.8, hi: 4457.54, lo: 2303.95, mc: '6250.16L Cr' },
  { sym: 'JUPITE56', name: 'Jupiter Metals Ltd', exc: 'NSE', sec: 'Metals', price: 934.12, chg: 3.57, pe: 146.3, hi: 1286.63, lo: 761.07, mc: '432.27L Cr' },
  { sym: 'MOTHERSO', name: 'Motherson Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 95.06, chg: 4.72, pe: 31.3, hi: 105.26, lo: 78.91, mc: '99.03L Cr' },
  { sym: 'ORIENT58', name: 'Orient Digital Ltd', exc: 'NSE', sec: 'Technology', price: 6095.84, chg: -0.3, pe: 58.7, hi: 8160.13, lo: 5314.92, mc: '6514.64L Cr' },
  { sym: 'MFAC59', name: 'MFAC Tech Ltd', exc: 'NSE', sec: 'Technology', price: 1680.57, chg: 2.24, pe: 101.0, hi: 2091.07, lo: 1268.35, mc: '6963.28L Cr' },
  { sym: 'BOSCH60', name: 'Bosch Securities Ltd', exc: 'BSE', sec: 'Finance', price: 916.84, chg: 2.28, pe: 101.7, hi: 979.34, lo: 676.94, mc: '193.60L Cr' },
  { sym: 'ADANIG61', name: 'Adani Green Commerce Ltd', exc: 'NSE', sec: 'Consumer', price: 3883.28, chg: -1.61, pe: 77.1, hi: 4746.39, lo: 2505.55, mc: '9840.91L Cr' },
  { sym: 'SJVN62', name: 'SJVN Motors Ltd', exc: 'BSE', sec: 'Auto', price: 1236.08, chg: -0.14, pe: 16.3, hi: 1452.67, lo: 927.37, mc: '6440.84L Cr' },
  { sym: 'APOLLOTY', name: 'Apollo Tyres Retail Ltd', exc: 'NSE', sec: 'Consumer', price: 2144.16, chg: 3.51, pe: 125.6, hi: 3040.22, lo: 1352.63, mc: '9086.37L Cr' },
  { sym: 'RAMCO', name: 'Ramco Properties Ltd', exc: 'BSE', sec: 'Realty', price: 438.21, chg: 2.96, pe: 118.0, hi: 473.51, lo: 360.05, mc: '939.62L Cr' },
  { sym: 'HEIDEL65', name: 'HeidelbergCement Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 2053.3, chg: -2.14, pe: 33.6, hi: 2650.73, lo: 1778.31, mc: '4991.44L Cr' },
  { sym: 'YATHAR66', name: 'Yatharth Systems Ltd', exc: 'NSE', sec: 'Defence', price: 2391.86, chg: 2.31, pe: 98.2, hi: 3455.31, lo: 1705.69, mc: '15002.09L Cr' },
  { sym: 'DATAPA67', name: 'Data Patterns Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 1097.17, chg: 3.46, pe: 56.0, hi: 1184.59, lo: 835.62, mc: '313.46L Cr' },
  { sym: 'TORRENT', name: 'Torrent Products Ltd', exc: 'NSE', sec: 'Consumer', price: 3294.4, chg: 1.44, pe: 89.1, hi: 4716.57, lo: 2828.65, mc: '2488.28L Cr' },
  { sym: 'ALKYL69', name: 'Alkyl Housing Ltd', exc: 'NSE', sec: 'Realty', price: 355.45, chg: -2.99, pe: -1, hi: 387.94, lo: 325.13, mc: '1752.65L Cr' },
  { sym: 'HUDCO70', name: 'HUDCO Auto Ltd', exc: 'NSE', sec: 'Auto', price: 1067.56, chg: 5.41, pe: 93.4, hi: 1276.33, lo: 983.52, mc: '6429.96L Cr' },
  { sym: 'BHARAT71', name: 'Bharat Forge Drugs Ltd', exc: 'NSE', sec: 'Pharma', price: 5587.82, chg: -3.84, pe: -1, hi: 7383.48, lo: 3908.41, mc: '53392.10L Cr' },
  { sym: 'GLOBAL72', name: 'Global Health Fabrics Ltd', exc: 'NSE', sec: 'Textiles', price: 333.35, chg: 4.67, pe: 100.1, hi: 438.31, lo: 215.06, mc: '443.71L Cr' },
  { sym: 'MRF73', name: 'MRF Automobiles Ltd', exc: 'BSE', sec: 'Auto', price: 7864.52, chg: 2.2, pe: 112.1, hi: 10413.93, lo: 6167.65, mc: '43621.65L Cr' },
  { sym: 'SOBHA', name: 'Sobha Metals Ltd', exc: 'NSE', sec: 'Metals', price: 486.11, chg: -1.08, pe: 32.8, hi: 704.85, lo: 318.03, mc: '2275.23L Cr' },
  { sym: 'ADANIT75', name: 'Adani Total Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 10097.97, chg: 1.47, pe: 31.2, hi: 13401.4, lo: 8266.8, mc: '131986.96L Cr' },
  { sym: 'NLC', name: 'NLC Systems Ltd', exc: 'BSE', sec: 'Technology', price: 2012.21, chg: 5.2, pe: 114.1, hi: 2743.69, lo: 1372.13, mc: '9312.11L Cr' },
  { sym: 'PURAVANK', name: 'Puravankara Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3711.92, chg: 2.28, pe: 68.9, hi: 5039.95, lo: 3238.07, mc: '15855.57L Cr' },
  { sym: 'MANAPP78', name: 'Manappuram Medical Ltd', exc: 'NSE', sec: 'Healthcare', price: 5688.31, chg: -3.98, pe: 58.8, hi: 8098.55, lo: 4829.32, mc: '7835.15L Cr' },
  { sym: 'LAURUS79', name: 'Laurus Finance Ltd', exc: 'NSE', sec: 'Finance', price: 927.46, chg: 3.81, pe: -1, hi: 1311.62, lo: 821.59, mc: '15280.68L Cr' },
  { sym: 'ACC', name: 'ACC Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 3292.34, chg: -0.64, pe: -1, hi: 3752.66, lo: 2342.63, mc: '4702.85L Cr' },
  { sym: 'BOSCH81', name: 'Bosch Mining Ltd', exc: 'NSE', sec: 'Metals', price: 234.11, chg: 2.46, pe: 107.3, hi: 287.82, lo: 140.9, mc: '98.26L Cr' },
  { sym: 'NHPC82', name: 'NHPC Materials Ltd', exc: 'NSE', sec: 'Chemicals', price: 2011.05, chg: 0.78, pe: 46.8, hi: 2353.85, lo: 1240.24, mc: '13449.71L Cr' },
  { sym: 'GUJARA83', name: 'Gujarat Fluorochemicals Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 488.46, chg: 1.82, pe: 109.2, hi: 569.79, lo: 293.34, mc: '1983.54L Cr' },
  { sym: 'SHREEC84', name: 'Shree Cement Hospitals Ltd', exc: 'NSE', sec: 'Healthcare', price: 3855.0, chg: 5.03, pe: 119.0, hi: 4830.5, lo: 2340.44, mc: '3575.63L Cr' },
  { sym: 'TATA', name: 'Tata Cement Ltd', exc: 'BSE', sec: 'Infra', price: 1380.2, chg: 3.39, pe: 111.3, hi: 1796.06, lo: 1200.81, mc: '6884.87L Cr' },
  { sym: 'HEIDEL86', name: 'HeidelbergCement Infotech Ltd', exc: 'BSE', sec: 'Technology', price: 2866.26, chg: -2.75, pe: 72.4, hi: 3806.84, lo: 2353.51, mc: '3371.62L Cr' },
  { sym: 'HAVELLS', name: 'Havells Defence Ltd', exc: 'NSE', sec: 'Defence', price: 1110.95, chg: 3.41, pe: 50.8, hi: 1304.29, lo: 821.41, mc: '8673.21L Cr' },
  { sym: 'ADANIW88', name: 'Adani Wilmar Tech Ltd', exc: 'NSE', sec: 'Technology', price: 2645.83, chg: 4.16, pe: 23.0, hi: 3167.61, lo: 2411.2, mc: '35236.59L Cr' },
  { sym: 'GUJARA89', name: 'Gujarat Fluorochemicals Projects Ltd', exc: 'BSE', sec: 'Infra', price: 4872.56, chg: -0.83, pe: 43.7, hi: 5277.2, lo: 3647.48, mc: '41787.15L Cr' },
  { sym: 'WOCKHARD', name: 'Wockhardt Medical Ltd', exc: 'BSE', sec: 'Healthcare', price: 1420.6, chg: 2.11, pe: 92.4, hi: 1733.77, lo: 1195.32, mc: '519.18L Cr' },
  { sym: 'TATAST91', name: 'Tata Steel Paints Ltd', exc: 'BSE', sec: 'Chemicals', price: 1594.9, chg: 1.89, pe: 13.3, hi: 2102.83, lo: 1183.69, mc: '12319.92L Cr' },
  { sym: 'BEL', name: 'BEL Health Ltd', exc: 'NSE', sec: 'Healthcare', price: 1342.34, chg: -4.15, pe: -1, hi: 1827.47, lo: 977.51, mc: '5879.59L Cr' },
  { sym: 'ACC93', name: 'ACC Properties Ltd', exc: 'NSE', sec: 'Realty', price: 695.11, chg: -0.06, pe: -1, hi: 768.15, lo: 506.34, mc: '1250.94L Cr' },
  { sym: 'GUJARA94', name: 'Gujarat Fluorochemicals Investments Ltd', exc: 'NSE', sec: 'Finance', price: 2246.67, chg: -0.63, pe: 43.0, hi: 2592.92, lo: 1698.92, mc: '13105.17L Cr' },
  { sym: 'MANAPP95', name: 'Manappuram Textiles Ltd', exc: 'BSE', sec: 'Textiles', price: 184.09, chg: 0.02, pe: 69.5, hi: 199.76, lo: 154.39, mc: '1016.16L Cr' },
  { sym: 'VARROC96', name: 'Varroc Alloys Ltd', exc: 'NSE', sec: 'Metals', price: 696.0, chg: 4.01, pe: 139.5, hi: 908.34, lo: 610.94, mc: '922.14L Cr' },
  { sym: 'GUJARA97', name: 'Gujarat Fluorochemicals Power Ltd', exc: 'NSE', sec: 'Energy', price: 431.43, chg: -0.89, pe: 72.8, hi: 622.64, lo: 278.45, mc: '572.96L Cr' },
  { sym: 'ADANIT98', name: 'Adani Total Projects Ltd', exc: 'BSE', sec: 'Infra', price: 2699.62, chg: 3.73, pe: -1, hi: 3884.62, lo: 2226.7, mc: '16611.25L Cr' },
  { sym: 'ADANIW99', name: 'Adani Wilmar Minerals Ltd', exc: 'NSE', sec: 'Metals', price: 1063.32, chg: 1.9, pe: 145.1, hi: 1300.49, lo: 976.92, mc: '157.97L Cr' },
  { sym: 'APOLLO1', name: 'Apollo Tyres Healthcare Ltd', exc: 'BSE', sec: 'Healthcare', price: 825.7, chg: -1.04, pe: 134.8, hi: 1146.38, lo: 567.84, mc: '5825.64L Cr' },
  { sym: 'TORREN2', name: 'Torrent Diagnostics Ltd', exc: 'BSE', sec: 'Healthcare', price: 2534.83, chg: 1.91, pe: 89.2, hi: 2835.16, lo: 2074.93, mc: '15742.55L Cr' },
  { sym: 'MAHIND3', name: 'Mahindra Textiles Ltd', exc: 'NSE', sec: 'Textiles', price: 677.67, chg: -4.05, pe: 88.6, hi: 888.05, lo: 588.51, mc: '3630.77L Cr' },
  { sym: 'ENDURA4', name: 'Endurance Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1391.24, chg: -2.05, pe: 63.9, hi: 1713.2, lo: 1170.05, mc: '1858.78L Cr' },
  { sym: 'MUTHOOT', name: 'Muthoot Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 878.33, chg: 4.11, pe: 148.3, hi: 1043.59, lo: 649.57, mc: '6947.22L Cr' },
  { sym: 'KANSAI', name: 'Kansai Financial Ltd', exc: 'BSE', sec: 'Finance', price: 559.3, chg: -0.0, pe: 12.3, hi: 798.77, lo: 504.74, mc: '4507.61L Cr' },
  { sym: 'JUPITE7', name: 'Jupiter Garments Ltd', exc: 'NSE', sec: 'Textiles', price: 669.43, chg: -2.6, pe: 149.4, hi: 827.9, lo: 607.63, mc: '660.57L Cr' },
  { sym: 'ORIENT8', name: 'Orient Builders Ltd', exc: 'BSE', sec: 'Infra', price: 4838.43, chg: -0.97, pe: -1, hi: 6038.16, lo: 4397.26, mc: '30136.86L Cr' },
  { sym: 'TATAST9', name: 'Tata Steel Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 12784.0, chg: 4.32, pe: 115.8, hi: 15294.46, lo: 9462.76, mc: '29568.02L Cr' },
  { sym: 'DIVI10', name: 'Divi Auto Ltd', exc: 'BSE', sec: 'Auto', price: 1252.97, chg: 3.14, pe: 148.4, hi: 1656.63, lo: 803.89, mc: '9773.26L Cr' },
  { sym: 'STK0208', name: 'Shree Cement Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 2673.5, chg: -2.51, pe: 77.5, hi: 2855.62, lo: 1732.33, mc: '8538.54L Cr' },
  { sym: 'LAURUS12', name: 'Laurus Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 1330.64, chg: -1.22, pe: 28.6, hi: 1924.43, lo: 1142.7, mc: '2734.74L Cr' },
  { sym: 'ENDURA13', name: 'Endurance Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 1815.54, chg: 3.66, pe: 102.7, hi: 2617.93, lo: 1460.23, mc: '21066.37L Cr' },
  { sym: 'AMARA14', name: 'Amara Products Ltd', exc: 'NSE', sec: 'FMCG', price: 15003.36, chg: 1.28, pe: 89.6, hi: 16776.83, lo: 12305.14, mc: '156768.90L Cr' },
  { sym: 'PFC15', name: 'PFC Hospitals Ltd', exc: 'NSE', sec: 'Healthcare', price: 608.37, chg: -2.59, pe: 65.7, hi: 739.28, lo: 408.44, mc: '3759.17L Cr' },
  { sym: 'GRANUL16', name: 'Granules Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 1499.82, chg: 1.11, pe: 74.4, hi: 1800.88, lo: 1402.09, mc: '7419.62L Cr' },
  { sym: 'NLC17', name: 'NLC Vehicles Ltd', exc: 'BSE', sec: 'Auto', price: 8240.08, chg: 1.6, pe: 40.7, hi: 10491.56, lo: 5592.57, mc: '48845.56L Cr' },
  { sym: 'DEEPAKNI', name: 'Deepak Nitrite Commerce Ltd', exc: 'NSE', sec: 'Consumer', price: 3513.15, chg: 0.3, pe: 140.5, hi: 4702.93, lo: 2461.76, mc: '22079.72L Cr' },
  { sym: 'ADANIT19', name: 'Adani Total Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 505.56, chg: -1.6, pe: 108.6, hi: 600.88, lo: 381.61, mc: '1257.56L Cr' },
  { sym: 'PFC20', name: 'PFC Utilities Ltd', exc: 'BSE', sec: 'Energy', price: 1124.99, chg: -3.13, pe: 90.1, hi: 1290.34, lo: 938.74, mc: '7669.01L Cr' },
  { sym: 'NBCC', name: 'NBCC Digital Ltd', exc: 'NSE', sec: 'Technology', price: 3599.76, chg: -3.49, pe: 5.8, hi: 4572.2, lo: 3330.44, mc: '27431.13L Cr' },
  { sym: 'HAVELL22', name: 'Havells Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 328.27, chg: -1.29, pe: 136.7, hi: 356.43, lo: 262.93, mc: '2551.50L Cr' },
  { sym: 'DLF23', name: 'DLF Apparel Ltd', exc: 'NSE', sec: 'Textiles', price: 739.26, chg: 4.32, pe: 138.3, hi: 1071.09, lo: 546.27, mc: '6868.19L Cr' },
  { sym: 'BIRLA24', name: 'Birla Paints Ltd', exc: 'BSE', sec: 'Chemicals', price: 2210.35, chg: 1.18, pe: 147.5, hi: 2572.46, lo: 2091.4, mc: '11989.22L Cr' },
  { sym: 'DECCANCE', name: 'Deccan Cement Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 1236.78, chg: -1.19, pe: 99.0, hi: 1654.12, lo: 748.16, mc: '2521.37L Cr' },
  { sym: 'PARAS', name: 'Paras Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 1475.82, chg: 3.77, pe: 17.6, hi: 1944.69, lo: 980.94, mc: '1375.33L Cr' },
  { sym: 'BLUEST27', name: 'Blue Star Electric Ltd', exc: 'NSE', sec: 'Energy', price: 465.1, chg: 3.04, pe: 48.8, hi: 622.84, lo: 280.92, mc: '4232.23L Cr' },
  { sym: 'INDIAB28', name: 'Indiabulls Digital Ltd', exc: 'NSE', sec: 'Technology', price: 3990.46, chg: 2.36, pe: 133.7, hi: 5418.79, lo: 3358.38, mc: '47992.77L Cr' },
  { sym: 'MANAPP29', name: 'Manappuram Mining Ltd', exc: 'NSE', sec: 'Metals', price: 325.42, chg: -2.97, pe: 92.8, hi: 395.82, lo: 257.81, mc: '1662.24L Cr' },
  { sym: 'IRFC', name: 'IRFC Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 5404.46, chg: 4.23, pe: -1, hi: 6640.46, lo: 4573.89, mc: '4827.87L Cr' },
  { sym: 'HDIL31', name: 'HDIL Systems Ltd', exc: 'NSE', sec: 'Technology', price: 4795.26, chg: -1.22, pe: 21.9, hi: 5429.0, lo: 3855.88, mc: '4516.55L Cr' },
  { sym: 'LAURUS32', name: 'Laurus Systems Ltd', exc: 'NSE', sec: 'Defence', price: 2360.3, chg: 0.07, pe: -1, hi: 2914.86, lo: 2082.78, mc: '13727.81L Cr' },
  { sym: 'GLOBAL33', name: 'Global Health Chemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 2661.15, chg: -4.05, pe: 14.2, hi: 3852.41, lo: 2467.16, mc: '3455.72L Cr' },
  { sym: 'ADANIT34', name: 'Adani Total Systems Ltd', exc: 'BSE', sec: 'Technology', price: 2221.67, chg: 3.16, pe: 98.7, hi: 2706.32, lo: 2105.03, mc: '14813.19L Cr' },
  { sym: 'IRFC35', name: 'IRFC Fashion Ltd', exc: 'BSE', sec: 'Textiles', price: 275.34, chg: -3.17, pe: 22.2, hi: 398.46, lo: 203.08, mc: '688.86L Cr' },
  { sym: 'ENDURA36', name: 'Endurance Coatings Ltd', exc: 'NSE', sec: 'Chemicals', price: 2695.39, chg: 2.23, pe: 82.1, hi: 3717.87, lo: 1850.73, mc: '5283.97L Cr' },
  { sym: 'MAZAGO37', name: 'Mazagon Dock Apparel Ltd', exc: 'NSE', sec: 'Textiles', price: 122.55, chg: 1.65, pe: 133.9, hi: 140.47, lo: 76.42, mc: '658.19L Cr' },
  { sym: 'BAJAJ38', name: 'Bajaj Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 1939.72, chg: -0.11, pe: 114.4, hi: 2638.84, lo: 1258.97, mc: '9320.16L Cr' },
  { sym: 'ADANIT39', name: 'Adani Total Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 380.29, chg: -2.13, pe: 147.9, hi: 478.6, lo: 283.22, mc: '1175.90L Cr' },
  { sym: 'SAIL', name: 'SAIL Housing Ltd', exc: 'NSE', sec: 'Realty', price: 644.69, chg: 0.46, pe: 141.5, hi: 850.05, lo: 564.12, mc: '1736.81L Cr' },
  { sym: 'GUJARA41', name: 'Gujarat Adani Diagnostics Ltd', exc: 'BSE', sec: 'Healthcare', price: 1630.55, chg: 0.24, pe: 48.6, hi: 2173.57, lo: 1438.18, mc: '16907.65L Cr' },
  { sym: 'EXIDE42', name: 'Exide Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 3229.67, chg: -1.2, pe: -1, hi: 3972.22, lo: 2357.26, mc: '28767.72L Cr' },
  { sym: 'BEL43', name: 'BEL Software Ltd', exc: 'BSE', sec: 'Technology', price: 2072.69, chg: -4.1, pe: -1, hi: 2843.44, lo: 1669.87, mc: '6259.94L Cr' },
  { sym: 'BIRLA44', name: 'Birla Energy Ltd', exc: 'BSE', sec: 'Energy', price: 419.57, chg: 4.87, pe: 22.0, hi: 608.3, lo: 322.07, mc: '1240.36L Cr' },
  { sym: 'SEQUEN45', name: 'Sequent Utilities Ltd', exc: 'BSE', sec: 'Energy', price: 1104.94, chg: 3.26, pe: 82.4, hi: 1318.97, lo: 764.12, mc: '5695.14L Cr' },
  { sym: 'BALKRISH', name: 'Balkrishna Finance Ltd', exc: 'BSE', sec: 'Finance', price: 1547.1, chg: -0.79, pe: 86.6, hi: 1761.39, lo: 1007.27, mc: '7558.41L Cr' },
  { sym: 'HAVELL47', name: 'Havells Properties Ltd', exc: 'BSE', sec: 'Realty', price: 264.35, chg: -2.2, pe: 40.6, hi: 335.79, lo: 245.9, mc: '1367.94L Cr' },
  { sym: 'NHPC48', name: 'NHPC Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 1083.41, chg: -2.81, pe: 75.8, hi: 1534.93, lo: 855.62, mc: '947.94L Cr' },
  { sym: 'GARDEN49', name: 'Garden Reach Tech Ltd', exc: 'NSE', sec: 'Technology', price: 7588.91, chg: 3.14, pe: 127.2, hi: 8670.89, lo: 6431.67, mc: '746.95L Cr' },
  { sym: 'GARDEN50', name: 'Garden Reach Minerals Ltd', exc: 'NSE', sec: 'Metals', price: 771.98, chg: 4.63, pe: 7.3, hi: 974.92, lo: 574.33, mc: '192.72L Cr' },
  { sym: 'HEIDEL51', name: 'HeidelbergCement Auto Ltd', exc: 'BSE', sec: 'Auto', price: 598.85, chg: 3.56, pe: 20.5, hi: 651.86, lo: 390.52, mc: '1223.66L Cr' },
  { sym: 'RAMCO52', name: 'Ramco Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 778.21, chg: -0.77, pe: 86.9, hi: 1125.36, lo: 528.44, mc: '9045.15L Cr' },
  { sym: 'AMBUJA53', name: 'Ambuja Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 926.45, chg: 1.03, pe: -1, hi: 976.27, lo: 611.44, mc: '4073.28L Cr' },
  { sym: 'EMAMI54', name: 'Emami Defence Ltd', exc: 'NSE', sec: 'Defence', price: 2697.57, chg: -2.2, pe: 105.4, hi: 3444.02, lo: 1874.5, mc: '34284.15L Cr' },
  { sym: 'BALKRI55', name: 'Balkrishna Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 1060.9, chg: 5.11, pe: 114.1, hi: 1416.39, lo: 784.43, mc: '280.54L Cr' },
  { sym: 'GLAND56', name: 'Gland Utilities Ltd', exc: 'BSE', sec: 'Energy', price: 838.28, chg: -0.66, pe: 119.6, hi: 1111.33, lo: 525.98, mc: '4405.07L Cr' },
  { sym: 'OBEROI', name: 'Oberoi Financial Ltd', exc: 'BSE', sec: 'Finance', price: 541.07, chg: 1.55, pe: 91.4, hi: 777.83, lo: 386.45, mc: '5393.19L Cr' },
  { sym: 'SEQUEN58', name: 'Sequent Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 687.84, chg: -0.18, pe: 100.8, hi: 745.81, lo: 561.63, mc: '7861.49L Cr' },
  { sym: 'NBCC59', name: 'NBCC Securities Ltd', exc: 'BSE', sec: 'Finance', price: 393.02, chg: -2.96, pe: 57.3, hi: 427.06, lo: 365.52, mc: '2671.53L Cr' },
  { sym: 'TATAST60', name: 'Tata Steel Capital Ltd', exc: 'NSE', sec: 'Finance', price: 398.8, chg: 1.07, pe: 20.0, hi: 433.04, lo: 316.64, mc: '3746.30L Cr' },
  { sym: 'HINDAL61', name: 'Hindalco Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 179.0, chg: 3.29, pe: 86.1, hi: 259.03, lo: 122.61, mc: '1284.95L Cr' },
  { sym: 'MOTHER62', name: 'Motherson Health Ltd', exc: 'NSE', sec: 'Healthcare', price: 2174.87, chg: -3.04, pe: 45.0, hi: 2544.38, lo: 1900.69, mc: '14853.73L Cr' },
  { sym: 'HAVELL63', name: 'Havells Beverages Ltd', exc: 'BSE', sec: 'FMCG', price: 11937.06, chg: -3.43, pe: 142.6, hi: 14120.19, lo: 9753.38, mc: '64555.78L Cr' },
  { sym: 'COCHIN64', name: 'Cochin Shipyard Minerals Ltd', exc: 'BSE', sec: 'Metals', price: 745.0, chg: -3.14, pe: 142.4, hi: 842.1, lo: 528.92, mc: '13927.43L Cr' },
  { sym: 'NUVOCO', name: 'Nuvoco Retail Ltd', exc: 'BSE', sec: 'Consumer', price: 2908.12, chg: -1.24, pe: 119.0, hi: 3478.13, lo: 2693.57, mc: '11612.59L Cr' },
  { sym: 'AARTI66', name: 'Aarti Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 6689.83, chg: -0.12, pe: 105.5, hi: 9215.82, lo: 5876.88, mc: '27626.76L Cr' },
  { sym: 'MAZAGO67', name: 'Mazagon Dock Pharmaceuticals Ltd', exc: 'BSE', sec: 'Pharma', price: 1399.6, chg: 2.65, pe: 15.7, hi: 2024.21, lo: 1074.52, mc: '5743.50L Cr' },
  { sym: 'SAGARCEM', name: 'Sagar Cement Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 362.7, chg: 2.52, pe: 91.1, hi: 513.5, lo: 231.5, mc: '1204.75L Cr' },
  { sym: 'BHARAT69', name: 'Bharat Forge Health Ltd', exc: 'NSE', sec: 'Healthcare', price: 4117.25, chg: 5.17, pe: 120.5, hi: 4497.59, lo: 2612.45, mc: '13723.26L Cr' },
  { sym: 'RAMCO70', name: 'Ramco Auto Ltd', exc: 'NSE', sec: 'Auto', price: 6963.79, chg: 3.22, pe: 77.6, hi: 8272.89, lo: 4238.14, mc: '6168.44L Cr' },
  { sym: 'NHPC71', name: 'NHPC Finance Ltd', exc: 'NSE', sec: 'Finance', price: 2519.26, chg: -1.02, pe: 118.7, hi: 3170.35, lo: 1818.67, mc: '3581.46L Cr' },
  { sym: 'BAJAJ72', name: 'Bajaj Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 414.2, chg: -4.27, pe: 20.9, hi: 567.46, lo: 383.33, mc: '3195.47L Cr' },
  { sym: 'SAIL73', name: 'SAIL Auto Ltd', exc: 'NSE', sec: 'Auto', price: 5299.35, chg: -2.18, pe: 31.7, hi: 6921.97, lo: 3981.12, mc: '1943.78L Cr' },
  { sym: 'INDIACEM', name: 'India Cement Power Ltd', exc: 'BSE', sec: 'Energy', price: 743.27, chg: 2.55, pe: 114.1, hi: 1020.88, lo: 462.24, mc: '1326.71L Cr' },
  { sym: 'RATNAMAN', name: 'Ratnamani Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 1438.74, chg: -1.88, pe: 81.5, hi: 1878.48, lo: 1163.85, mc: '10401.53L Cr' },
  { sym: 'MFAC76', name: 'MFAC Metals Ltd', exc: 'BSE', sec: 'Metals', price: 770.23, chg: 3.64, pe: 48.1, hi: 998.06, lo: 484.99, mc: '262.24L Cr' },
  { sym: 'REC77', name: 'REC Retail Ltd', exc: 'NSE', sec: 'Consumer', price: 1078.61, chg: 0.61, pe: 25.0, hi: 1298.09, lo: 717.29, mc: '9551.15L Cr' },
  { sym: 'DEEPAK78', name: 'Deepak Nitrite Drugs Ltd', exc: 'NSE', sec: 'Pharma', price: 4017.91, chg: -3.1, pe: 70.4, hi: 4304.97, lo: 2915.65, mc: '117.57L Cr' },
  { sym: 'DIVI79', name: 'Divi Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 2415.0, chg: -0.41, pe: 108.0, hi: 2964.51, lo: 1590.37, mc: '21798.60L Cr' },
  { sym: 'WHIRLP80', name: 'Whirlpool Petroleum Ltd', exc: 'BSE', sec: 'Energy', price: 116.62, chg: -1.61, pe: 87.0, hi: 158.49, lo: 90.19, mc: '687.75L Cr' },
  { sym: 'GUJARA81', name: 'Gujarat Adani Consumer Ltd', exc: 'BSE', sec: 'Consumer', price: 1694.82, chg: 3.1, pe: 36.7, hi: 2067.79, lo: 1453.47, mc: '5652.81L Cr' },
  { sym: 'JKTYRE', name: 'JK Tyre Chemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 1684.12, chg: -0.11, pe: 117.5, hi: 1927.94, lo: 1488.33, mc: '7074.50L Cr' },
  { sym: 'MANAPP83', name: 'Manappuram FMCG Ltd', exc: 'BSE', sec: 'FMCG', price: 3444.74, chg: 3.64, pe: 87.7, hi: 4350.4, lo: 2786.45, mc: '11387.21L Cr' },
  { sym: 'LAURUS84', name: 'Laurus Consumer Ltd', exc: 'BSE', sec: 'Consumer', price: 1782.3, chg: -3.14, pe: 64.7, hi: 1913.68, lo: 1242.38, mc: '16473.53L Cr' },
  { sym: 'APOLLO85', name: 'Apollo Tyres Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 1365.21, chg: 3.11, pe: 76.0, hi: 1748.79, lo: 947.53, mc: '5177.70L Cr' },
  { sym: 'ADANIP86', name: 'Adani Ports Drugs Ltd', exc: 'NSE', sec: 'Pharma', price: 2999.1, chg: 2.45, pe: 70.9, hi: 3734.53, lo: 2410.33, mc: '44236.36L Cr' },
  { sym: 'PFC87', name: 'PFC Financial Ltd', exc: 'BSE', sec: 'Finance', price: 1306.2, chg: 4.0, pe: 62.7, hi: 1877.34, lo: 1160.82, mc: '4262.38L Cr' },
  { sym: 'LAL88', name: 'Lal Products Ltd', exc: 'BSE', sec: 'Consumer', price: 1709.84, chg: 4.02, pe: 134.7, hi: 2316.66, lo: 1053.4, mc: '17956.91L Cr' },
  { sym: 'INDIAB89', name: 'Indiabulls Digital Ltd', exc: 'NSE', sec: 'Technology', price: 7470.75, chg: 0.07, pe: 67.0, hi: 10819.72, lo: 6860.33, mc: '40710.62L Cr' },
  { sym: 'SHREEC90', name: 'Shree Cement Paints Ltd', exc: 'BSE', sec: 'Chemicals', price: 369.35, chg: -3.68, pe: 99.1, hi: 395.47, lo: 302.48, mc: '4064.11L Cr' },
  { sym: 'ADITYA', name: 'Aditya Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 5688.84, chg: 0.27, pe: 37.8, hi: 7520.61, lo: 3431.8, mc: '64827.23L Cr' },
  { sym: 'BALAJIAM', name: 'Balaji Amines Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1780.97, chg: -2.21, pe: -1, hi: 2444.17, lo: 1132.91, mc: '4013.14L Cr' },
  { sym: 'MISHRA93', name: 'Mishra Dhatu Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 5204.29, chg: -3.82, pe: 93.5, hi: 5806.15, lo: 3762.26, mc: '16680.22L Cr' },
  { sym: 'JSW94', name: 'JSW Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 400.36, chg: -3.63, pe: 114.1, hi: 514.79, lo: 294.03, mc: '2478.66L Cr' },
  { sym: 'WOCKHA95', name: 'Wockhardt Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 2227.99, chg: 1.03, pe: 93.1, hi: 3033.6, lo: 1875.22, mc: '25007.11L Cr' },
  { sym: 'LAURUS96', name: 'Laurus Retail Ltd', exc: 'NSE', sec: 'Consumer', price: 2685.2, chg: 2.98, pe: 12.9, hi: 3783.89, lo: 2508.34, mc: '3233.90L Cr' },
  { sym: 'BIRLA97', name: 'Birla Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 1198.09, chg: 4.84, pe: 129.8, hi: 1530.38, lo: 872.08, mc: '12523.38L Cr' },
  { sym: 'ESSAR98', name: 'Essar Defence Ltd', exc: 'NSE', sec: 'Defence', price: 1050.07, chg: -1.88, pe: -1, hi: 1127.97, lo: 920.13, mc: '6730.49L Cr' },
  { sym: 'JKCEME99', name: 'JK Cement Motors Ltd', exc: 'BSE', sec: 'Auto', price: 5313.47, chg: 1.91, pe: 27.1, hi: 5756.82, lo: 3335.04, mc: '95381.52L Cr' },
  { sym: 'PARAS1', name: 'Paras Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 1684.78, chg: -1.4, pe: 143.2, hi: 1929.84, lo: 1155.03, mc: '3889.25L Cr' },
  { sym: 'SJVN2', name: 'SJVN Real Estate Ltd', exc: 'NSE', sec: 'Realty', price: 343.83, chg: -3.31, pe: 106.7, hi: 383.55, lo: 320.98, mc: '2825.10L Cr' },
  { sym: 'LAL3', name: 'Lal Consumer Goods Ltd', exc: 'BSE', sec: 'FMCG', price: 3464.21, chg: 2.83, pe: 135.5, hi: 4101.64, lo: 2599.07, mc: '9815.68L Cr' },
  { sym: 'LAURUS4', name: 'Laurus Properties Ltd', exc: 'NSE', sec: 'Realty', price: 521.34, chg: -3.95, pe: 29.2, hi: 580.21, lo: 453.91, mc: '6316.50L Cr' },
  { sym: 'ADITYA5', name: 'Aditya Bank Ltd', exc: 'NSE', sec: 'Finance', price: 2261.22, chg: 4.09, pe: -1, hi: 2415.87, lo: 1644.79, mc: '7789.79L Cr' },
  { sym: 'NBCC6', name: 'NBCC Coatings Ltd', exc: 'NSE', sec: 'Chemicals', price: 2024.45, chg: -2.25, pe: 137.8, hi: 2384.75, lo: 1799.94, mc: '2967.94L Cr' },
  { sym: 'ORIENTCE', name: 'Orient Cement Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 1501.61, chg: 5.31, pe: 15.0, hi: 1856.05, lo: 1049.34, mc: '8475.93L Cr' },
  { sym: 'HAVELL8', name: 'Havells Vehicles Ltd', exc: 'BSE', sec: 'Auto', price: 492.44, chg: 1.14, pe: 95.3, hi: 608.44, lo: 397.44, mc: '3767.12L Cr' },
  { sym: 'HINDAL9', name: 'Hindalco Power Ltd', exc: 'NSE', sec: 'Energy', price: 310.79, chg: -2.17, pe: 126.7, hi: 435.38, lo: 289.92, mc: '8.06L Cr' },
  { sym: 'STRIDE10', name: 'Strides Petrochemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 394.28, chg: -0.3, pe: 146.0, hi: 436.45, lo: 275.18, mc: '83.69L Cr' },
  { sym: 'ACC11', name: 'ACC Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 1796.99, chg: 5.25, pe: -1, hi: 1955.54, lo: 1162.17, mc: '2478.12L Cr' },
  { sym: 'LAL12', name: 'Lal Real Estate Ltd', exc: 'NSE', sec: 'Realty', price: 463.23, chg: -1.58, pe: 139.3, hi: 559.2, lo: 412.81, mc: '1386.47L Cr' },
  { sym: 'MANAPP13', name: 'Manappuram Petroleum Ltd', exc: 'NSE', sec: 'Energy', price: 1420.98, chg: -3.41, pe: 70.2, hi: 1670.52, lo: 912.64, mc: '7874.30L Cr' },
  { sym: 'KANSAI14', name: 'Kansai Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 1087.69, chg: -2.92, pe: 124.8, hi: 1445.27, lo: 667.97, mc: '6083.61L Cr' },
  { sym: 'RAMCO15', name: 'Ramco Investments Ltd', exc: 'NSE', sec: 'Finance', price: 2909.94, chg: -4.01, pe: 123.9, hi: 3257.81, lo: 2715.65, mc: '27874.57L Cr' },
  { sym: 'MARICO', name: 'Marico Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 1873.52, chg: -3.29, pe: -1, hi: 2552.45, lo: 1269.87, mc: '3024.58L Cr' },
  { sym: 'AMARA17', name: 'Amara Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 4201.57, chg: -4.28, pe: -1, hi: 5928.41, lo: 3173.03, mc: '9838.67L Cr' },
  { sym: 'STK0314', name: 'Aarti Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 437.94, chg: -2.82, pe: 124.1, hi: 529.03, lo: 267.28, mc: '1083.85L Cr' },
  { sym: 'WELSPU19', name: 'Welspun Energy Ltd', exc: 'NSE', sec: 'Energy', price: 484.97, chg: -4.15, pe: 40.6, hi: 566.47, lo: 360.91, mc: '376.02L Cr' },
  { sym: 'HAVELL20', name: 'Havells Products Ltd', exc: 'BSE', sec: 'Consumer', price: 541.12, chg: -2.01, pe: 83.8, hi: 572.4, lo: 397.11, mc: '3744.27L Cr' },
  { sym: 'YATHAR21', name: 'Yatharth Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 2032.1, chg: -0.62, pe: 51.2, hi: 2311.73, lo: 1856.36, mc: '2152.09L Cr' },
  { sym: 'VOLTAS22', name: 'Voltas Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 1603.63, chg: -3.5, pe: 43.6, hi: 2207.42, lo: 1477.01, mc: '1801.82L Cr' },
  { sym: 'STK0319', name: 'DLF Energy Ltd', exc: 'BSE', sec: 'Energy', price: 477.38, chg: -2.13, pe: 112.0, hi: 569.76, lo: 385.27, mc: '2406.05L Cr' },
  { sym: 'PURAVA24', name: 'Puravankara Developers Ltd', exc: 'NSE', sec: 'Realty', price: 584.95, chg: 0.92, pe: 10.5, hi: 627.34, lo: 474.15, mc: '115.42L Cr' },
  { sym: 'CEAT25', name: 'CEAT Metals Ltd', exc: 'NSE', sec: 'Metals', price: 983.22, chg: 4.69, pe: 51.9, hi: 1041.0, lo: 791.8, mc: '14008.32L Cr' },
  { sym: 'ACC26', name: 'ACC Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 2407.31, chg: 1.36, pe: 51.8, hi: 3467.36, lo: 2061.44, mc: '13530.62L Cr' },
  { sym: 'RAINBO27', name: 'Rainbow Children Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 596.14, chg: -2.27, pe: 30.4, hi: 699.11, lo: 501.34, mc: '1114.54L Cr' },
  { sym: 'ADANIT28', name: 'Adani Total Products Ltd', exc: 'BSE', sec: 'FMCG', price: 17037.53, chg: -4.18, pe: 138.6, hi: 24483.15, lo: 11539.75, mc: '180701.98L Cr' },
  { sym: 'BLUEST29', name: 'Blue Star Medical Ltd', exc: 'BSE', sec: 'Healthcare', price: 3032.3, chg: 5.32, pe: 133.4, hi: 3291.53, lo: 2571.81, mc: '34419.47L Cr' },
  { sym: 'SYMPHO30', name: 'Symphony Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 750.86, chg: -1.0, pe: 109.5, hi: 802.86, lo: 565.68, mc: '1101.57L Cr' },
  { sym: 'JKTYRE31', name: 'JK Tyre Builders Ltd', exc: 'BSE', sec: 'Infra', price: 4426.59, chg: -0.75, pe: 119.4, hi: 5671.45, lo: 3830.71, mc: '9138.01L Cr' },
  { sym: 'BALKRI32', name: 'Balkrishna Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 1884.73, chg: 5.02, pe: -1, hi: 2107.21, lo: 1378.51, mc: '15221.80L Cr' },
  { sym: 'BEML', name: 'BEML Apparel Ltd', exc: 'NSE', sec: 'Textiles', price: 336.57, chg: 2.55, pe: 99.8, hi: 435.16, lo: 253.09, mc: '122.85L Cr' },
  { sym: 'NLC34', name: 'NLC Petroleum Ltd', exc: 'BSE', sec: 'Energy', price: 860.86, chg: -1.85, pe: 39.4, hi: 920.99, lo: 688.79, mc: '2343.52L Cr' },
  { sym: 'VARROC35', name: 'Varroc Minerals Ltd', exc: 'NSE', sec: 'Metals', price: 558.92, chg: 0.3, pe: -1, hi: 633.13, lo: 460.2, mc: '5229.87L Cr' },
  { sym: 'ALKYL36', name: 'Alkyl Capital Ltd', exc: 'BSE', sec: 'Finance', price: 1591.27, chg: 4.45, pe: 98.1, hi: 1917.5, lo: 1161.4, mc: '2365.71L Cr' },
  { sym: 'AMARA37', name: 'Amara Systems Ltd', exc: 'BSE', sec: 'Technology', price: 2366.78, chg: 3.87, pe: 26.9, hi: 3144.48, lo: 1500.17, mc: '25627.23L Cr' },
  { sym: 'INDIAC38', name: 'India Cement Builders Ltd', exc: 'NSE', sec: 'Infra', price: 4518.09, chg: -0.31, pe: 130.7, hi: 5602.11, lo: 4105.04, mc: '3796.37L Cr' },
  { sym: 'GRANUL39', name: 'Granules Fashion Ltd', exc: 'NSE', sec: 'Textiles', price: 451.47, chg: 2.28, pe: 22.4, hi: 610.78, lo: 298.2, mc: '8643.39L Cr' },
  { sym: 'SAIL40', name: 'SAIL Defence Ltd', exc: 'NSE', sec: 'Defence', price: 1378.56, chg: 5.38, pe: 149.6, hi: 1793.36, lo: 1229.59, mc: '6491.70L Cr' },
  { sym: 'RAINBO41', name: 'Rainbow Children Apparel Ltd', exc: 'NSE', sec: 'Textiles', price: 160.92, chg: 1.02, pe: 80.4, hi: 228.0, lo: 97.25, mc: '1334.10L Cr' },
  { sym: 'HDIL42', name: 'HDIL Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1337.56, chg: 1.17, pe: 144.9, hi: 1458.05, lo: 851.99, mc: '16432.75L Cr' },
  { sym: 'AMARA43', name: 'Amara Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 2213.05, chg: 2.05, pe: 73.6, hi: 2476.14, lo: 1639.96, mc: '18722.97L Cr' },
  { sym: 'MRF44', name: 'MRF Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 3287.18, chg: -4.01, pe: 43.9, hi: 3941.25, lo: 2361.03, mc: '16586.26L Cr' },
  { sym: 'IRFC45', name: 'IRFC Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 2166.85, chg: 5.22, pe: 48.6, hi: 2919.81, lo: 1887.13, mc: '10182.77L Cr' },
  { sym: 'ORIENT46', name: 'Orient Developers Ltd', exc: 'NSE', sec: 'Realty', price: 228.54, chg: 2.91, pe: 130.7, hi: 315.02, lo: 178.34, mc: '231.69L Cr' },
  { sym: 'STRIDE47', name: 'Strides Motors Ltd', exc: 'BSE', sec: 'Auto', price: 1973.54, chg: -2.76, pe: 34.1, hi: 2117.71, lo: 1206.97, mc: '738.81L Cr' },
  { sym: 'AARTI48', name: 'Aarti Petroleum Ltd', exc: 'BSE', sec: 'Energy', price: 492.55, chg: -0.53, pe: 103.8, hi: 564.84, lo: 379.79, mc: '4225.43L Cr' },
  { sym: 'AMARA49', name: 'Amara Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 885.22, chg: -1.65, pe: 28.6, hi: 1132.11, lo: 830.09, mc: '9878.09L Cr' },
  { sym: 'HINDAL50', name: 'Hindalco Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 2102.86, chg: -4.3, pe: 116.3, hi: 2215.49, lo: 1932.59, mc: '16480.16L Cr' },
  { sym: 'DECCAN51', name: 'Deccan Cement IT Ltd', exc: 'NSE', sec: 'Technology', price: 2392.93, chg: 2.63, pe: 44.9, hi: 3369.71, lo: 2148.98, mc: '4968.06L Cr' },
  { sym: 'ADITYA52', name: 'Aditya Products Ltd', exc: 'BSE', sec: 'Consumer', price: 1815.79, chg: 5.49, pe: 126.7, hi: 2314.37, lo: 1466.83, mc: '7067.29L Cr' },
  { sym: 'MINDA53', name: 'Minda Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 871.68, chg: 4.11, pe: 108.1, hi: 1226.41, lo: 614.17, mc: '2012.62L Cr' },
  { sym: 'ORIENT54', name: 'Orient Cement Fashion Ltd', exc: 'NSE', sec: 'Textiles', price: 663.8, chg: -0.46, pe: 25.3, hi: 703.75, lo: 513.83, mc: '3567.02L Cr' },
  { sym: 'GLOBAL55', name: 'Global Health Builders Ltd', exc: 'BSE', sec: 'Infra', price: 3723.15, chg: 3.66, pe: 108.4, hi: 4931.41, lo: 3065.68, mc: '33362.24L Cr' },
  { sym: 'MAZAGO56', name: 'Mazagon Dock Minerals Ltd', exc: 'BSE', sec: 'Metals', price: 770.15, chg: -2.69, pe: -1, hi: 848.07, lo: 531.81, mc: '9529.68L Cr' },
  { sym: 'WHIRLP57', name: 'Whirlpool Medical Ltd', exc: 'BSE', sec: 'Healthcare', price: 2686.85, chg: -2.27, pe: 66.0, hi: 3774.32, lo: 1961.64, mc: '14767.03L Cr' },
  { sym: 'PARAS58', name: 'Paras Investments Ltd', exc: 'BSE', sec: 'Finance', price: 201.99, chg: 1.3, pe: 73.5, hi: 227.81, lo: 129.66, mc: '1470.27L Cr' },
  { sym: 'HDIL59', name: 'HDIL Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 6992.62, chg: 5.42, pe: 148.1, hi: 9839.58, lo: 6610.31, mc: '17353.27L Cr' },
  { sym: 'DATAPA60', name: 'Data Patterns Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 3618.03, chg: -1.37, pe: -1, hi: 4453.15, lo: 2435.96, mc: '32498.56L Cr' },
  { sym: 'ADANIW61', name: 'Adani Wilmar Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 3183.8, chg: -3.21, pe: 67.3, hi: 3889.36, lo: 2442.26, mc: '177.15L Cr' },
  { sym: 'APOLLO62', name: 'Apollo Tyres Products Ltd', exc: 'BSE', sec: 'FMCG', price: 19008.86, chg: -2.59, pe: 95.9, hi: 21851.24, lo: 16019.41, mc: '18036.34L Cr' },
  { sym: 'BAJAJ63', name: 'Bajaj Cement Ltd', exc: 'BSE', sec: 'Infra', price: 960.05, chg: 4.98, pe: 80.4, hi: 1209.32, lo: 721.75, mc: '1878.92L Cr' },
  { sym: 'PURAVA64', name: 'Puravankara Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 266.81, chg: 4.98, pe: 63.5, hi: 304.53, lo: 227.99, mc: '517.53L Cr' },
  { sym: 'NBCC65', name: 'NBCC Realty Ltd', exc: 'NSE', sec: 'Realty', price: 167.0, chg: -0.75, pe: 116.8, hi: 216.98, lo: 134.91, mc: '18.93L Cr' },
  { sym: 'BERGER', name: 'Berger Coatings Ltd', exc: 'NSE', sec: 'Chemicals', price: 359.18, chg: -0.06, pe: 41.6, hi: 477.98, lo: 241.34, mc: '94.66L Cr' },
  { sym: 'MOTHER67', name: 'Motherson Builders Ltd', exc: 'NSE', sec: 'Infra', price: 5367.37, chg: 1.56, pe: 125.4, hi: 5860.98, lo: 4570.68, mc: '1558.74L Cr' },
  { sym: 'HAVELL68', name: 'Havells Financial Ltd', exc: 'BSE', sec: 'Finance', price: 477.43, chg: 3.81, pe: 56.9, hi: 579.55, lo: 313.26, mc: '4771.43L Cr' },
  { sym: 'ADITYA69', name: 'Aditya Foods Ltd', exc: 'BSE', sec: 'FMCG', price: 6712.48, chg: 2.22, pe: 126.1, hi: 8844.42, lo: 4377.88, mc: '6278.95L Cr' },
  { sym: 'BHARAT70', name: 'Bharat Forge FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 22638.53, chg: 0.07, pe: 43.3, hi: 24223.95, lo: 20026.33, mc: '337916.43L Cr' },
  { sym: 'BERGER71', name: 'Berger Steel Ltd', exc: 'BSE', sec: 'Metals', price: 417.84, chg: 4.01, pe: 6.4, hi: 461.86, lo: 345.35, mc: '2462.28L Cr' },
  { sym: 'TORREN72', name: 'Torrent Properties Ltd', exc: 'BSE', sec: 'Realty', price: 707.64, chg: 3.65, pe: 63.1, hi: 1015.41, lo: 491.91, mc: '4655.63L Cr' },
  { sym: 'ORIENT73', name: 'Orient Cement Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 2946.54, chg: -3.37, pe: 13.5, hi: 4204.67, lo: 1932.31, mc: '14593.90L Cr' },
  { sym: 'AMBUJA74', name: 'Ambuja Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 1543.78, chg: 1.61, pe: 132.6, hi: 2070.07, lo: 1408.11, mc: '7360.82L Cr' },
  { sym: 'ESSAR75', name: 'Essar Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 309.16, chg: 2.05, pe: -1, hi: 432.0, lo: 242.28, mc: '3341.17L Cr' },
  { sym: 'REC76', name: 'REC Petroleum Ltd', exc: 'BSE', sec: 'Energy', price: 661.39, chg: -3.55, pe: 41.0, hi: 785.93, lo: 553.39, mc: '4283.19L Cr' },
  { sym: 'INDIAB77', name: 'Indiabulls Auto Ltd', exc: 'NSE', sec: 'Auto', price: 668.85, chg: 4.02, pe: 15.9, hi: 833.83, lo: 457.7, mc: '776.69L Cr' },
  { sym: 'BLUEST78', name: 'Blue Star Power Ltd', exc: 'BSE', sec: 'Energy', price: 531.67, chg: 0.09, pe: 70.0, hi: 740.42, lo: 402.19, mc: '636.51L Cr' },
  { sym: 'HINDAL79', name: 'Hindalco Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 987.71, chg: 1.07, pe: -1, hi: 1073.01, lo: 801.5, mc: '3811.19L Cr' },
  { sym: 'RATNAM80', name: 'Ratnamani Vehicles Ltd', exc: 'NSE', sec: 'Auto', price: 9991.64, chg: -0.87, pe: -1, hi: 11382.15, lo: 7584.26, mc: '69826.58L Cr' },
  { sym: 'BERGER81', name: 'Berger Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 1517.05, chg: 3.09, pe: 54.5, hi: 2096.49, lo: 1422.31, mc: '4672.31L Cr' },
  { sym: 'PRESTIGE', name: 'Prestige Beverages Ltd', exc: 'NSE', sec: 'FMCG', price: 1335.3, chg: -3.1, pe: 109.6, hi: 1459.2, lo: 1086.66, mc: '4672.61L Cr' },
  { sym: 'NUVOCO83', name: 'Nuvoco Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 3764.96, chg: 2.67, pe: 65.1, hi: 5348.69, lo: 3362.54, mc: '34347.62L Cr' },
  { sym: 'DIVI84', name: 'Divi Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 1419.38, chg: 5.14, pe: -1, hi: 1908.34, lo: 1126.46, mc: '7244.77L Cr' },
  { sym: 'DLF85', name: 'DLF Fabrics Ltd', exc: 'NSE', sec: 'Textiles', price: 584.27, chg: -3.46, pe: 92.9, hi: 688.7, lo: 530.8, mc: '3000.57L Cr' },
  { sym: 'CEAT86', name: 'CEAT Consumer Goods Ltd', exc: 'NSE', sec: 'FMCG', price: 6985.18, chg: 0.03, pe: 64.8, hi: 9290.33, lo: 6020.87, mc: '29453.02L Cr' },
  { sym: 'SEQUEN87', name: 'Sequent Petrochemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1822.9, chg: -2.49, pe: 47.1, hi: 2165.82, lo: 1522.72, mc: '23383.90L Cr' },
  { sym: 'ADANIG88', name: 'Adani Green Medical Ltd', exc: 'BSE', sec: 'Healthcare', price: 2899.34, chg: 1.12, pe: 141.7, hi: 3867.86, lo: 2423.81, mc: '27916.73L Cr' },
  { sym: 'GRANUL89', name: 'Granules Textiles Ltd', exc: 'BSE', sec: 'Textiles', price: 500.32, chg: -4.25, pe: 102.2, hi: 565.34, lo: 431.56, mc: '474.28L Cr' },
  { sym: 'REC90', name: 'REC Commerce Ltd', exc: 'NSE', sec: 'Consumer', price: 4229.03, chg: -2.46, pe: 57.0, hi: 5206.1, lo: 3449.36, mc: '32362.18L Cr' },
  { sym: 'NUVOCO91', name: 'Nuvoco Utilities Ltd', exc: 'BSE', sec: 'Energy', price: 346.11, chg: 2.43, pe: -1, hi: 416.24, lo: 258.13, mc: '3755.49L Cr' },
  { sym: 'EXIDE92', name: 'Exide Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 688.0, chg: 1.71, pe: 131.2, hi: 950.81, lo: 632.29, mc: '6314.73L Cr' },
  { sym: 'PURAVA93', name: 'Puravankara Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3328.44, chg: -0.01, pe: 15.8, hi: 4776.28, lo: 2853.4, mc: '400.54L Cr' },
  { sym: 'GLOBAL94', name: 'Global Health Commerce Ltd', exc: 'BSE', sec: 'Consumer', price: 520.69, chg: -4.44, pe: 140.9, hi: 555.04, lo: 481.65, mc: '4824.61L Cr' },
  { sym: 'JUPITE95', name: 'Jupiter Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 2580.12, chg: -0.92, pe: 51.1, hi: 2936.14, lo: 1714.11, mc: '1806.79L Cr' },
  { sym: 'WHIRLP96', name: 'Whirlpool Constructions Ltd', exc: 'BSE', sec: 'Infra', price: 595.94, chg: 2.13, pe: 47.6, hi: 852.27, lo: 486.52, mc: '3203.60L Cr' },
  { sym: 'JKTYRE97', name: 'JK Tyre Systems Ltd', exc: 'NSE', sec: 'Defence', price: 1344.17, chg: -2.1, pe: 138.2, hi: 1542.48, lo: 825.26, mc: '9228.20L Cr' },
  { sym: 'GLAND98', name: 'Gland Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 2157.63, chg: -4.25, pe: 116.7, hi: 2709.39, lo: 1678.76, mc: '6378.31L Cr' },
  { sym: 'WOCKHA99', name: 'Wockhardt Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 2446.1, chg: -2.83, pe: 83.0, hi: 2575.58, lo: 1523.71, mc: '25449.47L Cr' },
  { sym: 'CROMPT1', name: 'Crompton Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 2113.81, chg: 3.79, pe: 112.5, hi: 2587.5, lo: 1872.55, mc: '2114.82L Cr' },
  { sym: 'GODREJ2', name: 'Godrej Tech Ltd', exc: 'BSE', sec: 'Technology', price: 3669.28, chg: -3.77, pe: 41.5, hi: 3956.13, lo: 3256.73, mc: '27648.96L Cr' },
  { sym: 'TATA3', name: 'Tata Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1036.14, chg: 2.23, pe: 98.0, hi: 1344.23, lo: 895.83, mc: '8544.83L Cr' },
  { sym: 'MARICO4', name: 'Marico Financial Ltd', exc: 'BSE', sec: 'Finance', price: 1863.29, chg: 3.37, pe: 17.5, hi: 2526.83, lo: 1403.41, mc: '9786.07L Cr' },
  { sym: 'MANAPP5', name: 'Manappuram Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1206.9, chg: 3.47, pe: 47.8, hi: 1573.34, lo: 850.04, mc: '20677.09L Cr' },
  { sym: 'BIRLA6', name: 'Birla Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 2399.87, chg: 4.25, pe: 11.1, hi: 3069.64, lo: 1770.93, mc: '2478.57L Cr' },
  { sym: 'BHARAT7', name: 'Bharat Forge Petroleum Ltd', exc: 'BSE', sec: 'Energy', price: 317.15, chg: -3.08, pe: 94.4, hi: 365.07, lo: 203.01, mc: '2433.42L Cr' },
  { sym: 'OBEROI8', name: 'Oberoi IT Ltd', exc: 'BSE', sec: 'Technology', price: 3329.97, chg: 2.22, pe: 33.6, hi: 4269.81, lo: 3106.99, mc: '16059.52L Cr' },
  { sym: 'ESSAR9', name: 'Essar Energy Ltd', exc: 'NSE', sec: 'Energy', price: 499.19, chg: -1.32, pe: 94.4, hi: 585.19, lo: 401.58, mc: '2094.75L Cr' },
  { sym: 'BALKRI10', name: 'Balkrishna Metals Ltd', exc: 'BSE', sec: 'Metals', price: 201.66, chg: 3.36, pe: 97.9, hi: 234.06, lo: 146.37, mc: '927.31L Cr' },
  { sym: 'ADANIW11', name: 'Adani Wilmar Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 1057.11, chg: 0.37, pe: 98.6, hi: 1144.63, lo: 738.09, mc: '15594.12L Cr' },
  { sym: 'DATAPA12', name: 'Data Patterns Power Ltd', exc: 'BSE', sec: 'Energy', price: 901.57, chg: 2.77, pe: 128.2, hi: 1174.43, lo: 797.37, mc: '8056.23L Cr' },
  { sym: 'GLAND13', name: 'Gland Petroleum Ltd', exc: 'NSE', sec: 'Energy', price: 872.23, chg: 0.22, pe: 58.0, hi: 993.75, lo: 759.06, mc: '3813.51L Cr' },
  { sym: 'DIVI14', name: 'Divi Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 974.53, chg: 2.13, pe: 121.9, hi: 1262.62, lo: 641.28, mc: '4529.13L Cr' },
  { sym: 'BALAJI15', name: 'Balaji Amines Medical Ltd', exc: 'NSE', sec: 'Healthcare', price: 5257.07, chg: -4.1, pe: 38.6, hi: 6075.82, lo: 3584.83, mc: '36753.29L Cr' },
  { sym: 'RATNAM16', name: 'Ratnamani Defence Ltd', exc: 'NSE', sec: 'Defence', price: 2164.28, chg: -4.1, pe: 20.0, hi: 3110.89, lo: 1778.49, mc: '8825.29L Cr' },
  { sym: 'AMBUJA17', name: 'Ambuja Properties Ltd', exc: 'NSE', sec: 'Realty', price: 407.83, chg: 1.38, pe: 16.3, hi: 469.26, lo: 383.54, mc: '749.97L Cr' },
  { sym: 'BALAJI18', name: 'Balaji Amines Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 1294.12, chg: -4.43, pe: 68.8, hi: 1477.88, lo: 1009.53, mc: '1155.19L Cr' },
  { sym: 'HEIDEL19', name: 'HeidelbergCement Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 2487.68, chg: 2.11, pe: 52.9, hi: 2724.84, lo: 2080.52, mc: '14185.57L Cr' },
  { sym: 'BAJAJ20', name: 'Bajaj Pharmaceuticals Ltd', exc: 'BSE', sec: 'Pharma', price: 356.62, chg: 1.23, pe: 96.3, hi: 380.04, lo: 285.4, mc: '106.84L Cr' },
  { sym: 'STK0416', name: 'Yatharth Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 2477.56, chg: 4.29, pe: 124.1, hi: 3540.19, lo: 1674.35, mc: '14331.41L Cr' },
  { sym: 'HINDAL22', name: 'Hindalco Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 672.92, chg: 3.45, pe: 31.4, hi: 884.12, lo: 466.05, mc: '3404.52L Cr' },
  { sym: 'INDIAC23', name: 'India Cement Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 690.68, chg: -3.41, pe: 129.6, hi: 864.55, lo: 515.89, mc: '218.24L Cr' },
  { sym: 'SOLARA24', name: 'Solara Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 1792.18, chg: -3.57, pe: 135.8, hi: 2268.39, lo: 1076.06, mc: '22916.40L Cr' },
  { sym: 'BAJAJ25', name: 'Bajaj Builders Ltd', exc: 'BSE', sec: 'Infra', price: 1946.33, chg: -0.21, pe: 74.9, hi: 2642.08, lo: 1406.58, mc: '28467.51L Cr' },
  { sym: 'EXIDE26', name: 'Exide Coatings Ltd', exc: 'NSE', sec: 'Chemicals', price: 1604.12, chg: 3.16, pe: 17.2, hi: 2068.22, lo: 1267.75, mc: '127.68L Cr' },
  { sym: 'KANSAI27', name: 'Kansai Products Ltd', exc: 'NSE', sec: 'FMCG', price: 14534.08, chg: -4.43, pe: 104.7, hi: 17097.32, lo: 10563.29, mc: '29552.47L Cr' },
  { sym: 'SAIL28', name: 'SAIL Products Ltd', exc: 'BSE', sec: 'Consumer', price: 2586.68, chg: -0.84, pe: 103.7, hi: 3497.16, lo: 1926.12, mc: '19775.77L Cr' },
  { sym: 'SUPRAJ29', name: 'Suprajit Minerals Ltd', exc: 'BSE', sec: 'Metals', price: 273.17, chg: -1.06, pe: 111.7, hi: 380.25, lo: 226.94, mc: '1847.53L Cr' },
  { sym: 'LAURUS30', name: 'Laurus Beverages Ltd', exc: 'NSE', sec: 'FMCG', price: 2686.91, chg: 3.36, pe: 94.0, hi: 3557.0, lo: 1661.1, mc: '13382.64L Cr' },
  { sym: 'ALKYL31', name: 'Alkyl Systems Ltd', exc: 'NSE', sec: 'Defence', price: 3469.77, chg: -3.62, pe: 58.8, hi: 4488.53, lo: 2961.7, mc: '26263.82L Cr' },
  { sym: 'HAL32', name: 'HAL Pharma Ltd', exc: 'BSE', sec: 'Pharma', price: 3630.13, chg: 4.96, pe: 97.8, hi: 4449.05, lo: 2434.36, mc: '38443.23L Cr' },
  { sym: 'HAL33', name: 'HAL Products Ltd', exc: 'NSE', sec: 'Consumer', price: 361.32, chg: 0.66, pe: 29.6, hi: 384.6, lo: 247.05, mc: '0.94K Cr' },
  { sym: 'RAMCO34', name: 'Ramco Lifestyle Ltd', exc: 'BSE', sec: 'Consumer', price: 1156.41, chg: 1.36, pe: 111.9, hi: 1245.97, lo: 730.34, mc: '5477.79L Cr' },
  { sym: 'HEIDEL35', name: 'HeidelbergCement Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 260.69, chg: -2.24, pe: 70.9, hi: 315.85, lo: 156.84, mc: '467.60L Cr' },
  { sym: 'CEAT36', name: 'CEAT Motors Ltd', exc: 'NSE', sec: 'Auto', price: 7795.95, chg: 3.53, pe: 132.0, hi: 10721.45, lo: 6246.22, mc: '104623.40L Cr' },
  { sym: 'GUJARA37', name: 'Gujarat Adani Properties Ltd', exc: 'BSE', sec: 'Realty', price: 625.18, chg: 5.11, pe: 71.8, hi: 803.19, lo: 381.09, mc: '112.19L Cr' },
  { sym: 'VOLTAS38', name: 'Voltas Drugs Ltd', exc: 'NSE', sec: 'Pharma', price: 4835.32, chg: -0.38, pe: 82.7, hi: 6432.56, lo: 3346.88, mc: '11264.34L Cr' },
  { sym: 'DLF39', name: 'DLF Beverages Ltd', exc: 'BSE', sec: 'FMCG', price: 1659.17, chg: -1.36, pe: 88.2, hi: 1863.44, lo: 1428.8, mc: '6120.50L Cr' },
  { sym: 'BLUEST40', name: 'Blue Star Consumer Goods Ltd', exc: 'NSE', sec: 'FMCG', price: 6024.56, chg: -2.43, pe: 41.2, hi: 7816.5, lo: 3943.67, mc: '11888.95L Cr' },
  { sym: 'ADANIG41', name: 'Adani Green Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 3165.68, chg: 5.08, pe: 58.8, hi: 3723.37, lo: 2894.52, mc: '32285.32L Cr' },
  { sym: 'ADANIG42', name: 'Adani Green Products Ltd', exc: 'BSE', sec: 'Consumer', price: 671.18, chg: -1.7, pe: 88.6, hi: 719.28, lo: 590.47, mc: '3503.55L Cr' },
  { sym: 'IRFC43', name: 'IRFC Automobiles Ltd', exc: 'BSE', sec: 'Auto', price: 4967.12, chg: 0.07, pe: 80.1, hi: 5842.63, lo: 2994.91, mc: '25830.98L Cr' },
  { sym: 'AMARA44', name: 'Amara Finance Ltd', exc: 'BSE', sec: 'Finance', price: 787.04, chg: 0.99, pe: 73.3, hi: 1019.4, lo: 573.02, mc: '1715.74L Cr' },
  { sym: 'JKCEME45', name: 'JK Cement Consumer Goods Ltd', exc: 'BSE', sec: 'FMCG', price: 7396.8, chg: 0.01, pe: 147.0, hi: 9796.36, lo: 6545.92, mc: '85969.08L Cr' },
  { sym: 'HAVELL46', name: 'Havells Automobiles Ltd', exc: 'BSE', sec: 'Auto', price: 10333.18, chg: 3.5, pe: 73.6, hi: 10890.11, lo: 7724.39, mc: '24933.99L Cr' },
  { sym: 'ENDURA47', name: 'Endurance Drugs Ltd', exc: 'BSE', sec: 'Pharma', price: 3980.33, chg: 1.12, pe: 62.8, hi: 5278.78, lo: 2471.84, mc: '31215.44L Cr' },
  { sym: 'MRF48', name: 'MRF Drugs Ltd', exc: 'NSE', sec: 'Pharma', price: 3314.03, chg: -0.89, pe: 140.1, hi: 3821.36, lo: 2011.43, mc: '7005.86L Cr' },
  { sym: 'COCHIN49', name: 'Cochin Shipyard Housing Ltd', exc: 'NSE', sec: 'Realty', price: 598.01, chg: -2.75, pe: 56.5, hi: 788.94, lo: 460.84, mc: '7847.90L Cr' },
  { sym: 'MUTHOO50', name: 'Muthoot Constructions Ltd', exc: 'BSE', sec: 'Infra', price: 2399.2, chg: 1.91, pe: 66.2, hi: 3106.78, lo: 1779.42, mc: '3844.36L Cr' },
  { sym: 'COCHIN51', name: 'Cochin Shipyard Alloys Ltd', exc: 'NSE', sec: 'Metals', price: 431.1, chg: 2.6, pe: 62.3, hi: 605.73, lo: 376.5, mc: '6074.12L Cr' },
  { sym: 'SOBHA52', name: 'Sobha Motors Ltd', exc: 'BSE', sec: 'Auto', price: 5202.27, chg: -3.25, pe: 41.5, hi: 7010.32, lo: 4486.48, mc: '8847.52L Cr' },
  { sym: 'ALKYL53', name: 'Alkyl Investments Ltd', exc: 'NSE', sec: 'Finance', price: 2819.86, chg: -3.96, pe: 81.0, hi: 4084.3, lo: 1794.49, mc: '3259.23L Cr' },
  { sym: 'SYMPHO54', name: 'Symphony Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 240.87, chg: -0.07, pe: 81.4, hi: 269.35, lo: 147.49, mc: '1576.27L Cr' },
  { sym: 'GLAND55', name: 'Gland Paints Ltd', exc: 'BSE', sec: 'Chemicals', price: 1247.9, chg: 0.99, pe: 142.5, hi: 1579.49, lo: 1006.79, mc: '8567.11L Cr' },
  { sym: 'PARAS56', name: 'Paras Fashion Ltd', exc: 'BSE', sec: 'Textiles', price: 352.2, chg: -1.4, pe: 83.3, hi: 483.18, lo: 265.79, mc: '689.08L Cr' },
  { sym: 'HEIDEL57', name: 'HeidelbergCement Retail Ltd', exc: 'NSE', sec: 'Consumer', price: 200.44, chg: -1.06, pe: 6.2, hi: 284.39, lo: 186.7, mc: '36.44L Cr' },
  { sym: 'SAGARC58', name: 'Sagar Cement Infrastructure Ltd', exc: 'BSE', sec: 'Infra', price: 3045.47, chg: 0.98, pe: 132.9, hi: 3730.22, lo: 2093.65, mc: '28290.40L Cr' },
  { sym: 'WOCKHA59', name: 'Wockhardt Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 668.39, chg: 1.75, pe: 121.0, hi: 865.76, lo: 563.37, mc: '2372.60L Cr' },
  { sym: 'ESSAR60', name: 'Essar Automobiles Ltd', exc: 'BSE', sec: 'Auto', price: 5189.68, chg: -3.13, pe: 71.0, hi: 6389.05, lo: 4386.14, mc: '16729.56L Cr' },
  { sym: 'TATA61', name: 'Tata Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 6800.13, chg: 5.22, pe: 23.1, hi: 8332.65, lo: 4099.6, mc: '303.01L Cr' },
  { sym: 'NUVOCO62', name: 'Nuvoco Electric Ltd', exc: 'BSE', sec: 'Energy', price: 550.67, chg: 5.48, pe: 119.8, hi: 650.95, lo: 492.98, mc: '686.28L Cr' },
  { sym: 'ALKYL63', name: 'Alkyl Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1214.15, chg: -2.58, pe: 123.5, hi: 1677.11, lo: 780.32, mc: '4784.68L Cr' },
  { sym: 'GODREJ64', name: 'Godrej Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1741.49, chg: 0.11, pe: 80.6, hi: 2512.7, lo: 1333.09, mc: '7572.80L Cr' },
  { sym: 'BAJAJ65', name: 'Bajaj Minerals Ltd', exc: 'NSE', sec: 'Metals', price: 784.66, chg: 0.71, pe: 97.6, hi: 886.27, lo: 714.54, mc: '3058.06L Cr' },
  { sym: 'APOLLO66', name: 'Apollo Tyres Bank Ltd', exc: 'NSE', sec: 'Finance', price: 1953.79, chg: -2.83, pe: 22.3, hi: 2668.21, lo: 1178.38, mc: '1303.88L Cr' },
  { sym: 'TORREN67', name: 'Torrent Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 931.38, chg: -2.92, pe: -1, hi: 1208.43, lo: 862.27, mc: '11679.10L Cr' },
  { sym: 'PFC68', name: 'PFC Software Ltd', exc: 'BSE', sec: 'Technology', price: 3329.5, chg: 3.41, pe: 38.7, hi: 4803.37, lo: 2916.63, mc: '40693.74L Cr' },
  { sym: 'AMBUJA69', name: 'Ambuja Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 336.3, chg: 2.74, pe: 10.7, hi: 448.17, lo: 267.58, mc: '1808.42L Cr' },
  { sym: 'APOLLO70', name: 'Apollo Tyres Developers Ltd', exc: 'NSE', sec: 'Realty', price: 566.44, chg: -1.75, pe: 137.6, hi: 720.4, lo: 353.52, mc: '533.09L Cr' },
  { sym: 'ADANIW71', name: 'Adani Wilmar Products Ltd', exc: 'BSE', sec: 'Consumer', price: 1444.13, chg: -0.71, pe: 7.7, hi: 2011.29, lo: 1258.71, mc: '4999.80L Cr' },
  { sym: 'IRFC72', name: 'IRFC Labs Ltd', exc: 'BSE', sec: 'Pharma', price: 1151.88, chg: 3.16, pe: 46.1, hi: 1398.29, lo: 820.95, mc: '1475.56L Cr' },
  { sym: 'GODREJ73', name: 'Godrej Systems Ltd', exc: 'NSE', sec: 'Technology', price: 1839.79, chg: -3.43, pe: 9.6, hi: 2404.05, lo: 1354.1, mc: '11321.75L Cr' },
  { sym: 'WHIRLP74', name: 'Whirlpool Housing Ltd', exc: 'BSE', sec: 'Realty', price: 77.31, chg: 2.68, pe: -1, hi: 109.66, lo: 64.13, mc: '1196.90L Cr' },
  { sym: 'ADANIP75', name: 'Adani Ports Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 913.57, chg: 3.72, pe: 13.5, hi: 1184.69, lo: 717.3, mc: '11219.89L Cr' },
  { sym: 'EMAMI76', name: 'Emami Bank Ltd', exc: 'NSE', sec: 'Finance', price: 2887.67, chg: 2.75, pe: 32.5, hi: 3639.84, lo: 1984.02, mc: '6759.40L Cr' },
  { sym: 'ADANIT77', name: 'Adani Total Products Ltd', exc: 'BSE', sec: 'FMCG', price: 14960.25, chg: -0.92, pe: 101.5, hi: 20991.17, lo: 9849.58, mc: '22047.25L Cr' },
  { sym: 'HAL78', name: 'HAL Mining Ltd', exc: 'NSE', sec: 'Metals', price: 677.97, chg: 4.84, pe: 84.8, hi: 982.2, lo: 607.26, mc: '3563.57L Cr' },
  { sym: 'YATHAR79', name: 'Yatharth Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 1579.77, chg: -2.36, pe: 139.3, hi: 1819.32, lo: 1479.58, mc: '5703.20L Cr' },
  { sym: 'HAL80', name: 'HAL Foods Ltd', exc: 'NSE', sec: 'FMCG', price: 24577.32, chg: 0.68, pe: 48.8, hi: 28758.75, lo: 16655.08, mc: '13244.27L Cr' },
  { sym: 'LAURUS81', name: 'Laurus Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 2309.91, chg: 1.21, pe: 18.7, hi: 2850.77, lo: 1512.15, mc: '10919.41L Cr' },
  { sym: 'ENDURA82', name: 'Endurance Power Ltd', exc: 'NSE', sec: 'Energy', price: 458.74, chg: 1.2, pe: 36.5, hi: 495.84, lo: 327.38, mc: '2185.50L Cr' },
  { sym: 'ENDURA83', name: 'Endurance Textiles Ltd', exc: 'NSE', sec: 'Textiles', price: 516.66, chg: 2.81, pe: 16.4, hi: 554.05, lo: 449.4, mc: '2947.15L Cr' },
  { sym: 'VOLTAS84', name: 'Voltas Builders Ltd', exc: 'NSE', sec: 'Infra', price: 6984.33, chg: 4.79, pe: 96.7, hi: 7484.77, lo: 5472.46, mc: '25418.64L Cr' },
  { sym: 'MISHRA85', name: 'Mishra Dhatu Mining Ltd', exc: 'NSE', sec: 'Metals', price: 251.58, chg: 5.21, pe: 88.4, hi: 273.22, lo: 188.98, mc: '619.43L Cr' },
  { sym: 'STK0481', name: 'Adani Ports Steel Ltd', exc: 'NSE', sec: 'Metals', price: 612.96, chg: 0.98, pe: 62.8, hi: 750.14, lo: 517.49, mc: '4541.94L Cr' },
  { sym: 'JUPITE87', name: 'Jupiter Energy Ltd', exc: 'BSE', sec: 'Energy', price: 522.76, chg: 1.11, pe: 81.0, hi: 599.57, lo: 362.37, mc: '3095.10L Cr' },
  { sym: 'HINDAL88', name: 'Hindalco Developers Ltd', exc: 'NSE', sec: 'Realty', price: 156.9, chg: -0.85, pe: 55.0, hi: 205.88, lo: 136.41, mc: '189.66L Cr' },
  { sym: 'JSW89', name: 'JSW Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1614.48, chg: 4.74, pe: 104.4, hi: 1795.94, lo: 1380.33, mc: '2067.49L Cr' },
  { sym: 'HEIDEL90', name: 'HeidelbergCement Utilities Ltd', exc: 'NSE', sec: 'Energy', price: 1316.25, chg: -4.36, pe: 21.1, hi: 1619.02, lo: 800.23, mc: '2991.27L Cr' },
  { sym: 'MFAC91', name: 'MFAC Energy Ltd', exc: 'BSE', sec: 'Energy', price: 694.66, chg: 2.45, pe: 59.6, hi: 981.15, lo: 544.88, mc: '247.05L Cr' },
  { sym: 'COCHIN92', name: 'Cochin Shipyard Power Ltd', exc: 'BSE', sec: 'Energy', price: 139.46, chg: -3.83, pe: 101.1, hi: 197.36, lo: 101.26, mc: '90.52L Cr' },
  { sym: 'AMBUJA93', name: 'Ambuja Fashion Ltd', exc: 'BSE', sec: 'Textiles', price: 200.21, chg: 5.27, pe: -1, hi: 235.48, lo: 180.86, mc: '414.28L Cr' },
  { sym: 'NBCC94', name: 'NBCC Motors Ltd', exc: 'BSE', sec: 'Auto', price: 6903.98, chg: -4.1, pe: 49.2, hi: 8602.17, lo: 5941.13, mc: '1790.58L Cr' },
  { sym: 'DIVI95', name: 'Divi Alloys Ltd', exc: 'BSE', sec: 'Metals', price: 258.41, chg: 3.62, pe: 132.4, hi: 363.37, lo: 228.74, mc: '86.59L Cr' },
  { sym: 'RAMCO96', name: 'Ramco Retail Ltd', exc: 'NSE', sec: 'Consumer', price: 928.2, chg: -3.62, pe: 144.3, hi: 1202.0, lo: 760.13, mc: '1048.65L Cr' },
  { sym: 'BEL97', name: 'BEL Medical Ltd', exc: 'BSE', sec: 'Healthcare', price: 3888.04, chg: -0.01, pe: 99.6, hi: 4986.07, lo: 3263.69, mc: '2312.86L Cr' },
  { sym: 'STK0493', name: 'Adani Total FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 10865.59, chg: 2.06, pe: 27.9, hi: 11703.61, lo: 8546.18, mc: '30069.64L Cr' },
  { sym: 'ADANIG99', name: 'Adani Green Paints Ltd', exc: 'NSE', sec: 'Chemicals', price: 2599.36, chg: 4.3, pe: 64.6, hi: 3189.94, lo: 2409.14, mc: '43414.16L Cr' },
  { sym: 'MARICO1', name: 'Marico Retail Ltd', exc: 'NSE', sec: 'Consumer', price: 3939.72, chg: -2.65, pe: 93.7, hi: 4557.25, lo: 3145.73, mc: '4371.42L Cr' },
  { sym: 'REC2', name: 'REC Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 2707.05, chg: -3.16, pe: 73.0, hi: 3545.77, lo: 1798.54, mc: '10058.44L Cr' },
  { sym: 'HINDAL3', name: 'Hindalco Hospitals Ltd', exc: 'NSE', sec: 'Healthcare', price: 1893.4, chg: 4.75, pe: 37.3, hi: 2496.52, lo: 1270.46, mc: '1438.25L Cr' },
  { sym: 'RATNAM4', name: 'Ratnamani Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 1469.37, chg: -0.22, pe: 93.1, hi: 2027.34, lo: 1252.01, mc: '10893.52L Cr' },
  { sym: 'WELSPU5', name: 'Welspun Developers Ltd', exc: 'NSE', sec: 'Realty', price: 544.62, chg: 3.77, pe: -1, hi: 788.79, lo: 425.65, mc: '3181.80L Cr' },
  { sym: 'DATAPA6', name: 'Data Patterns Motors Ltd', exc: 'BSE', sec: 'Auto', price: 6387.07, chg: -2.6, pe: 133.2, hi: 8683.04, lo: 4471.4, mc: '6427.60L Cr' },
  { sym: 'MUTHOO7', name: 'Muthoot Apparel Ltd', exc: 'NSE', sec: 'Textiles', price: 582.97, chg: 3.8, pe: 109.8, hi: 638.51, lo: 508.67, mc: '7645.27L Cr' },
  { sym: 'WELSPU8', name: 'Welspun Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 1771.53, chg: -2.71, pe: 108.3, hi: 2003.2, lo: 1344.84, mc: '6165.55L Cr' },
  { sym: 'KANSAI9', name: 'Kansai Textiles Ltd', exc: 'NSE', sec: 'Textiles', price: 602.86, chg: -3.36, pe: 57.6, hi: 759.32, lo: 442.76, mc: '4927.53L Cr' },
  { sym: 'BAJAJ10', name: 'Bajaj Healthcare Ltd', exc: 'BSE', sec: 'Healthcare', price: 2291.31, chg: 4.62, pe: 100.6, hi: 2543.44, lo: 2071.54, mc: '5873.55L Cr' },
  { sym: 'ADANIT11', name: 'Adani Total Projects Ltd', exc: 'BSE', sec: 'Infra', price: 1651.16, chg: -1.61, pe: 135.3, hi: 2368.05, lo: 992.74, mc: '558.32L Cr' },
  { sym: 'ADITYA12', name: 'Aditya Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1223.95, chg: -2.12, pe: 74.0, hi: 1485.95, lo: 768.39, mc: '3707.00L Cr' },
  { sym: 'RAINBO13', name: 'Rainbow Children Automobiles Ltd', exc: 'BSE', sec: 'Auto', price: 7589.29, chg: -4.01, pe: 99.7, hi: 8080.23, lo: 6821.56, mc: '85026.30L Cr' },
  { sym: 'HERO', name: 'Hero Consumer Ltd', exc: 'BSE', sec: 'Consumer', price: 2773.1, chg: -0.33, pe: 102.5, hi: 3589.6, lo: 2335.03, mc: '26058.76L Cr' },
  { sym: 'SHREEC15', name: 'Shree Cement Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 3047.47, chg: -3.57, pe: 58.4, hi: 3661.77, lo: 1900.66, mc: '14463.86L Cr' },
  { sym: 'REC16', name: 'REC Commerce Ltd', exc: 'BSE', sec: 'Consumer', price: 533.46, chg: -1.21, pe: 35.4, hi: 604.74, lo: 330.94, mc: '5973.64L Cr' },
  { sym: 'REC17', name: 'REC Vehicles Ltd', exc: 'NSE', sec: 'Auto', price: 7513.11, chg: -0.23, pe: 42.7, hi: 9617.21, lo: 6146.74, mc: '86116.77L Cr' },
  { sym: 'SOBHA18', name: 'Sobha Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 1137.26, chg: 2.59, pe: 5.2, hi: 1205.03, lo: 931.32, mc: '2287.33L Cr' },
  { sym: 'MRF19', name: 'MRF Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 2242.12, chg: 1.1, pe: 6.6, hi: 2534.66, lo: 1566.28, mc: '11152.46L Cr' },
  { sym: 'BERGER20', name: 'Berger Vehicles Ltd', exc: 'BSE', sec: 'Auto', price: 9297.58, chg: -1.09, pe: 94.3, hi: 9870.75, lo: 6150.07, mc: '21197.87L Cr' },
  { sym: 'ORIENT21', name: 'Orient Cement Pharma Ltd', exc: 'BSE', sec: 'Pharma', price: 4601.77, chg: 1.96, pe: 95.9, hi: 6473.88, lo: 3625.91, mc: '24270.43L Cr' },
  { sym: 'ENDURA22', name: 'Endurance Builders Ltd', exc: 'NSE', sec: 'Infra', price: 6713.82, chg: 2.75, pe: 82.7, hi: 7608.81, lo: 5639.09, mc: '95469.89L Cr' },
  { sym: 'MINDA23', name: 'Minda Steel Ltd', exc: 'NSE', sec: 'Metals', price: 1165.97, chg: -1.11, pe: 82.5, hi: 1301.67, lo: 946.76, mc: '550.34L Cr' },
  { sym: 'BALKRI24', name: 'Balkrishna Defence Ltd', exc: 'NSE', sec: 'Defence', price: 3115.8, chg: -1.79, pe: -1, hi: 4364.67, lo: 2274.7, mc: '16004.52L Cr' },
  { sym: 'ACC25', name: 'ACC Motors Ltd', exc: 'BSE', sec: 'Auto', price: 2430.15, chg: 3.28, pe: 69.3, hi: 2575.9, lo: 1868.62, mc: '4822.15L Cr' },
  { sym: 'STRIDE26', name: 'Strides Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 460.87, chg: 3.26, pe: 131.4, hi: 635.47, lo: 427.83, mc: '882.14L Cr' },
  { sym: 'NBCC27', name: 'NBCC Products Ltd', exc: 'NSE', sec: 'FMCG', price: 11592.34, chg: -3.34, pe: 11.4, hi: 16104.65, lo: 10492.88, mc: '68863.75L Cr' },
  { sym: 'ADANIG28', name: 'Adani Green Financial Ltd', exc: 'BSE', sec: 'Finance', price: 142.71, chg: 1.89, pe: 34.1, hi: 166.2, lo: 112.21, mc: '1487.76L Cr' },
  { sym: 'BERGER29', name: 'Berger Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 955.98, chg: 5.08, pe: 19.8, hi: 1211.24, lo: 757.4, mc: '4897.97L Cr' },
  { sym: 'PRESTI30', name: 'Prestige Defence Ltd', exc: 'NSE', sec: 'Defence', price: 2722.25, chg: -1.39, pe: 83.4, hi: 2913.6, lo: 1660.97, mc: '2948.56L Cr' },
  { sym: 'RAMCO31', name: 'Ramco Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 871.73, chg: 2.55, pe: 96.3, hi: 1155.96, lo: 659.07, mc: '2103.82L Cr' },
  { sym: 'GUJARA32', name: 'Gujarat Adani Electric Ltd', exc: 'NSE', sec: 'Energy', price: 1463.15, chg: 1.18, pe: -1, hi: 2005.89, lo: 1235.64, mc: '907.26L Cr' },
  { sym: 'WHIRLP33', name: 'Whirlpool Pharmaceuticals Ltd', exc: 'BSE', sec: 'Pharma', price: 2485.09, chg: 4.11, pe: 137.4, hi: 2999.08, lo: 2099.57, mc: '26153.97L Cr' },
  { sym: 'MAHIND34', name: 'Mahindra Textiles Ltd', exc: 'BSE', sec: 'Textiles', price: 315.71, chg: 0.25, pe: 71.9, hi: 353.07, lo: 274.28, mc: '519.68L Cr' },
  { sym: 'SAGARC35', name: 'Sagar Cement Bank Ltd', exc: 'BSE', sec: 'Finance', price: 1653.35, chg: -1.24, pe: 119.9, hi: 2088.34, lo: 1223.95, mc: '8546.05L Cr' },
  { sym: 'INDIAC36', name: 'India Cement Motors Ltd', exc: 'NSE', sec: 'Auto', price: 14621.43, chg: -1.09, pe: 90.7, hi: 19939.62, lo: 11000.78, mc: '126435.90L Cr' },
  { sym: 'OBEROI37', name: 'Oberoi Petroleum Ltd', exc: 'NSE', sec: 'Energy', price: 1027.66, chg: 3.87, pe: 91.4, hi: 1212.79, lo: 651.72, mc: '2883.83L Cr' },
  { sym: 'IRFC38', name: 'IRFC Builders Ltd', exc: 'NSE', sec: 'Infra', price: 4866.42, chg: 3.21, pe: 76.7, hi: 6394.8, lo: 3074.05, mc: '70653.11L Cr' },
  { sym: 'MAZAGO39', name: 'Mazagon Dock Fabrics Ltd', exc: 'NSE', sec: 'Textiles', price: 629.95, chg: 0.03, pe: 94.3, hi: 774.12, lo: 423.31, mc: '3391.13L Cr' },
  { sym: 'TATAST40', name: 'Tata Steel Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3755.5, chg: 5.4, pe: 93.7, hi: 4710.03, lo: 3367.45, mc: '4597.00L Cr' },
  { sym: 'STK0535', name: 'Rainbow Children Garments Ltd', exc: 'NSE', sec: 'Textiles', price: 100.59, chg: -3.4, pe: 9.5, hi: 122.99, lo: 81.13, mc: '899.17L Cr' },
  { sym: 'ORIENT42', name: 'Orient Constructions Ltd', exc: 'BSE', sec: 'Infra', price: 2260.67, chg: 0.25, pe: 60.8, hi: 3209.68, lo: 2021.01, mc: '6976.45L Cr' },
  { sym: 'OBEROI43', name: 'Oberoi Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 1199.66, chg: -3.06, pe: 100.4, hi: 1727.5, lo: 776.81, mc: '2668.20L Cr' },
  { sym: 'PFC44', name: 'PFC Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 2249.92, chg: 4.8, pe: 70.9, hi: 2744.11, lo: 1995.74, mc: '4045.19L Cr' },
  { sym: 'NHPC45', name: 'NHPC Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 4707.92, chg: 2.62, pe: 139.4, hi: 6028.68, lo: 2879.89, mc: '1763.55L Cr' },
  { sym: 'REC46', name: 'REC Steel Ltd', exc: 'NSE', sec: 'Metals', price: 729.9, chg: -3.08, pe: 147.6, hi: 1053.59, lo: 636.91, mc: '593.89L Cr' },
  { sym: 'DATAPA47', name: 'Data Patterns Textiles Ltd', exc: 'NSE', sec: 'Textiles', price: 271.66, chg: 2.34, pe: 89.0, hi: 351.86, lo: 248.91, mc: '60.13L Cr' },
  { sym: 'STK0542', name: 'MRF Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1275.74, chg: -0.97, pe: 47.7, hi: 1425.01, lo: 1075.79, mc: '4744.36L Cr' },
  { sym: 'STK0543', name: 'Alkyl Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1184.25, chg: 1.23, pe: 47.3, hi: 1592.76, lo: 721.86, mc: '1557.19L Cr' },
  { sym: 'BEML50', name: 'BEML Financial Ltd', exc: 'BSE', sec: 'Finance', price: 578.9, chg: -1.75, pe: 112.5, hi: 747.67, lo: 531.75, mc: '5669.74L Cr' },
  { sym: 'PFC51', name: 'PFC Metals Ltd', exc: 'NSE', sec: 'Metals', price: 372.6, chg: 0.35, pe: 130.0, hi: 442.33, lo: 234.57, mc: '1013.34L Cr' },
  { sym: 'HINDAL52', name: 'Hindalco Health Ltd', exc: 'BSE', sec: 'Healthcare', price: 3060.49, chg: -2.12, pe: 97.4, hi: 3471.64, lo: 2622.92, mc: '13654.36L Cr' },
  { sym: 'AARTI53', name: 'Aarti Systems Ltd', exc: 'NSE', sec: 'Defence', price: 1157.57, chg: 0.26, pe: 142.5, hi: 1642.57, lo: 789.21, mc: '6270.53L Cr' },
  { sym: 'TATAST54', name: 'Tata Steel Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 2746.12, chg: -1.61, pe: 60.4, hi: 3230.19, lo: 2157.32, mc: '5585.50L Cr' },
  { sym: 'TATAST55', name: 'Tata Steel Vehicles Ltd', exc: 'BSE', sec: 'Auto', price: 11491.73, chg: -1.15, pe: 19.3, hi: 15074.13, lo: 8468.3, mc: '133576.55L Cr' },
  { sym: 'MISHRA56', name: 'Mishra Dhatu FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 13094.82, chg: -1.37, pe: -1, hi: 13793.96, lo: 8168.33, mc: '57125.54L Cr' },
  { sym: 'NLC57', name: 'NLC Drugs Ltd', exc: 'BSE', sec: 'Pharma', price: 1919.7, chg: -1.98, pe: -1, hi: 2491.31, lo: 1190.04, mc: '20423.76L Cr' },
  { sym: 'KANSAI58', name: 'Kansai Power Ltd', exc: 'NSE', sec: 'Energy', price: 1091.31, chg: 4.06, pe: 100.2, hi: 1538.7, lo: 871.0, mc: '18936.46L Cr' },
  { sym: 'AARTI59', name: 'Aarti Foods Ltd', exc: 'NSE', sec: 'FMCG', price: 6482.73, chg: 1.89, pe: 45.1, hi: 7914.07, lo: 5939.39, mc: '32962.02L Cr' },
  { sym: 'JINDAL', name: 'Jindal Health Ltd', exc: 'NSE', sec: 'Healthcare', price: 2230.1, chg: -0.61, pe: 42.4, hi: 3066.66, lo: 1476.94, mc: '3052.58L Cr' },
  { sym: 'DEEPAK61', name: 'Deepak Nitrite Power Ltd', exc: 'BSE', sec: 'Energy', price: 279.86, chg: -3.06, pe: 36.7, hi: 365.87, lo: 257.31, mc: '449.58L Cr' },
  { sym: 'EXIDE62', name: 'Exide Capital Ltd', exc: 'NSE', sec: 'Finance', price: 1778.33, chg: -4.31, pe: 99.7, hi: 1867.86, lo: 1090.55, mc: '2225.11L Cr' },
  { sym: 'LAURUS63', name: 'Laurus Mining Ltd', exc: 'BSE', sec: 'Metals', price: 542.7, chg: 0.28, pe: 110.5, hi: 746.16, lo: 338.94, mc: '959.09L Cr' },
  { sym: 'SOLARA64', name: 'Solara Consumer Goods Ltd', exc: 'BSE', sec: 'FMCG', price: 2555.89, chg: -1.17, pe: 13.0, hi: 3702.99, lo: 2112.38, mc: '15978.41L Cr' },
  { sym: 'ADANIG65', name: 'Adani Green Alloys Ltd', exc: 'NSE', sec: 'Metals', price: 1022.12, chg: 1.98, pe: 10.7, hi: 1230.29, lo: 681.6, mc: '12770.12L Cr' },
  { sym: 'DATAPA66', name: 'Data Patterns Labs Ltd', exc: 'BSE', sec: 'Pharma', price: 2560.89, chg: 2.85, pe: 33.0, hi: 3426.2, lo: 2068.0, mc: '1814.17L Cr' },
  { sym: 'DECCAN67', name: 'Deccan Cement Auto Ltd', exc: 'BSE', sec: 'Auto', price: 6196.34, chg: 5.17, pe: -1, hi: 7347.09, lo: 4450.22, mc: '36771.53L Cr' },
  { sym: 'SOLARA68', name: 'Solara Energy Ltd', exc: 'BSE', sec: 'Energy', price: 1132.9, chg: 2.91, pe: 15.4, hi: 1522.83, lo: 873.59, mc: '402.33L Cr' },
  { sym: 'COCHIN69', name: 'Cochin Shipyard Real Estate Ltd', exc: 'NSE', sec: 'Realty', price: 280.55, chg: -4.36, pe: 136.2, hi: 386.68, lo: 177.88, mc: '2871.47L Cr' },
  { sym: 'HAL70', name: 'HAL Investments Ltd', exc: 'NSE', sec: 'Finance', price: 475.41, chg: -2.29, pe: 66.8, hi: 653.5, lo: 448.68, mc: '2135.52L Cr' },
  { sym: 'SAGARC71', name: 'Sagar Cement Pharmaceuticals Ltd', exc: 'NSE', sec: 'Pharma', price: 2454.65, chg: 3.14, pe: 53.6, hi: 2695.94, lo: 1594.13, mc: '14263.26L Cr' },
  { sym: 'STK0566', name: 'Global Health Motors Ltd', exc: 'NSE', sec: 'Auto', price: 6860.59, chg: -3.17, pe: 96.7, hi: 8235.81, lo: 4495.15, mc: '10853.10L Cr' },
  { sym: 'HUDCO73', name: 'HUDCO Infotech Ltd', exc: 'NSE', sec: 'Technology', price: 7446.03, chg: 1.44, pe: 105.6, hi: 10177.95, lo: 5708.16, mc: '2875.71L Cr' },
  { sym: 'DLF74', name: 'DLF Products Ltd', exc: 'BSE', sec: 'Consumer', price: 1324.29, chg: 2.42, pe: 109.0, hi: 1714.72, lo: 835.37, mc: '6746.96L Cr' },
  { sym: 'PURAVA75', name: 'Puravankara Infrastructure Ltd', exc: 'NSE', sec: 'Infra', price: 4550.14, chg: 5.37, pe: 94.7, hi: 6347.87, lo: 4301.58, mc: '21699.03L Cr' },
  { sym: 'PURAVA76', name: 'Puravankara Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 2152.06, chg: 3.47, pe: 145.4, hi: 2668.05, lo: 1424.05, mc: '1519.99L Cr' },
  { sym: 'TATAST77', name: 'Tata Steel Drugs Ltd', exc: 'BSE', sec: 'Pharma', price: 1604.06, chg: -1.16, pe: 115.0, hi: 1712.06, lo: 1378.12, mc: '5463.44L Cr' },
  { sym: 'BERGER78', name: 'Berger Defence Ltd', exc: 'NSE', sec: 'Defence', price: 2455.18, chg: 4.45, pe: 90.9, hi: 2898.07, lo: 1643.9, mc: '11051.18L Cr' },
  { sym: 'EMAMI79', name: 'Emami Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1978.4, chg: 2.88, pe: 59.5, hi: 2251.94, lo: 1513.17, mc: '17098.12L Cr' },
  { sym: 'STK0574', name: 'Ratnamani Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 6524.05, chg: -0.63, pe: 109.4, hi: 8499.59, lo: 6142.03, mc: '3593.80L Cr' },
  { sym: 'STK0575', name: 'Berger Beverages Ltd', exc: 'NSE', sec: 'FMCG', price: 7158.98, chg: 0.09, pe: 54.8, hi: 10055.24, lo: 5807.88, mc: '72542.81L Cr' },
  { sym: 'SEQUEN82', name: 'Sequent Real Estate Ltd', exc: 'NSE', sec: 'Realty', price: 599.22, chg: -3.64, pe: 75.9, hi: 867.83, lo: 483.6, mc: '2872.90L Cr' },
  { sym: 'SYMPHO83', name: 'Symphony FMCG Ltd', exc: 'BSE', sec: 'FMCG', price: 14763.15, chg: -1.23, pe: 134.3, hi: 18995.87, lo: 9627.63, mc: '2546.38L Cr' },
  { sym: 'NHPC84', name: 'NHPC Innovations Ltd', exc: 'NSE', sec: 'Technology', price: 7934.55, chg: 0.54, pe: 62.2, hi: 10901.17, lo: 6695.4, mc: '7816.77L Cr' },
  { sym: 'HINDAL85', name: 'Hindalco Finance Ltd', exc: 'NSE', sec: 'Finance', price: 2125.51, chg: -3.17, pe: 98.9, hi: 2308.92, lo: 1632.23, mc: '9162.77L Cr' },
  { sym: 'AARTI86', name: 'Aarti Petrochemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 3422.19, chg: 4.24, pe: 119.5, hi: 4100.36, lo: 2609.43, mc: '37371.04L Cr' },
  { sym: 'MRF87', name: 'MRF Investments Ltd', exc: 'BSE', sec: 'Finance', price: 1797.53, chg: -4.17, pe: 44.1, hi: 2567.66, lo: 1419.78, mc: '22561.60L Cr' },
  { sym: 'JINDAL88', name: 'Jindal Investments Ltd', exc: 'BSE', sec: 'Finance', price: 1497.95, chg: 4.95, pe: 133.8, hi: 1639.34, lo: 1090.44, mc: '6900.64L Cr' },
  { sym: 'ADANIW89', name: 'Adani Wilmar Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 4101.0, chg: -3.12, pe: 83.2, hi: 5370.73, lo: 3519.0, mc: '53838.73L Cr' },
  { sym: 'ADANIG90', name: 'Adani Green FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 18878.7, chg: -1.3, pe: 78.0, hi: 23016.38, lo: 11687.07, mc: '64508.52L Cr' },
  { sym: 'SOLARA91', name: 'Solara Vehicles Ltd', exc: 'NSE', sec: 'Auto', price: 7317.38, chg: 0.02, pe: 102.6, hi: 9712.28, lo: 6895.38, mc: '25394.26L Cr' },
  { sym: 'RAMCO92', name: 'Ramco Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 125.4, chg: -1.62, pe: 20.9, hi: 145.51, lo: 105.83, mc: '1091.29L Cr' },
  { sym: 'IRFC93', name: 'IRFC Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 4750.96, chg: 0.24, pe: 112.0, hi: 5029.33, lo: 3164.95, mc: '1720.79L Cr' },
  { sym: 'CEAT94', name: 'CEAT Paints Ltd', exc: 'BSE', sec: 'Chemicals', price: 1117.48, chg: 0.36, pe: 81.9, hi: 1418.52, lo: 849.62, mc: '11405.53L Cr' },
  { sym: 'VOLTAS95', name: 'Voltas Lifestyle Ltd', exc: 'NSE', sec: 'Consumer', price: 3988.48, chg: -0.78, pe: 127.6, hi: 4424.56, lo: 2790.08, mc: '47479.12L Cr' },
  { sym: 'DLF96', name: 'DLF Healthcare Ltd', exc: 'BSE', sec: 'Healthcare', price: 892.67, chg: -2.89, pe: 149.1, hi: 1142.45, lo: 673.35, mc: '1407.66L Cr' },
  { sym: 'STK0591', name: 'JK Tyre FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 16705.72, chg: -0.77, pe: 28.6, hi: 19556.12, lo: 15405.21, mc: '68233.05L Cr' },
  { sym: 'HDIL98', name: 'HDIL Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 3725.68, chg: 5.2, pe: 78.6, hi: 4876.53, lo: 2620.81, mc: '64757.35L Cr' },
  { sym: 'NHPC99', name: 'NHPC Systems Ltd', exc: 'NSE', sec: 'Defence', price: 3398.73, chg: -1.11, pe: 74.5, hi: 3623.16, lo: 2845.77, mc: '275.50L Cr' },
  { sym: 'TORREN1', name: 'Torrent Properties Ltd', exc: 'NSE', sec: 'Realty', price: 473.67, chg: -3.95, pe: 89.6, hi: 539.44, lo: 439.32, mc: '85.21L Cr' },
  { sym: 'STK0595', name: 'Torrent Auto Ltd', exc: 'BSE', sec: 'Auto', price: 8253.94, chg: -2.56, pe: 92.7, hi: 11781.35, lo: 7576.76, mc: '9334.30L Cr' },
  { sym: 'ACC3', name: 'ACC Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1018.63, chg: -1.65, pe: 146.7, hi: 1425.8, lo: 642.41, mc: '6670.68L Cr' },
  { sym: 'DECCAN4', name: 'Deccan Cement Projects Ltd', exc: 'BSE', sec: 'Infra', price: 1549.87, chg: 2.79, pe: 126.1, hi: 1998.05, lo: 1007.84, mc: '9301.95L Cr' },
  { sym: 'MEDANTA', name: 'Medanta Auto Ltd', exc: 'BSE', sec: 'Auto', price: 1166.94, chg: -3.62, pe: 137.6, hi: 1418.77, lo: 927.17, mc: '12562.29L Cr' },
  { sym: 'AMBUJA6', name: 'Ambuja Medical Ltd', exc: 'NSE', sec: 'Healthcare', price: 1627.64, chg: 1.04, pe: -1, hi: 2246.96, lo: 1452.03, mc: '5583.10L Cr' },
  { sym: 'ADITYA7', name: 'Aditya Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 345.63, chg: -1.87, pe: 126.0, hi: 428.24, lo: 286.47, mc: '2610.31L Cr' },
  { sym: 'ADANIG8', name: 'Adani Green Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 348.35, chg: 0.43, pe: 91.8, hi: 416.18, lo: 267.59, mc: '806.62L Cr' },
  { sym: 'HEIDEL9', name: 'HeidelbergCement Pharma Ltd', exc: 'BSE', sec: 'Pharma', price: 4877.73, chg: -0.77, pe: 7.5, hi: 5628.0, lo: 3919.64, mc: '6669.07L Cr' },
  { sym: 'HERO10', name: 'Hero Consumer Goods Ltd', exc: 'NSE', sec: 'FMCG', price: 9063.16, chg: -0.89, pe: 143.5, hi: 9692.92, lo: 6363.09, mc: '9969.89L Cr' },
  { sym: 'HAL11', name: 'HAL Energy Ltd', exc: 'NSE', sec: 'Energy', price: 1170.57, chg: 0.94, pe: 124.9, hi: 1549.82, lo: 825.69, mc: '11098.59L Cr' },
  { sym: 'BIRLA12', name: 'Birla Finance Ltd', exc: 'BSE', sec: 'Finance', price: 1664.3, chg: 0.68, pe: 75.3, hi: 1974.07, lo: 1529.12, mc: '558.15L Cr' },
  { sym: 'STK0606', name: 'Rainbow Children Petroleum Ltd', exc: 'NSE', sec: 'Energy', price: 1213.15, chg: 2.4, pe: 127.7, hi: 1619.58, lo: 1026.07, mc: '8241.46L Cr' },
  { sym: 'LAL14', name: 'Lal Textiles Ltd', exc: 'NSE', sec: 'Textiles', price: 181.6, chg: 0.3, pe: 57.6, hi: 250.03, lo: 165.51, mc: '1663.18L Cr' },
  { sym: 'MAHIND15', name: 'Mahindra Steel Ltd', exc: 'NSE', sec: 'Metals', price: 875.08, chg: -2.28, pe: 25.6, hi: 998.14, lo: 563.44, mc: '200.81L Cr' },
  { sym: 'ADANIW16', name: 'Adani Wilmar Beverages Ltd', exc: 'NSE', sec: 'FMCG', price: 2127.84, chg: 3.07, pe: -1, hi: 2326.0, lo: 1867.33, mc: '1501.35L Cr' },
  { sym: 'ENDURA17', name: 'Endurance Securities Ltd', exc: 'BSE', sec: 'Finance', price: 182.23, chg: -4.4, pe: -1, hi: 200.37, lo: 147.72, mc: '445.66L Cr' },
  { sym: 'MUTHOO18', name: 'Muthoot Drugs Ltd', exc: 'BSE', sec: 'Pharma', price: 388.98, chg: 4.99, pe: 28.3, hi: 486.32, lo: 332.58, mc: '1082.55L Cr' },
  { sym: 'NBCC19', name: 'NBCC Finance Ltd', exc: 'NSE', sec: 'Finance', price: 1657.19, chg: 5.14, pe: 114.3, hi: 1742.92, lo: 1415.03, mc: '28222.09L Cr' },
  { sym: 'MEDANT20', name: 'Medanta Petrochemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1011.19, chg: -0.1, pe: 31.2, hi: 1205.27, lo: 741.07, mc: '1021.43L Cr' },
  { sym: 'BERGER21', name: 'Berger Investments Ltd', exc: 'BSE', sec: 'Finance', price: 334.87, chg: -3.14, pe: 107.2, hi: 426.24, lo: 205.68, mc: '274.02L Cr' },
  { sym: 'SUPRAJ22', name: 'Suprajit Lifestyle Ltd', exc: 'BSE', sec: 'Consumer', price: 1861.11, chg: -2.24, pe: 147.8, hi: 2272.76, lo: 1674.76, mc: '26792.31L Cr' },
  { sym: 'MISHRA23', name: 'Mishra Dhatu Labs Ltd', exc: 'BSE', sec: 'Pharma', price: 1101.66, chg: 2.22, pe: 80.8, hi: 1454.86, lo: 706.96, mc: '6077.28L Cr' },
  { sym: 'HAVELL24', name: 'Havells Financial Ltd', exc: 'NSE', sec: 'Finance', price: 334.42, chg: -2.5, pe: 63.6, hi: 382.29, lo: 250.36, mc: '2562.28L Cr' },
  { sym: 'ORIENT25', name: 'Orient Cement Systems Ltd', exc: 'NSE', sec: 'Defence', price: 3268.91, chg: -0.94, pe: 142.8, hi: 4723.61, lo: 2546.46, mc: '4445.80L Cr' },
  { sym: 'VOLTAS26', name: 'Voltas Securities Ltd', exc: 'BSE', sec: 'Finance', price: 1029.75, chg: 4.92, pe: -1, hi: 1385.14, lo: 917.1, mc: '374.45L Cr' },
  { sym: 'APOLLO27', name: 'Apollo Tyres Healthcare Ltd', exc: 'BSE', sec: 'Healthcare', price: 2497.42, chg: -1.47, pe: 115.2, hi: 3282.69, lo: 1952.94, mc: '11593.92L Cr' },
  { sym: 'AMARA28', name: 'Amara Products Ltd', exc: 'BSE', sec: 'Consumer', price: 1547.21, chg: -1.06, pe: 84.3, hi: 2214.11, lo: 945.44, mc: '12205.09L Cr' },
  { sym: 'AMBUJA29', name: 'Ambuja Projects Ltd', exc: 'BSE', sec: 'Infra', price: 1675.61, chg: 0.1, pe: -1, hi: 2132.49, lo: 1509.94, mc: '7208.65L Cr' },
  { sym: 'NBCC30', name: 'NBCC Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 528.63, chg: 0.37, pe: 102.9, hi: 694.64, lo: 443.99, mc: '2911.94L Cr' },
  { sym: 'STK0624', name: 'Ramco Paints Ltd', exc: 'NSE', sec: 'Chemicals', price: 1872.06, chg: 0.45, pe: 94.5, hi: 2229.82, lo: 1763.9, mc: '454.84L Cr' },
  { sym: 'JKTYRE32', name: 'JK Tyre Innovations Ltd', exc: 'NSE', sec: 'Technology', price: 6777.01, chg: 2.92, pe: -1, hi: 9532.12, lo: 4875.65, mc: '4662.03L Cr' },
  { sym: 'MAZAGO33', name: 'Mazagon Dock Metals Ltd', exc: 'BSE', sec: 'Metals', price: 355.07, chg: -2.02, pe: 90.9, hi: 502.12, lo: 221.18, mc: '746.19L Cr' },
  { sym: 'MAZAGO34', name: 'Mazagon Dock Innovations Ltd', exc: 'BSE', sec: 'Technology', price: 475.67, chg: -0.28, pe: 66.1, hi: 503.34, lo: 363.6, mc: '69.91L Cr' },
  { sym: 'EMAMI35', name: 'Emami Developers Ltd', exc: 'BSE', sec: 'Realty', price: 285.04, chg: -3.5, pe: 53.7, hi: 356.62, lo: 247.33, mc: '1198.71L Cr' },
  { sym: 'PARAS36', name: 'Paras Steel Ltd', exc: 'BSE', sec: 'Metals', price: 229.48, chg: 3.9, pe: 46.7, hi: 245.32, lo: 217.7, mc: '431.40L Cr' },
  { sym: 'GLOBAL37', name: 'Global Health Foods Ltd', exc: 'NSE', sec: 'FMCG', price: 17999.13, chg: 1.42, pe: 87.1, hi: 22722.56, lo: 13490.12, mc: '10749.36L Cr' },
  { sym: 'ENDURA38', name: 'Endurance Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 1335.9, chg: 2.13, pe: 65.1, hi: 1536.96, lo: 1042.51, mc: '9908.38L Cr' },
  { sym: 'STK0632', name: 'Granules Fabrics Ltd', exc: 'NSE', sec: 'Textiles', price: 539.49, chg: 1.27, pe: 144.5, hi: 726.63, lo: 411.93, mc: '5434.18L Cr' },
  { sym: 'NHPC40', name: 'NHPC Realty Ltd', exc: 'BSE', sec: 'Realty', price: 750.32, chg: 0.72, pe: 26.4, hi: 833.0, lo: 630.16, mc: '1989.64L Cr' },
  { sym: 'HINDAL41', name: 'Hindalco Alloys Ltd', exc: 'NSE', sec: 'Metals', price: 790.0, chg: 3.74, pe: 42.2, hi: 1019.49, lo: 586.22, mc: '360.24L Cr' },
  { sym: 'RAINBO42', name: 'Rainbow Children Electric Ltd', exc: 'BSE', sec: 'Energy', price: 599.86, chg: -0.28, pe: 34.3, hi: 695.29, lo: 366.03, mc: '2700.35L Cr' },
  { sym: 'BAJAJ43', name: 'Bajaj Auto Ltd', exc: 'NSE', sec: 'Auto', price: 9842.26, chg: 3.32, pe: -1, hi: 13863.83, lo: 6986.69, mc: '4283.74L Cr' },
  { sym: 'TORREN44', name: 'Torrent Projects Ltd', exc: 'BSE', sec: 'Infra', price: 3407.61, chg: 4.93, pe: 25.4, hi: 3730.56, lo: 2920.55, mc: '33492.05L Cr' },
  { sym: 'TORREN45', name: 'Torrent Petrochemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1316.66, chg: 1.5, pe: 50.4, hi: 1820.85, lo: 1129.74, mc: '15843.34L Cr' },
  { sym: 'MARICO46', name: 'Marico Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 193.36, chg: -2.36, pe: 64.2, hi: 269.77, lo: 119.8, mc: '1450.17L Cr' },
  { sym: 'ALKYL47', name: 'Alkyl Securities Ltd', exc: 'BSE', sec: 'Finance', price: 1136.92, chg: -2.04, pe: 118.7, hi: 1259.67, lo: 871.25, mc: '2636.98L Cr' },
  { sym: 'MAZAGO48', name: 'Mazagon Dock Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 5937.87, chg: 2.41, pe: 39.8, hi: 7547.57, lo: 4205.46, mc: '42028.87L Cr' },
  { sym: 'BLUEST49', name: 'Blue Star Systems Ltd', exc: 'NSE', sec: 'Defence', price: 2604.73, chg: -0.62, pe: 62.0, hi: 3753.93, lo: 1795.8, mc: '3895.88L Cr' },
  { sym: 'INDIAB50', name: 'Indiabulls Electric Ltd', exc: 'BSE', sec: 'Energy', price: 315.63, chg: 1.81, pe: 116.2, hi: 382.71, lo: 193.12, mc: '4512.51L Cr' },
  { sym: 'MRF51', name: 'MRF Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1552.8, chg: 4.27, pe: 124.5, hi: 2064.28, lo: 1206.86, mc: '6629.05L Cr' },
  { sym: 'MAHIND52', name: 'Mahindra Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1215.17, chg: 1.91, pe: 69.3, hi: 1587.55, lo: 730.41, mc: '1522.53L Cr' },
  { sym: 'SYMPHO53', name: 'Symphony Housing Ltd', exc: 'NSE', sec: 'Realty', price: 155.29, chg: 2.64, pe: 99.1, hi: 171.14, lo: 125.46, mc: '1198.79L Cr' },
  { sym: 'MANAPP54', name: 'Manappuram Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 1784.96, chg: -2.77, pe: 52.5, hi: 2075.41, lo: 1123.7, mc: '5247.93L Cr' },
  { sym: 'TATA55', name: 'Tata Builders Ltd', exc: 'NSE', sec: 'Infra', price: 361.73, chg: 1.97, pe: 136.5, hi: 520.76, lo: 242.14, mc: '898.52L Cr' },
  { sym: 'HDIL56', name: 'HDIL Infrastructure Ltd', exc: 'BSE', sec: 'Infra', price: 3061.9, chg: 5.08, pe: 87.3, hi: 3232.28, lo: 2400.66, mc: '44003.03L Cr' },
  { sym: 'NBCC57', name: 'NBCC Petrochemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 428.5, chg: -2.59, pe: 118.4, hi: 499.28, lo: 331.21, mc: '960.31L Cr' },
  { sym: 'BOSCH58', name: 'Bosch Real Estate Ltd', exc: 'NSE', sec: 'Realty', price: 995.45, chg: -0.32, pe: 26.2, hi: 1160.77, lo: 688.48, mc: '11172.63L Cr' },
  { sym: 'ALKYL59', name: 'Alkyl Metals Ltd', exc: 'BSE', sec: 'Metals', price: 132.02, chg: 4.21, pe: 62.6, hi: 149.83, lo: 96.93, mc: '672.42L Cr' },
  { sym: 'HERO60', name: 'Hero Financial Ltd', exc: 'NSE', sec: 'Finance', price: 1737.45, chg: 4.81, pe: 56.4, hi: 2245.74, lo: 1450.38, mc: '19864.22L Cr' },
  { sym: 'DIVI61', name: 'Divi Systems Ltd', exc: 'NSE', sec: 'Defence', price: 1016.08, chg: -1.47, pe: 58.8, hi: 1460.33, lo: 808.64, mc: '3158.91L Cr' },
  { sym: 'AARTI62', name: 'Aarti Automobiles Ltd', exc: 'BSE', sec: 'Auto', price: 11191.79, chg: -3.6, pe: 67.8, hi: 12917.14, lo: 7942.19, mc: '110438.70L Cr' },
  { sym: 'TATAST63', name: 'Tata Steel Paints Ltd', exc: 'BSE', sec: 'Chemicals', price: 1907.38, chg: 4.53, pe: 125.3, hi: 2709.79, lo: 1489.55, mc: '2883.33L Cr' },
  { sym: 'HDIL64', name: 'HDIL Products Ltd', exc: 'BSE', sec: 'FMCG', price: 15308.96, chg: 4.03, pe: 120.7, hi: 16400.32, lo: 9981.71, mc: '3207.84L Cr' },
  { sym: 'TATAST65', name: 'Tata Steel Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 3588.62, chg: 5.45, pe: 10.9, hi: 4279.82, lo: 3043.72, mc: '17353.56L Cr' },
  { sym: 'TORREN66', name: 'Torrent Petrochemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 608.06, chg: 4.18, pe: 29.4, hi: 762.2, lo: 422.89, mc: '6390.71L Cr' },
  { sym: 'JUPITE67', name: 'Jupiter Real Estate Ltd', exc: 'NSE', sec: 'Realty', price: 549.71, chg: -0.34, pe: -1, hi: 746.12, lo: 460.06, mc: '348.33L Cr' },
  { sym: 'MEDANT68', name: 'Medanta Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 2940.94, chg: 3.87, pe: 16.8, hi: 4065.2, lo: 2443.45, mc: '25537.88L Cr' },
  { sym: 'BAJAJ69', name: 'Bajaj Housing Ltd', exc: 'NSE', sec: 'Realty', price: 362.96, chg: 5.01, pe: 111.1, hi: 487.72, lo: 339.4, mc: '906.22L Cr' },
  { sym: 'JINDAL70', name: 'Jindal Infotech Ltd', exc: 'BSE', sec: 'Technology', price: 1818.9, chg: -3.79, pe: 60.3, hi: 2200.04, lo: 1204.66, mc: '30433.04L Cr' },
  { sym: 'INDIAB71', name: 'Indiabulls Capital Ltd', exc: 'NSE', sec: 'Finance', price: 2579.19, chg: 3.29, pe: 114.1, hi: 3382.93, lo: 1656.38, mc: '11096.64L Cr' },
  { sym: 'BEL72', name: 'BEL Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 3711.2, chg: -0.91, pe: -1, hi: 4442.24, lo: 2486.34, mc: '13041.64L Cr' },
  { sym: 'STK0666', name: 'SAIL Commerce Ltd', exc: 'BSE', sec: 'Consumer', price: 407.13, chg: 1.64, pe: 66.8, hi: 434.07, lo: 292.98, mc: '876.10L Cr' },
  { sym: 'STRIDE74', name: 'Strides Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 6535.47, chg: -3.66, pe: 16.5, hi: 8957.63, lo: 4608.41, mc: '88438.60L Cr' },
  { sym: 'VARROC75', name: 'Varroc Products Ltd', exc: 'NSE', sec: 'Consumer', price: 2710.84, chg: -4.02, pe: -1, hi: 2895.28, lo: 1728.62, mc: '2386.90L Cr' },
  { sym: 'GLOBAL76', name: 'Global Health Pharma Ltd', exc: 'BSE', sec: 'Pharma', price: 1938.42, chg: 3.19, pe: -1, hi: 2609.51, lo: 1477.09, mc: '25742.28L Cr' },
  { sym: 'HUDCO77', name: 'HUDCO IT Ltd', exc: 'NSE', sec: 'Technology', price: 3621.89, chg: -1.36, pe: 114.8, hi: 4454.85, lo: 3197.19, mc: '22742.96L Cr' },
  { sym: 'WOCKHA78', name: 'Wockhardt Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 1633.21, chg: 4.22, pe: 82.5, hi: 1718.69, lo: 1046.62, mc: '2712.31L Cr' },
  { sym: 'ADANIP79', name: 'Adani Ports Products Ltd', exc: 'BSE', sec: 'FMCG', price: 17395.29, chg: 2.76, pe: 122.9, hi: 22556.44, lo: 14642.17, mc: '227308.02L Cr' },
  { sym: 'MANAPP80', name: 'Manappuram Defence Ltd', exc: 'NSE', sec: 'Defence', price: 1262.91, chg: -2.59, pe: 105.9, hi: 1421.14, lo: 769.6, mc: '1868.83L Cr' },
  { sym: 'SAGARC81', name: 'Sagar Cement Petroleum Ltd', exc: 'BSE', sec: 'Energy', price: 1023.14, chg: -2.59, pe: 72.2, hi: 1268.28, lo: 621.7, mc: '548.26L Cr' },
  { sym: 'ALKYL82', name: 'Alkyl Foods Ltd', exc: 'BSE', sec: 'FMCG', price: 19282.76, chg: 4.1, pe: 34.2, hi: 24638.97, lo: 17197.2, mc: '352.73L Cr' },
  { sym: 'STK0676', name: 'Gujarat Fluorochemicals Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 4902.56, chg: 1.46, pe: 47.2, hi: 6103.68, lo: 3775.63, mc: '35674.93L Cr' },
  { sym: 'JINDAL84', name: 'Jindal Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 1351.55, chg: -4.31, pe: 85.2, hi: 1563.93, lo: 1117.6, mc: '3023.02L Cr' },
  { sym: 'TATAST85', name: 'Tata Steel Realty Ltd', exc: 'BSE', sec: 'Realty', price: 380.73, chg: -2.89, pe: 73.0, hi: 466.49, lo: 296.08, mc: '3080.29L Cr' },
  { sym: 'VARROC86', name: 'Varroc Apparel Ltd', exc: 'BSE', sec: 'Textiles', price: 148.2, chg: 5.1, pe: 102.6, hi: 199.16, lo: 130.21, mc: '2005.88L Cr' },
  { sym: 'ADANIP87', name: 'Adani Ports Realty Ltd', exc: 'NSE', sec: 'Realty', price: 318.33, chg: 2.17, pe: 33.9, hi: 411.38, lo: 202.24, mc: '2633.91L Cr' },
  { sym: 'HERO88', name: 'Hero Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 1205.28, chg: -0.91, pe: 103.2, hi: 1349.78, lo: 1085.73, mc: '9820.33L Cr' },
  { sym: 'VOLTAS89', name: 'Voltas Steel Ltd', exc: 'BSE', sec: 'Metals', price: 155.73, chg: 1.12, pe: 149.1, hi: 212.41, lo: 135.37, mc: '1346.87L Cr' },
  { sym: 'LAURUS90', name: 'Laurus Fashion Ltd', exc: 'NSE', sec: 'Textiles', price: 697.39, chg: 2.19, pe: 139.4, hi: 854.39, lo: 530.01, mc: '1406.65L Cr' },
  { sym: 'BAJAJ91', name: 'Bajaj Investments Ltd', exc: 'NSE', sec: 'Finance', price: 2497.29, chg: -3.45, pe: 131.3, hi: 3532.15, lo: 1635.63, mc: '6531.27L Cr' },
  { sym: 'EMAMI92', name: 'Emami Automobiles Ltd', exc: 'BSE', sec: 'Auto', price: 8897.6, chg: 1.97, pe: 25.0, hi: 12362.66, lo: 6706.01, mc: '57106.75L Cr' },
  { sym: 'DIVI93', name: 'Divi Energy Ltd', exc: 'BSE', sec: 'Energy', price: 462.28, chg: -3.65, pe: 114.5, hi: 552.08, lo: 384.96, mc: '1062.64L Cr' },
  { sym: 'SAIL94', name: 'SAIL Projects Ltd', exc: 'NSE', sec: 'Infra', price: 1276.36, chg: 4.68, pe: 143.0, hi: 1603.7, lo: 1070.57, mc: '10796.79L Cr' },
  { sym: 'GRANUL95', name: 'Granules Defence Ltd', exc: 'NSE', sec: 'Defence', price: 3152.88, chg: -3.65, pe: 147.4, hi: 3517.76, lo: 1959.56, mc: '31772.24L Cr' },
  { sym: 'JINDAL96', name: 'Jindal Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 6346.82, chg: 5.23, pe: 133.4, hi: 8443.28, lo: 5748.58, mc: '29365.95L Cr' },
  { sym: 'STRIDE97', name: 'Strides Minerals Ltd', exc: 'NSE', sec: 'Metals', price: 1006.24, chg: 4.7, pe: 69.7, hi: 1139.12, lo: 795.48, mc: '10401.31L Cr' },
  { sym: 'NUVOCO98', name: 'Nuvoco Beverages Ltd', exc: 'BSE', sec: 'FMCG', price: 17770.35, chg: 3.25, pe: 17.2, hi: 22479.02, lo: 13087.82, mc: '225154.90L Cr' },
  { sym: 'LAURUS99', name: 'Laurus Vehicles Ltd', exc: 'BSE', sec: 'Auto', price: 2879.32, chg: 0.71, pe: 28.2, hi: 3055.41, lo: 2530.37, mc: '8496.33L Cr' },
  { sym: 'DIVI1', name: 'Divi Defence Ltd', exc: 'NSE', sec: 'Defence', price: 3179.53, chg: 2.82, pe: 42.7, hi: 3983.95, lo: 2045.5, mc: '45323.62L Cr' },
  { sym: 'ADITYA2', name: 'Aditya Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1273.14, chg: -1.11, pe: 113.1, hi: 1632.98, lo: 1082.33, mc: '15967.94L Cr' },
  { sym: 'BOSCH3', name: 'Bosch Materials Ltd', exc: 'NSE', sec: 'Chemicals', price: 1356.11, chg: 2.22, pe: 80.4, hi: 1558.24, lo: 969.27, mc: '13029.56L Cr' },
  { sym: 'NBCC4', name: 'NBCC Mining Ltd', exc: 'BSE', sec: 'Metals', price: 142.31, chg: 3.78, pe: -1, hi: 152.97, lo: 129.64, mc: '612.62L Cr' },
  { sym: 'GRANUL5', name: 'Granules Mining Ltd', exc: 'BSE', sec: 'Metals', price: 554.12, chg: 4.22, pe: 97.3, hi: 802.7, lo: 466.1, mc: '7714.44L Cr' },
  { sym: 'LAL6', name: 'Lal Projects Ltd', exc: 'NSE', sec: 'Infra', price: 1325.9, chg: 2.61, pe: 107.2, hi: 1850.04, lo: 850.33, mc: '2703.88L Cr' },
  { sym: 'ACC7', name: 'ACC Foods Ltd', exc: 'NSE', sec: 'FMCG', price: 23612.93, chg: 1.52, pe: 22.5, hi: 30193.99, lo: 14500.67, mc: '27424.58L Cr' },
  { sym: 'MAHIND8', name: 'Mahindra Metals Ltd', exc: 'BSE', sec: 'Metals', price: 306.94, chg: -3.08, pe: 12.1, hi: 432.08, lo: 279.67, mc: '1088.41L Cr' },
  { sym: 'JKTYRE9', name: 'JK Tyre Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 507.96, chg: 4.2, pe: 88.1, hi: 648.31, lo: 464.83, mc: '3814.49L Cr' },
  { sym: 'STK0702', name: 'Divi Beverages Ltd', exc: 'NSE', sec: 'FMCG', price: 19096.39, chg: 3.12, pe: 26.6, hi: 25611.04, lo: 12054.79, mc: '149742.31L Cr' },
  { sym: 'CEAT11', name: 'CEAT Builders Ltd', exc: 'NSE', sec: 'Infra', price: 7221.91, chg: -4.04, pe: 69.2, hi: 8384.28, lo: 4556.92, mc: '828.70L Cr' },
  { sym: 'KANSAI12', name: 'Kansai Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 2914.96, chg: -3.65, pe: 83.6, hi: 3944.08, lo: 2725.64, mc: '22916.73L Cr' },
  { sym: 'SOLARA13', name: 'Solara Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 2244.11, chg: 5.12, pe: 34.8, hi: 3101.08, lo: 2005.38, mc: '2440.81L Cr' },
  { sym: 'BAJAJ14', name: 'Bajaj Auto Ltd', exc: 'BSE', sec: 'Auto', price: 5060.86, chg: 4.12, pe: -1, hi: 6198.58, lo: 3771.49, mc: '28212.08L Cr' },
  { sym: 'EMAMI15', name: 'Emami Products Ltd', exc: 'NSE', sec: 'Consumer', price: 750.29, chg: -2.82, pe: 42.1, hi: 814.7, lo: 530.74, mc: '1085.58L Cr' },
  { sym: 'NBCC16', name: 'NBCC Realty Ltd', exc: 'BSE', sec: 'Realty', price: 177.91, chg: -1.52, pe: -1, hi: 196.94, lo: 162.35, mc: '865.94L Cr' },
  { sym: 'BLUEST17', name: 'Blue Star Fashion Ltd', exc: 'NSE', sec: 'Textiles', price: 136.31, chg: 1.36, pe: 114.1, hi: 164.12, lo: 87.28, mc: '78.32L Cr' },
  { sym: 'HINDAL18', name: 'Hindalco Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 3976.54, chg: 4.64, pe: -1, hi: 5056.69, lo: 3201.75, mc: '6206.10L Cr' },
  { sym: 'HINDAL19', name: 'Hindalco Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 2340.91, chg: -3.66, pe: 34.5, hi: 3364.27, lo: 1710.4, mc: '36175.87L Cr' },
  { sym: 'RAINBO20', name: 'Rainbow Children Auto Ltd', exc: 'BSE', sec: 'Auto', price: 11551.68, chg: -4.08, pe: 144.4, hi: 14997.45, lo: 9571.38, mc: '2697.15L Cr' },
  { sym: 'EXIDE21', name: 'Exide Apparel Ltd', exc: 'BSE', sec: 'Textiles', price: 222.12, chg: 5.49, pe: 35.8, hi: 307.92, lo: 155.14, mc: '387.33L Cr' },
  { sym: 'PFC22', name: 'PFC Bank Ltd', exc: 'BSE', sec: 'Finance', price: 270.46, chg: 3.8, pe: 149.8, hi: 379.0, lo: 182.24, mc: '2196.64L Cr' },
  { sym: 'GUJARA23', name: 'Gujarat Adani Apparel Ltd', exc: 'BSE', sec: 'Textiles', price: 410.29, chg: -1.77, pe: 51.6, hi: 465.37, lo: 383.89, mc: '2468.35L Cr' },
  { sym: 'ADITYA24', name: 'Aditya Hospitals Ltd', exc: 'NSE', sec: 'Healthcare', price: 4417.99, chg: 2.23, pe: 134.8, hi: 5881.76, lo: 3829.79, mc: '37552.97L Cr' },
  { sym: 'HEIDEL25', name: 'HeidelbergCement Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 3908.95, chg: 2.22, pe: 122.9, hi: 5398.21, lo: 2835.11, mc: '10694.99L Cr' },
  { sym: 'STK0718', name: 'ACC FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 3294.14, chg: -0.05, pe: 7.9, hi: 3829.29, lo: 3038.81, mc: '2337.52L Cr' },
  { sym: 'WHIRLP27', name: 'Whirlpool Real Estate Ltd', exc: 'BSE', sec: 'Realty', price: 654.4, chg: 5.3, pe: 10.3, hi: 816.13, lo: 553.9, mc: '135.39L Cr' },
  { sym: 'MINDA28', name: 'Minda Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 410.72, chg: 0.5, pe: 33.1, hi: 552.63, lo: 343.06, mc: '910.54L Cr' },
  { sym: 'STK0721', name: 'Lal Properties Ltd', exc: 'NSE', sec: 'Realty', price: 758.67, chg: 4.84, pe: 132.7, hi: 1017.8, lo: 528.05, mc: '423.02L Cr' },
  { sym: 'RATNAM30', name: 'Ratnamani Foods Ltd', exc: 'BSE', sec: 'FMCG', price: 13661.51, chg: 4.88, pe: 141.7, hi: 14628.0, lo: 12685.61, mc: '117689.81L Cr' },
  { sym: 'AARTI31', name: 'Aarti Lifestyle Ltd', exc: 'NSE', sec: 'Consumer', price: 3464.83, chg: -0.89, pe: 133.2, hi: 3949.28, lo: 2415.94, mc: '13235.41L Cr' },
  { sym: 'WOCKHA32', name: 'Wockhardt Software Ltd', exc: 'BSE', sec: 'Technology', price: 1214.66, chg: 3.58, pe: 37.7, hi: 1610.42, lo: 1135.98, mc: '4564.89L Cr' },
  { sym: 'DATAPA33', name: 'Data Patterns Steel Ltd', exc: 'BSE', sec: 'Metals', price: 112.79, chg: -4.22, pe: 8.5, hi: 154.4, lo: 104.59, mc: '482.93L Cr' },
  { sym: 'HERO34', name: 'Hero Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 1929.96, chg: 0.7, pe: 15.6, hi: 2489.62, lo: 1454.2, mc: '1677.01L Cr' },
  { sym: 'GODREJ35', name: 'Godrej Capital Ltd', exc: 'NSE', sec: 'Finance', price: 2927.4, chg: -1.37, pe: 14.4, hi: 3223.11, lo: 2698.16, mc: '7985.87L Cr' },
  { sym: 'MISHRA36', name: 'Mishra Dhatu Pharma Ltd', exc: 'BSE', sec: 'Pharma', price: 562.5, chg: 1.09, pe: 60.3, hi: 612.19, lo: 485.54, mc: '1585.50L Cr' },
  { sym: 'AARTI37', name: 'Aarti Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 3337.86, chg: 4.3, pe: 54.2, hi: 4756.56, lo: 2917.37, mc: '10158.25L Cr' },
  { sym: 'HAL38', name: 'HAL Power Ltd', exc: 'NSE', sec: 'Energy', price: 243.77, chg: 1.43, pe: 136.1, hi: 268.24, lo: 189.68, mc: '843.86L Cr' },
  { sym: 'MANAPP39', name: 'Manappuram Realty Ltd', exc: 'BSE', sec: 'Realty', price: 181.3, chg: -3.9, pe: 68.2, hi: 259.97, lo: 156.65, mc: '1001.26L Cr' },
  { sym: 'SUPRAJ40', name: 'Suprajit Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 1442.23, chg: -1.59, pe: 80.1, hi: 1893.75, lo: 938.33, mc: '5630.64L Cr' },
  { sym: 'HAVELL41', name: 'Havells Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 6619.89, chg: 1.91, pe: 14.9, hi: 7452.29, lo: 5074.17, mc: '43310.72L Cr' },
  { sym: 'YATHAR42', name: 'Yatharth Consumer Goods Ltd', exc: 'BSE', sec: 'FMCG', price: 17062.37, chg: 1.66, pe: 28.5, hi: 21016.08, lo: 14950.34, mc: '3308.52L Cr' },
  { sym: 'AARTI43', name: 'Aarti Software Ltd', exc: 'NSE', sec: 'Technology', price: 5699.15, chg: -2.37, pe: 116.4, hi: 7841.24, lo: 5029.76, mc: '17423.82L Cr' },
  { sym: 'OBEROI44', name: 'Oberoi Paints Ltd', exc: 'NSE', sec: 'Chemicals', price: 1397.3, chg: -4.2, pe: 47.1, hi: 1575.82, lo: 1124.81, mc: '1144.00L Cr' },
  { sym: 'DLF45', name: 'DLF Systems Ltd', exc: 'NSE', sec: 'Technology', price: 1983.69, chg: 4.35, pe: 54.3, hi: 2522.86, lo: 1314.17, mc: '736.43L Cr' },
  { sym: 'MISHRA46', name: 'Mishra Dhatu Fabrics Ltd', exc: 'NSE', sec: 'Textiles', price: 114.7, chg: -0.71, pe: 21.1, hi: 163.38, lo: 81.07, mc: '447.71L Cr' },
  { sym: 'ORIENT47', name: 'Orient Cement Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 6605.78, chg: 4.32, pe: 14.5, hi: 7317.7, lo: 6100.14, mc: '20981.66L Cr' },
  { sym: 'SAIL48', name: 'SAIL Constructions Ltd', exc: 'BSE', sec: 'Infra', price: 1692.07, chg: 4.71, pe: 90.2, hi: 2354.98, lo: 1189.46, mc: '1284.23L Cr' },
  { sym: 'LAURUS49', name: 'Laurus Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 4396.04, chg: 4.36, pe: 16.8, hi: 5443.47, lo: 3658.5, mc: '2950.11L Cr' },
  { sym: 'AARTI50', name: 'Aarti Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 2495.76, chg: -1.28, pe: 105.7, hi: 3334.98, lo: 1929.66, mc: '5457.95L Cr' },
  { sym: 'HAVELL51', name: 'Havells Apparel Ltd', exc: 'NSE', sec: 'Textiles', price: 245.04, chg: 4.13, pe: 49.4, hi: 344.4, lo: 196.03, mc: '1743.92L Cr' },
  { sym: 'WOCKHA52', name: 'Wockhardt Vehicles Ltd', exc: 'NSE', sec: 'Auto', price: 2447.79, chg: -0.05, pe: 89.7, hi: 3025.72, lo: 2000.81, mc: '9870.91L Cr' },
  { sym: 'BALKRI53', name: 'Balkrishna Cement Ltd', exc: 'BSE', sec: 'Infra', price: 4051.85, chg: -0.68, pe: 38.9, hi: 5300.39, lo: 2940.36, mc: '5669.60L Cr' },
  { sym: 'VOLTAS54', name: 'Voltas Motors Ltd', exc: 'NSE', sec: 'Auto', price: 11895.16, chg: -3.31, pe: 84.2, hi: 14077.96, lo: 9947.77, mc: '44544.49L Cr' },
  { sym: 'BEL55', name: 'BEL Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1571.93, chg: 5.48, pe: 112.3, hi: 2224.21, lo: 947.85, mc: '7767.88L Cr' },
  { sym: 'GLOBAL56', name: 'Global Health Defence Ltd', exc: 'NSE', sec: 'Defence', price: 3837.45, chg: 0.22, pe: 115.4, hi: 4258.47, lo: 2836.36, mc: '13113.24L Cr' },
  { sym: 'NUVOCO57', name: 'Nuvoco Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1176.9, chg: 2.73, pe: 119.8, hi: 1383.13, lo: 783.52, mc: '12708.47L Cr' },
  { sym: 'RAINBO58', name: 'Rainbow Children Power Ltd', exc: 'BSE', sec: 'Energy', price: 583.97, chg: -0.75, pe: 23.6, hi: 833.52, lo: 352.36, mc: '7913.25L Cr' },
  { sym: 'IRFC59', name: 'IRFC Mining Ltd', exc: 'NSE', sec: 'Metals', price: 549.44, chg: 3.13, pe: 48.4, hi: 705.91, lo: 438.81, mc: '53.08L Cr' },
  { sym: 'CROMPT60', name: 'Crompton Mining Ltd', exc: 'BSE', sec: 'Metals', price: 883.34, chg: -3.86, pe: 73.8, hi: 1043.7, lo: 827.41, mc: '3518.68L Cr' },
  { sym: 'DLF61', name: 'DLF Hospitals Ltd', exc: 'NSE', sec: 'Healthcare', price: 4854.24, chg: 3.76, pe: 8.9, hi: 5483.35, lo: 4460.91, mc: '8017.52L Cr' },
  { sym: 'ACC62', name: 'ACC Products Ltd', exc: 'NSE', sec: 'Consumer', price: 2382.39, chg: -4.39, pe: 136.9, hi: 2874.22, lo: 2254.59, mc: '2619.14L Cr' },
  { sym: 'CROMPT63', name: 'Crompton FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 9847.02, chg: 4.2, pe: 123.6, hi: 12957.86, lo: 6455.44, mc: '35940.14L Cr' },
  { sym: 'ADITYA64', name: 'Aditya Energy Ltd', exc: 'BSE', sec: 'Energy', price: 388.49, chg: -0.04, pe: 92.7, hi: 446.27, lo: 277.81, mc: '2194.75L Cr' },
  { sym: 'BOSCH65', name: 'Bosch Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1553.39, chg: -1.03, pe: 119.9, hi: 1874.07, lo: 1379.72, mc: '11113.97L Cr' },
  { sym: 'MAZAGO66', name: 'Mazagon Dock Healthcare Ltd', exc: 'BSE', sec: 'Healthcare', price: 1939.75, chg: 2.49, pe: -1, hi: 2578.82, lo: 1193.49, mc: '5715.36L Cr' },
  { sym: 'ESSAR67', name: 'Essar Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 426.66, chg: 4.59, pe: 115.5, hi: 468.68, lo: 311.06, mc: '3283.78L Cr' },
  { sym: 'PRESTI68', name: 'Prestige Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 2230.29, chg: -2.43, pe: -1, hi: 2365.64, lo: 1836.87, mc: '14085.79L Cr' },
  { sym: 'RAMCO69', name: 'Ramco Steel Ltd', exc: 'BSE', sec: 'Metals', price: 778.85, chg: -4.39, pe: 138.0, hi: 919.7, lo: 671.4, mc: '585.93L Cr' },
  { sym: 'JSW70', name: 'JSW Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 10846.93, chg: 0.21, pe: 28.4, hi: 15027.32, lo: 8812.54, mc: '5122.17L Cr' },
  { sym: 'GARDEN71', name: 'Garden Reach Foods Ltd', exc: 'BSE', sec: 'FMCG', price: 3493.8, chg: 2.27, pe: 56.9, hi: 3971.29, lo: 2138.4, mc: '10568.71L Cr' },
  { sym: 'DECCAN72', name: 'Deccan Cement Products Ltd', exc: 'NSE', sec: 'FMCG', price: 20945.23, chg: 1.91, pe: 135.1, hi: 25265.13, lo: 14827.41, mc: '323.89L Cr' },
  { sym: 'SYMPHO73', name: 'Symphony Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3301.34, chg: 4.59, pe: 7.3, hi: 3503.31, lo: 1997.63, mc: '37015.43L Cr' },
  { sym: 'EMAMI74', name: 'Emami Securities Ltd', exc: 'NSE', sec: 'Finance', price: 2882.42, chg: -2.82, pe: 65.3, hi: 3150.7, lo: 2059.49, mc: '6406.72L Cr' },
  { sym: 'KANSAI75', name: 'Kansai Energy Ltd', exc: 'BSE', sec: 'Energy', price: 1131.59, chg: -2.36, pe: 30.2, hi: 1370.19, lo: 804.2, mc: '4091.78L Cr' },
  { sym: 'ACC76', name: 'ACC Bank Ltd', exc: 'BSE', sec: 'Finance', price: 1334.9, chg: -3.83, pe: 48.7, hi: 1721.42, lo: 1260.26, mc: '1476.55L Cr' },
  { sym: 'EMAMI77', name: 'Emami Fashion Ltd', exc: 'NSE', sec: 'Textiles', price: 276.36, chg: -1.26, pe: 61.3, hi: 392.38, lo: 240.43, mc: '135.32L Cr' },
  { sym: 'GARDEN78', name: 'Garden Reach Systems Ltd', exc: 'NSE', sec: 'Defence', price: 3934.06, chg: -3.82, pe: -1, hi: 5566.07, lo: 2978.55, mc: '29945.10L Cr' },
  { sym: 'BEML79', name: 'BEML Motors Ltd', exc: 'NSE', sec: 'Auto', price: 3872.79, chg: -1.41, pe: 114.8, hi: 5026.52, lo: 2404.9, mc: '8815.91L Cr' },
  { sym: 'GODREJ80', name: 'Godrej Healthcare Ltd', exc: 'BSE', sec: 'Healthcare', price: 976.66, chg: 4.73, pe: 142.2, hi: 1314.29, lo: 698.35, mc: '3520.42L Cr' },
  { sym: 'NALCO', name: 'Nalco Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 2562.62, chg: 3.01, pe: 111.3, hi: 3042.06, lo: 1722.17, mc: '2567.82L Cr' },
  { sym: 'AMBUJA82', name: 'Ambuja Petroleum Ltd', exc: 'NSE', sec: 'Energy', price: 951.29, chg: -1.28, pe: 5.9, hi: 1329.85, lo: 594.08, mc: '2341.22L Cr' },
  { sym: 'DLF83', name: 'DLF Diagnostics Ltd', exc: 'NSE', sec: 'Healthcare', price: 1228.7, chg: 0.99, pe: 34.6, hi: 1539.52, lo: 920.52, mc: '1981.26L Cr' },
  { sym: 'BEL84', name: 'BEL Energy Ltd', exc: 'NSE', sec: 'Energy', price: 693.62, chg: -1.47, pe: 145.3, hi: 784.18, lo: 625.54, mc: '6354.70L Cr' },
  { sym: 'ALKYL85', name: 'Alkyl Mining Ltd', exc: 'BSE', sec: 'Metals', price: 377.28, chg: -0.27, pe: 67.8, hi: 419.67, lo: 352.31, mc: '2781.28L Cr' },
  { sym: 'ENDURA86', name: 'Endurance Builders Ltd', exc: 'NSE', sec: 'Infra', price: 6119.09, chg: 0.87, pe: 30.5, hi: 7356.25, lo: 4326.48, mc: '19661.40L Cr' },
  { sym: 'NBCC87', name: 'NBCC Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 866.5, chg: -2.54, pe: 5.6, hi: 1208.47, lo: 741.4, mc: '2664.75L Cr' },
  { sym: 'ACC88', name: 'ACC Projects Ltd', exc: 'BSE', sec: 'Infra', price: 4856.89, chg: 0.4, pe: 90.3, hi: 5893.91, lo: 2980.14, mc: '35002.80L Cr' },
  { sym: 'TATAST89', name: 'Tata Steel Properties Ltd', exc: 'NSE', sec: 'Realty', price: 234.52, chg: 3.21, pe: 55.5, hi: 312.77, lo: 192.83, mc: '116.02L Cr' },
  { sym: 'SYMPHO90', name: 'Symphony Projects Ltd', exc: 'BSE', sec: 'Infra', price: 3717.97, chg: -4.15, pe: 96.5, hi: 4909.84, lo: 3138.39, mc: '12898.38L Cr' },
  { sym: 'BEL91', name: 'BEL Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 732.29, chg: -4.38, pe: 98.4, hi: 1037.47, lo: 541.3, mc: '7746.09L Cr' },
  { sym: 'PRESTI92', name: 'Prestige Auto Ltd', exc: 'NSE', sec: 'Auto', price: 13202.09, chg: -1.97, pe: 145.3, hi: 17339.55, lo: 9690.02, mc: '33988.37L Cr' },
  { sym: 'JUPITE93', name: 'Jupiter Garments Ltd', exc: 'NSE', sec: 'Textiles', price: 176.49, chg: 3.64, pe: 35.4, hi: 238.14, lo: 149.07, mc: '4.31L Cr' },
  { sym: 'ADANIW94', name: 'Adani Wilmar Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 464.68, chg: 0.75, pe: 111.3, hi: 519.63, lo: 339.74, mc: '1348.43L Cr' },
  { sym: 'HEIDEL95', name: 'HeidelbergCement Healthcare Ltd', exc: 'NSE', sec: 'Healthcare', price: 3374.36, chg: -2.64, pe: -1, hi: 3789.72, lo: 2921.21, mc: '15832.11L Cr' },
  { sym: 'MFAC96', name: 'MFAC Infrastructure Ltd', exc: 'BSE', sec: 'Infra', price: 3190.16, chg: 4.18, pe: 47.5, hi: 3831.67, lo: 2223.12, mc: '12887.72L Cr' },
  { sym: 'EMAMI97', name: 'Emami Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 1443.77, chg: -3.89, pe: 6.0, hi: 1852.33, lo: 1365.33, mc: '1480.86L Cr' },
  { sym: 'ADANIG98', name: 'Adani Green IT Ltd', exc: 'BSE', sec: 'Technology', price: 3134.03, chg: 4.82, pe: 53.9, hi: 3829.1, lo: 2287.14, mc: '55768.07L Cr' },
  { sym: 'GARDEN99', name: 'Garden Reach Coatings Ltd', exc: 'NSE', sec: 'Chemicals', price: 3305.27, chg: -0.72, pe: -1, hi: 3941.24, lo: 2365.22, mc: '3075.56L Cr' },
  { sym: 'MANAPP1', name: 'Manappuram Foods Ltd', exc: 'BSE', sec: 'FMCG', price: 14545.62, chg: 1.52, pe: 45.5, hi: 19341.4, lo: 12876.77, mc: '66741.65L Cr' },
  { sym: 'MAZAGO2', name: 'Mazagon Dock Pharmaceuticals Ltd', exc: 'BSE', sec: 'Pharma', price: 2695.84, chg: -4.47, pe: 141.6, hi: 3178.05, lo: 2215.5, mc: '45678.68L Cr' },
  { sym: 'VOLTAS3', name: 'Voltas Products Ltd', exc: 'BSE', sec: 'FMCG', price: 13606.9, chg: 0.35, pe: 120.1, hi: 16183.14, lo: 12636.45, mc: '123334.14L Cr' },
  { sym: 'VARROC4', name: 'Varroc Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 5219.66, chg: -2.55, pe: 80.4, hi: 6674.68, lo: 4697.07, mc: '7198.80L Cr' },
  { sym: 'MISHRA5', name: 'Mishra Dhatu Systems Ltd', exc: 'NSE', sec: 'Defence', price: 1904.04, chg: -2.82, pe: 21.8, hi: 2503.92, lo: 1302.96, mc: '6102.03L Cr' },
  { sym: 'STK0797', name: 'NBCC Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 1006.65, chg: -2.9, pe: 135.9, hi: 1365.54, lo: 681.63, mc: '2501.26L Cr' },
  { sym: 'SOLARA7', name: 'Solara Apparel Ltd', exc: 'NSE', sec: 'Textiles', price: 565.83, chg: -3.6, pe: 131.4, hi: 805.01, lo: 491.26, mc: '4403.26L Cr' },
  { sym: 'NUVOCO8', name: 'Nuvoco Builders Ltd', exc: 'BSE', sec: 'Infra', price: 3321.51, chg: 5.16, pe: 38.8, hi: 3831.82, lo: 2331.17, mc: '2576.53L Cr' },
  { sym: 'BERGER9', name: 'Berger Housing Ltd', exc: 'NSE', sec: 'Realty', price: 757.39, chg: -0.82, pe: 143.3, hi: 970.04, lo: 454.88, mc: '510.28L Cr' },
  { sym: 'STK0801', name: 'Balkrishna Paints Ltd', exc: 'BSE', sec: 'Chemicals', price: 2452.65, chg: 3.48, pe: 23.3, hi: 3226.45, lo: 1978.73, mc: '100.26L Cr' },
  { sym: 'HEIDEL11', name: 'HeidelbergCement Paints Ltd', exc: 'BSE', sec: 'Chemicals', price: 892.43, chg: 3.87, pe: 71.1, hi: 1151.76, lo: 581.02, mc: '9541.80L Cr' },
  { sym: 'SUPRAJ12', name: 'Suprajit Products Ltd', exc: 'NSE', sec: 'FMCG', price: 15052.23, chg: 5.4, pe: 149.5, hi: 20058.74, lo: 11551.07, mc: '124767.59L Cr' },
  { sym: 'DECCAN13', name: 'Deccan Cement Consumer Goods Ltd', exc: 'BSE', sec: 'FMCG', price: 1317.43, chg: -2.97, pe: 128.0, hi: 1875.72, lo: 894.24, mc: '17913.84L Cr' },
  { sym: 'NHPC14', name: 'NHPC Systems Ltd', exc: 'NSE', sec: 'Defence', price: 3570.34, chg: -1.51, pe: 137.3, hi: 3976.21, lo: 2169.15, mc: '12004.34L Cr' },
  { sym: 'STK0806', name: 'Ramco Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 1588.11, chg: 0.78, pe: 106.0, hi: 1791.45, lo: 1428.8, mc: '1747.23L Cr' },
  { sym: 'HUDCO16', name: 'HUDCO Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3549.43, chg: 0.08, pe: 24.9, hi: 4715.0, lo: 2491.27, mc: '2329.85L Cr' },
  { sym: 'BIRLA17', name: 'Birla Consumer Goods Ltd', exc: 'NSE', sec: 'FMCG', price: 18435.91, chg: 2.76, pe: 103.4, hi: 26647.15, lo: 12013.98, mc: '151683.67L Cr' },
  { sym: 'EMAMI18', name: 'Emami Paints Ltd', exc: 'NSE', sec: 'Chemicals', price: 3255.75, chg: 5.24, pe: 12.6, hi: 4695.15, lo: 2694.24, mc: '37493.57L Cr' },
  { sym: 'KANSAI19', name: 'Kansai Pharmaceuticals Ltd', exc: 'BSE', sec: 'Pharma', price: 1413.75, chg: -0.53, pe: 91.4, hi: 1581.98, lo: 1216.98, mc: '21748.40L Cr' },
  { sym: 'HEIDEL20', name: 'HeidelbergCement Labs Ltd', exc: 'NSE', sec: 'Pharma', price: 5510.8, chg: -1.75, pe: 58.3, hi: 6050.86, lo: 3465.87, mc: '36258.58L Cr' },
  { sym: 'JUPITE21', name: 'Jupiter Auto Ltd', exc: 'NSE', sec: 'Auto', price: 833.89, chg: -1.76, pe: 120.2, hi: 935.99, lo: 641.65, mc: '4724.19L Cr' },
  { sym: 'ESSAR22', name: 'Essar Housing Ltd', exc: 'NSE', sec: 'Realty', price: 144.47, chg: -2.65, pe: 7.9, hi: 183.83, lo: 113.81, mc: '1158.68L Cr' },
  { sym: 'CROMPT23', name: 'Crompton Motors Ltd', exc: 'NSE', sec: 'Auto', price: 11425.87, chg: -2.69, pe: 31.1, hi: 14532.44, lo: 10056.82, mc: '3880.79L Cr' },
  { sym: 'EXIDE24', name: 'Exide Power Ltd', exc: 'NSE', sec: 'Energy', price: 222.95, chg: -3.65, pe: 48.3, hi: 320.27, lo: 147.16, mc: '2882.46L Cr' },
  { sym: 'GRANUL25', name: 'Granules Utilities Ltd', exc: 'BSE', sec: 'Energy', price: 131.71, chg: 2.09, pe: 88.7, hi: 174.92, lo: 103.12, mc: '931.41L Cr' },
  { sym: 'MAZAGO26', name: 'Mazagon Dock Motors Ltd', exc: 'NSE', sec: 'Auto', price: 10474.99, chg: -2.13, pe: 48.5, hi: 14487.45, lo: 9795.14, mc: '28251.54L Cr' },
  { sym: 'MFAC27', name: 'MFAC Mining Ltd', exc: 'BSE', sec: 'Metals', price: 167.93, chg: -3.76, pe: 60.4, hi: 237.03, lo: 124.27, mc: '73.56L Cr' },
  { sym: 'OBEROI28', name: 'Oberoi Cement Ltd', exc: 'NSE', sec: 'Infra', price: 4380.05, chg: 5.45, pe: 32.9, hi: 5251.05, lo: 3635.71, mc: '43770.56L Cr' },
  { sym: 'NUVOCO29', name: 'Nuvoco Projects Ltd', exc: 'NSE', sec: 'Infra', price: 2667.61, chg: -0.71, pe: 40.9, hi: 3089.23, lo: 2096.78, mc: '15064.13L Cr' },
  { sym: 'MRF30', name: 'MRF Alloys Ltd', exc: 'NSE', sec: 'Metals', price: 486.36, chg: -3.04, pe: 44.7, hi: 529.73, lo: 458.55, mc: '2062.05L Cr' },
  { sym: 'NHPC31', name: 'NHPC Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 1527.19, chg: 1.39, pe: 18.9, hi: 1816.68, lo: 1222.14, mc: '2400.49L Cr' },
  { sym: 'STK0823', name: 'Gujarat Adani Capital Ltd', exc: 'NSE', sec: 'Finance', price: 636.63, chg: -2.69, pe: 103.3, hi: 869.32, lo: 504.9, mc: '4589.34L Cr' },
  { sym: 'IRFC33', name: 'IRFC Housing Ltd', exc: 'NSE', sec: 'Realty', price: 296.11, chg: 2.63, pe: 25.7, hi: 378.14, lo: 205.38, mc: '3496.48L Cr' },
  { sym: 'NALCO34', name: 'Nalco Mining Ltd', exc: 'NSE', sec: 'Metals', price: 839.6, chg: -2.67, pe: 120.8, hi: 1050.25, lo: 584.81, mc: '6772.81L Cr' },
  { sym: 'TORREN35', name: 'Torrent Garments Ltd', exc: 'NSE', sec: 'Textiles', price: 313.63, chg: -0.43, pe: 18.1, hi: 339.28, lo: 268.31, mc: '1028.10L Cr' },
  { sym: 'SEQUEN36', name: 'Sequent Digital Ltd', exc: 'NSE', sec: 'Technology', price: 6075.57, chg: 3.58, pe: -1, hi: 8684.17, lo: 5085.02, mc: '16436.69L Cr' },
  { sym: 'BEML37', name: 'BEML Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 989.3, chg: 4.61, pe: 108.6, hi: 1316.79, lo: 853.16, mc: '3589.12L Cr' },
  { sym: 'PRESTI38', name: 'Prestige Fashion Ltd', exc: 'NSE', sec: 'Textiles', price: 525.16, chg: 4.54, pe: 58.2, hi: 579.42, lo: 380.03, mc: '270.13L Cr' },
  { sym: 'CEAT39', name: 'CEAT Healthcare Ltd', exc: 'BSE', sec: 'Healthcare', price: 3884.97, chg: 3.82, pe: 129.4, hi: 4529.98, lo: 2987.91, mc: '251.56L Cr' },
  { sym: 'STK0831', name: 'Suprajit Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 1282.95, chg: 3.76, pe: -1, hi: 1584.73, lo: 1047.16, mc: '4540.01L Cr' },
  { sym: 'GOODYE41', name: 'Goodyear Realty Ltd', exc: 'BSE', sec: 'Realty', price: 289.7, chg: -4.45, pe: 32.0, hi: 345.27, lo: 184.1, mc: '267.83L Cr' },
  { sym: 'DEEPAK42', name: 'Deepak Nitrite Motors Ltd', exc: 'NSE', sec: 'Auto', price: 6455.43, chg: -2.94, pe: 37.8, hi: 7799.09, lo: 4549.46, mc: '10534.43L Cr' },
  { sym: 'JSW43', name: 'JSW Systems Ltd', exc: 'NSE', sec: 'Defence', price: 1326.08, chg: -2.88, pe: 67.9, hi: 1582.93, lo: 1199.68, mc: '1042.56L Cr' },
  { sym: 'ADANIP44', name: 'Adani Ports IT Ltd', exc: 'NSE', sec: 'Technology', price: 3459.1, chg: 4.51, pe: 33.9, hi: 4295.23, lo: 2880.86, mc: '7860.63L Cr' },
  { sym: 'NBCC45', name: 'NBCC Automobiles Ltd', exc: 'BSE', sec: 'Auto', price: 9677.91, chg: -1.25, pe: 132.9, hi: 12104.58, lo: 8935.1, mc: '64456.26L Cr' },
  { sym: 'LAL46', name: 'Lal Finance Ltd', exc: 'NSE', sec: 'Finance', price: 2409.23, chg: -1.06, pe: -1, hi: 3189.28, lo: 1489.42, mc: '17410.12L Cr' },
  { sym: 'VARROC47', name: 'Varroc Properties Ltd', exc: 'NSE', sec: 'Realty', price: 462.61, chg: 0.36, pe: 40.9, hi: 513.96, lo: 360.34, mc: '1777.75L Cr' },
  { sym: 'SYMPHO48', name: 'Symphony Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 2486.5, chg: -2.52, pe: 122.4, hi: 3308.18, lo: 1929.07, mc: '8964.26L Cr' },
  { sym: 'LAL49', name: 'Lal Developers Ltd', exc: 'NSE', sec: 'Realty', price: 267.91, chg: -4.12, pe: 139.7, hi: 326.99, lo: 218.55, mc: '29.60L Cr' },
  { sym: 'VOLTAS50', name: 'Voltas Constructions Ltd', exc: 'BSE', sec: 'Infra', price: 3545.77, chg: -1.14, pe: 78.9, hi: 4636.27, lo: 2505.09, mc: '5501.67L Cr' },
  { sym: 'HERO51', name: 'Hero Metals Ltd', exc: 'BSE', sec: 'Metals', price: 267.45, chg: -4.09, pe: -1, hi: 360.5, lo: 180.31, mc: '2297.55L Cr' },
  { sym: 'DEEPAK52', name: 'Deepak Nitrite Financial Ltd', exc: 'BSE', sec: 'Finance', price: 451.2, chg: -1.16, pe: 102.0, hi: 597.02, lo: 392.39, mc: '432.95L Cr' },
  { sym: 'MEDANT53', name: 'Medanta Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3228.8, chg: -2.12, pe: 89.7, hi: 3502.9, lo: 2057.48, mc: '24636.35L Cr' },
  { sym: 'WELSPU54', name: 'Welspun Tech Ltd', exc: 'NSE', sec: 'Technology', price: 1946.96, chg: -3.75, pe: 54.7, hi: 2609.2, lo: 1842.56, mc: '5702.55L Cr' },
  { sym: 'SEQUEN55', name: 'Sequent Infotech Ltd', exc: 'NSE', sec: 'Technology', price: 1937.8, chg: -1.97, pe: 128.7, hi: 2737.58, lo: 1824.04, mc: '15747.03L Cr' },
  { sym: 'ESSAR56', name: 'Essar Beverages Ltd', exc: 'NSE', sec: 'FMCG', price: 22789.06, chg: -0.31, pe: 78.1, hi: 24127.92, lo: 18452.39, mc: '43718.04L Cr' },
  { sym: 'REC57', name: 'REC Systems Ltd', exc: 'NSE', sec: 'Technology', price: 6457.93, chg: 2.91, pe: 104.3, hi: 9028.85, lo: 6070.7, mc: '16143.02L Cr' },
  { sym: 'MOTHER58', name: 'Motherson Constructions Ltd', exc: 'BSE', sec: 'Infra', price: 2094.12, chg: -2.66, pe: 36.6, hi: 2782.43, lo: 1900.84, mc: '15263.91L Cr' },
  { sym: 'WHIRLP59', name: 'Whirlpool Consumer Goods Ltd', exc: 'BSE', sec: 'FMCG', price: 6172.69, chg: 2.58, pe: 29.8, hi: 6593.95, lo: 4218.27, mc: '765.31L Cr' },
  { sym: 'MOTHER60', name: 'Motherson Textiles Ltd', exc: 'BSE', sec: 'Textiles', price: 562.17, chg: 1.92, pe: 124.4, hi: 710.49, lo: 337.58, mc: '2381.81L Cr' },
  { sym: 'HUDCO61', name: 'HUDCO Minerals Ltd', exc: 'BSE', sec: 'Metals', price: 129.93, chg: -1.86, pe: 135.3, hi: 151.75, lo: 122.76, mc: '33.04L Cr' },
  { sym: 'MINDA62', name: 'Minda Metals Ltd', exc: 'NSE', sec: 'Metals', price: 898.13, chg: -1.94, pe: -1, hi: 1179.18, lo: 811.72, mc: '9908.59L Cr' },
  { sym: 'EXIDE63', name: 'Exide Products Ltd', exc: 'BSE', sec: 'FMCG', price: 18921.28, chg: 1.01, pe: 37.0, hi: 21901.71, lo: 15204.81, mc: '230918.64L Cr' },
  { sym: 'NLC64', name: 'NLC Health Ltd', exc: 'BSE', sec: 'Healthcare', price: 1080.55, chg: -0.81, pe: 18.6, hi: 1213.03, lo: 718.31, mc: '3671.11L Cr' },
  { sym: 'TATA65', name: 'Tata Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 1400.86, chg: -2.87, pe: 62.2, hi: 1811.49, lo: 874.57, mc: '513.59L Cr' },
  { sym: 'STRIDE66', name: 'Strides Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 132.12, chg: 2.77, pe: 92.5, hi: 158.7, lo: 80.23, mc: '1672.79L Cr' },
  { sym: 'ADANIT67', name: 'Adani Total Pharma Ltd', exc: 'NSE', sec: 'Pharma', price: 1185.6, chg: -1.82, pe: 91.9, hi: 1620.67, lo: 715.26, mc: '10268.55L Cr' },
  { sym: 'WOCKHA68', name: 'Wockhardt Petrochemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 2153.89, chg: -3.11, pe: 134.4, hi: 2964.15, lo: 1524.06, mc: '5188.68L Cr' },
  { sym: 'KANSAI69', name: 'Kansai Motors Ltd', exc: 'BSE', sec: 'Auto', price: 7678.84, chg: 3.75, pe: 48.0, hi: 9634.0, lo: 6855.43, mc: '19948.64L Cr' },
  { sym: 'MUTHOO70', name: 'Muthoot IT Ltd', exc: 'NSE', sec: 'Technology', price: 3703.52, chg: 2.05, pe: 132.5, hi: 4458.66, lo: 3368.27, mc: '7392.36L Cr' },
  { sym: 'BOSCH71', name: 'Bosch Medical Ltd', exc: 'NSE', sec: 'Healthcare', price: 1881.85, chg: -3.74, pe: 57.3, hi: 2672.0, lo: 1184.97, mc: '263.24L Cr' },
  { sym: 'MISHRA72', name: 'Mishra Dhatu Projects Ltd', exc: 'BSE', sec: 'Infra', price: 3058.12, chg: -3.0, pe: 48.7, hi: 4211.11, lo: 2207.76, mc: '5854.18L Cr' },
  { sym: 'DECCAN73', name: 'Deccan Cement Pharma Ltd', exc: 'BSE', sec: 'Pharma', price: 4681.19, chg: 3.39, pe: 146.8, hi: 6371.63, lo: 3048.89, mc: '6274.96L Cr' },
  { sym: 'BERGER74', name: 'Berger Systems Ltd', exc: 'NSE', sec: 'Defence', price: 3443.95, chg: 5.1, pe: 18.1, hi: 4986.53, lo: 2285.6, mc: '8655.55L Cr' },
  { sym: 'HINDAL75', name: 'Hindalco Builders Ltd', exc: 'BSE', sec: 'Infra', price: 3513.09, chg: 3.44, pe: 121.3, hi: 4607.7, lo: 2410.22, mc: '14780.84L Cr' },
  { sym: 'VOLTAS76', name: 'Voltas Auto Ltd', exc: 'BSE', sec: 'Auto', price: 6576.7, chg: -3.66, pe: 81.4, hi: 8948.5, lo: 5813.49, mc: '2785.43L Cr' },
  { sym: 'TATA77', name: 'Tata Alloys Ltd', exc: 'NSE', sec: 'Metals', price: 307.67, chg: 1.08, pe: 138.5, hi: 330.39, lo: 222.22, mc: '4534.26L Cr' },
  { sym: 'MUTHOO78', name: 'Muthoot Materials Ltd', exc: 'NSE', sec: 'Chemicals', price: 1172.5, chg: 5.22, pe: 40.2, hi: 1619.37, lo: 726.43, mc: '3119.77L Cr' },
  { sym: 'MAHIND79', name: 'Mahindra Beverages Ltd', exc: 'NSE', sec: 'FMCG', price: 9561.03, chg: -0.78, pe: 101.1, hi: 10321.21, lo: 8538.98, mc: '6639.29L Cr' },
  { sym: 'OBEROI80', name: 'Oberoi Steel Ltd', exc: 'NSE', sec: 'Metals', price: 168.47, chg: 1.19, pe: 26.7, hi: 189.19, lo: 144.93, mc: '1768.75L Cr' },
  { sym: 'CEAT81', name: 'CEAT Lifestyle Ltd', exc: 'BSE', sec: 'Consumer', price: 1322.84, chg: 3.31, pe: 46.6, hi: 1471.47, lo: 1201.67, mc: '650.05L Cr' },
  { sym: 'SAIL82', name: 'SAIL Auto Ltd', exc: 'NSE', sec: 'Auto', price: 657.58, chg: 1.04, pe: 138.3, hi: 822.47, lo: 557.81, mc: '921.29L Cr' },
  { sym: 'LAL83', name: 'Lal Securities Ltd', exc: 'BSE', sec: 'Finance', price: 1958.06, chg: -2.38, pe: 36.7, hi: 2199.84, lo: 1686.08, mc: '18477.68L Cr' },
  { sym: 'COCHIN84', name: 'Cochin Shipyard Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 1271.93, chg: 3.77, pe: 121.5, hi: 1664.52, lo: 849.85, mc: '240.98L Cr' },
  { sym: 'BOSCH85', name: 'Bosch Real Estate Ltd', exc: 'BSE', sec: 'Realty', price: 61.32, chg: 0.92, pe: -1, hi: 79.03, lo: 53.03, mc: '211.08L Cr' },
  { sym: 'WOCKHA86', name: 'Wockhardt Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 1910.25, chg: 1.15, pe: 119.6, hi: 2040.67, lo: 1356.47, mc: '663.06L Cr' },
  { sym: 'DIVI87', name: 'Divi Metals Ltd', exc: 'BSE', sec: 'Metals', price: 865.34, chg: -1.36, pe: 56.6, hi: 953.44, lo: 723.55, mc: '5151.77L Cr' },
  { sym: 'STK0879', name: 'Adani Wilmar Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 7781.57, chg: -4.26, pe: 74.2, hi: 10874.94, lo: 4770.83, mc: '17246.13L Cr' },
  { sym: 'STK0880', name: 'Voltas Finance Ltd', exc: 'NSE', sec: 'Finance', price: 2865.53, chg: 3.57, pe: 116.5, hi: 3193.4, lo: 2685.81, mc: '21652.89L Cr' },
  { sym: 'LAL90', name: 'Lal Drugs Ltd', exc: 'BSE', sec: 'Pharma', price: 2375.53, chg: -1.59, pe: 141.3, hi: 2532.33, lo: 2017.93, mc: '8006.36L Cr' },
  { sym: 'YATHAR91', name: 'Yatharth Developers Ltd', exc: 'NSE', sec: 'Realty', price: 960.11, chg: -3.53, pe: -1, hi: 1302.42, lo: 680.08, mc: '13318.02L Cr' },
  { sym: 'RATNAM92', name: 'Ratnamani Garments Ltd', exc: 'NSE', sec: 'Textiles', price: 449.24, chg: -2.8, pe: 14.9, hi: 575.3, lo: 325.11, mc: '459.02L Cr' },
  { sym: 'EXIDE93', name: 'Exide Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1976.44, chg: 2.0, pe: 23.0, hi: 2524.89, lo: 1213.25, mc: '13818.59L Cr' },
  { sym: 'LAURUS94', name: 'Laurus Materials Ltd', exc: 'NSE', sec: 'Chemicals', price: 1654.73, chg: 5.02, pe: 103.9, hi: 2072.35, lo: 1145.06, mc: '19870.80L Cr' },
  { sym: 'SYMPHO95', name: 'Symphony Housing Ltd', exc: 'NSE', sec: 'Realty', price: 753.99, chg: -4.42, pe: 47.1, hi: 839.4, lo: 557.76, mc: '436.73L Cr' },
  { sym: 'AARTI96', name: 'Aarti Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 893.19, chg: -3.41, pe: 20.7, hi: 1280.67, lo: 660.01, mc: '3154.96L Cr' },
  { sym: 'STK0888', name: 'BEL Capital Ltd', exc: 'BSE', sec: 'Finance', price: 750.6, chg: -2.37, pe: 21.6, hi: 924.61, lo: 593.56, mc: '2193.76L Cr' },
  { sym: 'HAL98', name: 'HAL Electric Ltd', exc: 'BSE', sec: 'Energy', price: 716.39, chg: -3.88, pe: 119.5, hi: 1032.62, lo: 483.35, mc: '99.31L Cr' },
  { sym: 'PARAS99', name: 'Paras Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1809.54, chg: -3.66, pe: -1, hi: 2193.21, lo: 1274.67, mc: '22495.48L Cr' },
  { sym: 'AMARA1', name: 'Amara Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 10209.84, chg: 3.81, pe: -1, hi: 14402.58, lo: 7348.09, mc: '26593.86L Cr' },
  { sym: 'SOLARA2', name: 'Solara Metals Ltd', exc: 'BSE', sec: 'Metals', price: 464.57, chg: 5.16, pe: 137.3, hi: 593.78, lo: 412.56, mc: '4665.40L Cr' },
  { sym: 'GLOBAL3', name: 'Global Health Petroleum Ltd', exc: 'NSE', sec: 'Energy', price: 1111.81, chg: -3.05, pe: 124.4, hi: 1493.99, lo: 988.21, mc: '392.05L Cr' },
  { sym: 'GUJARA4', name: 'Gujarat Fluorochemicals Garments Ltd', exc: 'BSE', sec: 'Textiles', price: 565.59, chg: -3.36, pe: 63.9, hi: 711.67, lo: 340.08, mc: '4254.13L Cr' },
  { sym: 'GLOBAL5', name: 'Global Health Hospitals Ltd', exc: 'BSE', sec: 'Healthcare', price: 2627.88, chg: -4.14, pe: 32.2, hi: 3491.34, lo: 2288.97, mc: '7076.44L Cr' },
  { sym: 'JUPITE6', name: 'Jupiter Power Ltd', exc: 'NSE', sec: 'Energy', price: 1460.44, chg: -0.8, pe: 48.8, hi: 1712.78, lo: 1294.93, mc: '1843.36L Cr' },
  { sym: 'GOODYE7', name: 'Goodyear Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 997.66, chg: 0.73, pe: 21.4, hi: 1117.7, lo: 748.18, mc: '2118.96L Cr' },
  { sym: 'MAZAGO8', name: 'Mazagon Dock Auto Ltd', exc: 'BSE', sec: 'Auto', price: 4826.13, chg: 1.84, pe: 141.0, hi: 6816.2, lo: 3063.28, mc: '7131.47L Cr' },
  { sym: 'STK0899', name: 'Hindalco Bank Ltd', exc: 'NSE', sec: 'Finance', price: 1906.34, chg: 0.46, pe: 139.4, hi: 2077.68, lo: 1440.12, mc: '937.93L Cr' },
  { sym: 'ADANIW10', name: 'Adani Wilmar Lifestyle Ltd', exc: 'BSE', sec: 'Consumer', price: 753.83, chg: 1.02, pe: 129.2, hi: 1078.14, lo: 544.8, mc: '5616.97L Cr' },
  { sym: 'STK0901', name: 'ACC Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 83.95, chg: 0.58, pe: 100.5, hi: 98.47, lo: 76.89, mc: '1033.02L Cr' },
  { sym: 'MAHIND12', name: 'Mahindra Systems Ltd', exc: 'BSE', sec: 'Technology', price: 453.57, chg: 3.41, pe: 80.2, hi: 610.73, lo: 322.54, mc: '893.31L Cr' },
  { sym: 'RAMCO13', name: 'Ramco Constructions Ltd', exc: 'NSE', sec: 'Infra', price: 4534.77, chg: 1.66, pe: 12.5, hi: 6451.96, lo: 3401.92, mc: '33782.94L Cr' },
  { sym: 'BALKRI14', name: 'Balkrishna Products Ltd', exc: 'NSE', sec: 'FMCG', price: 10197.35, chg: -2.92, pe: 108.0, hi: 11222.51, lo: 6540.89, mc: '46858.24L Cr' },
  { sym: 'INDIAB15', name: 'Indiabulls Armaments Ltd', exc: 'NSE', sec: 'Defence', price: 3512.01, chg: -2.46, pe: -1, hi: 4302.1, lo: 2880.24, mc: '1564.93L Cr' },
  { sym: 'MAHIND16', name: 'Mahindra FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 14380.49, chg: 5.33, pe: 117.8, hi: 16172.62, lo: 11912.55, mc: '12898.97L Cr' },
  { sym: 'DECCAN17', name: 'Deccan Cement Coatings Ltd', exc: 'NSE', sec: 'Chemicals', price: 2596.83, chg: 3.2, pe: 44.9, hi: 3697.86, lo: 2128.37, mc: '19353.81L Cr' },
  { sym: 'HAL18', name: 'HAL Bank Ltd', exc: 'NSE', sec: 'Finance', price: 1458.51, chg: -3.43, pe: 134.7, hi: 1585.56, lo: 1127.41, mc: '8862.42L Cr' },
  { sym: 'TATA19', name: 'Tata Projects Ltd', exc: 'NSE', sec: 'Infra', price: 4030.09, chg: -3.76, pe: 16.1, hi: 5339.61, lo: 2947.36, mc: '23006.14L Cr' },
  { sym: 'BIRLA20', name: 'Birla Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1539.42, chg: 2.1, pe: 128.9, hi: 1688.56, lo: 1108.36, mc: '10633.18L Cr' },
  { sym: 'SJVN21', name: 'SJVN Properties Ltd', exc: 'NSE', sec: 'Realty', price: 200.47, chg: 4.77, pe: 9.3, hi: 212.34, lo: 156.19, mc: '531.79L Cr' },
  { sym: 'MANAPP22', name: 'Manappuram Finance Ltd', exc: 'NSE', sec: 'Finance', price: 234.07, chg: -3.67, pe: 23.4, hi: 271.4, lo: 156.76, mc: '307.63L Cr' },
  { sym: 'DECCAN23', name: 'Deccan Cement Labs Ltd', exc: 'BSE', sec: 'Pharma', price: 2468.46, chg: -0.14, pe: 138.7, hi: 2838.82, lo: 1652.03, mc: '30085.06L Cr' },
  { sym: 'ADANIT24', name: 'Adani Total Builders Ltd', exc: 'NSE', sec: 'Infra', price: 4752.46, chg: -1.38, pe: 143.3, hi: 5917.44, lo: 4319.99, mc: '30211.68L Cr' },
  { sym: 'BEL25', name: 'BEL Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 1613.84, chg: -0.21, pe: 59.2, hi: 2102.96, lo: 1004.6, mc: '234.99L Cr' },
  { sym: 'VARROC26', name: 'Varroc Vehicles Ltd', exc: 'BSE', sec: 'Auto', price: 7207.68, chg: -0.52, pe: 122.3, hi: 8806.02, lo: 4793.61, mc: '7899.33L Cr' },
  { sym: 'BALKRI27', name: 'Balkrishna Steel Ltd', exc: 'BSE', sec: 'Metals', price: 181.83, chg: -4.4, pe: 108.9, hi: 206.47, lo: 145.21, mc: '281.33L Cr' },
  { sym: 'ORIENT28', name: 'Orient Investments Ltd', exc: 'BSE', sec: 'Finance', price: 638.87, chg: -2.33, pe: 108.9, hi: 912.63, lo: 563.87, mc: '4961.12L Cr' },
  { sym: 'TATAST29', name: 'Tata Steel Drugs Ltd', exc: 'BSE', sec: 'Pharma', price: 3490.13, chg: 3.63, pe: 12.2, hi: 4354.19, lo: 2151.24, mc: '2456.34L Cr' },
  { sym: 'MEDANT30', name: 'Medanta Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1322.43, chg: -2.14, pe: -1, hi: 1397.99, lo: 1156.01, mc: '222.42L Cr' },
  { sym: 'JKCEME31', name: 'JK Cement Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 522.8, chg: 4.46, pe: 10.7, hi: 683.78, lo: 326.39, mc: '803.93L Cr' },
  { sym: 'STK0922', name: 'Gujarat Adani Consumer Goods Ltd', exc: 'BSE', sec: 'FMCG', price: 5602.27, chg: -0.5, pe: 50.4, hi: 7254.54, lo: 4132.6, mc: '35906.63L Cr' },
  { sym: 'MFAC33', name: 'MFAC Chemicals Ltd', exc: 'NSE', sec: 'Chemicals', price: 2982.15, chg: -4.21, pe: -1, hi: 3143.66, lo: 1899.03, mc: '13314.70L Cr' },
  { sym: 'PURAVA34', name: 'Puravankara Cement Ltd', exc: 'NSE', sec: 'Infra', price: 1527.49, chg: 3.66, pe: 5.7, hi: 2024.38, lo: 944.56, mc: '1420.74L Cr' },
  { sym: 'MRF35', name: 'MRF Infotech Ltd', exc: 'BSE', sec: 'Technology', price: 652.7, chg: 1.63, pe: 44.1, hi: 729.81, lo: 423.09, mc: '812.51L Cr' },
  { sym: 'HINDAL36', name: 'Hindalco Coatings Ltd', exc: 'NSE', sec: 'Chemicals', price: 2685.01, chg: 2.18, pe: 39.9, hi: 3332.56, lo: 2071.58, mc: '11689.21L Cr' },
  { sym: 'ADANIT37', name: 'Adani Total Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 456.06, chg: 2.61, pe: 126.2, hi: 523.08, lo: 376.93, mc: '5449.52L Cr' },
  { sym: 'BIRLA38', name: 'Birla Securities Ltd', exc: 'BSE', sec: 'Finance', price: 214.51, chg: -2.34, pe: 32.2, hi: 234.2, lo: 144.37, mc: '1349.20L Cr' },
  { sym: 'SUPRAJ39', name: 'Suprajit Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 1937.15, chg: 2.05, pe: 20.3, hi: 2134.79, lo: 1783.81, mc: '6845.84L Cr' },
  { sym: 'PURAVA40', name: 'Puravankara Realty Ltd', exc: 'NSE', sec: 'Realty', price: 791.02, chg: -1.72, pe: 49.5, hi: 1105.79, lo: 654.12, mc: '2050.50L Cr' },
  { sym: 'RATNAM41', name: 'Ratnamani FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 6165.95, chg: -1.83, pe: 82.0, hi: 7342.31, lo: 3954.93, mc: '24500.57L Cr' },
  { sym: 'TATAST42', name: 'Tata Steel Petroleum Ltd', exc: 'NSE', sec: 'Energy', price: 655.7, chg: -1.16, pe: 58.6, hi: 701.37, lo: 481.21, mc: '2458.35L Cr' },
  { sym: 'MINDA43', name: 'Minda Petroleum Ltd', exc: 'BSE', sec: 'Energy', price: 277.84, chg: 1.57, pe: 20.8, hi: 297.27, lo: 190.91, mc: '76.87L Cr' },
  { sym: 'BLUEST44', name: 'Blue Star Textiles Ltd', exc: 'NSE', sec: 'Textiles', price: 502.66, chg: 0.82, pe: 133.0, hi: 668.44, lo: 372.77, mc: '900.01L Cr' },
  { sym: 'PRESTI45', name: 'Prestige Petrochemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 1313.65, chg: -1.02, pe: 91.5, hi: 1764.96, lo: 831.52, mc: '9305.56L Cr' },
  { sym: 'STK0936', name: 'REC Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 1749.36, chg: -2.8, pe: 29.2, hi: 2069.25, lo: 1328.33, mc: '22535.62L Cr' },
  { sym: 'AMARA47', name: 'Amara Infrastructure Ltd', exc: 'BSE', sec: 'Infra', price: 251.01, chg: -2.79, pe: 6.4, hi: 298.92, lo: 192.23, mc: '6.61L Cr' },
  { sym: 'TATA48', name: 'Tata Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 376.8, chg: 3.85, pe: 29.3, hi: 417.73, lo: 238.46, mc: '1697.90L Cr' },
  { sym: 'GLAND49', name: 'Gland Networks Ltd', exc: 'NSE', sec: 'Telecom', price: 1549.19, chg: 2.13, pe: 71.5, hi: 2139.59, lo: 1092.79, mc: '5409.88L Cr' },
  { sym: 'IRFC50', name: 'IRFC Biotech Ltd', exc: 'BSE', sec: 'Pharma', price: 785.62, chg: 2.78, pe: -1, hi: 1132.44, lo: 706.82, mc: '1556.68L Cr' },
  { sym: 'SJVN51', name: 'SJVN Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 715.43, chg: -0.91, pe: 33.1, hi: 1024.44, lo: 589.2, mc: '12134.30L Cr' },
  { sym: 'STRIDE52', name: 'Strides Pharmaceuticals Ltd', exc: 'BSE', sec: 'Pharma', price: 4939.83, chg: -1.85, pe: 133.8, hi: 5959.46, lo: 3685.37, mc: '31053.34L Cr' },
  { sym: 'KANSAI53', name: 'Kansai Digital Ltd', exc: 'BSE', sec: 'Technology', price: 4220.61, chg: 3.45, pe: 119.9, hi: 5017.46, lo: 2695.14, mc: '691.72L Cr' },
  { sym: 'GRANUL54', name: 'Granules Medical Ltd', exc: 'BSE', sec: 'Healthcare', price: 2787.51, chg: 1.74, pe: 49.0, hi: 3248.3, lo: 2452.8, mc: '45.32L Cr' },
  { sym: 'SUPRAJ55', name: 'Suprajit Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 455.33, chg: -0.2, pe: 5.1, hi: 523.89, lo: 329.01, mc: '2222.34L Cr' },
  { sym: 'NBCC56', name: 'NBCC Drugs Ltd', exc: 'NSE', sec: 'Pharma', price: 6689.69, chg: -3.07, pe: 67.6, hi: 9481.32, lo: 4694.7, mc: '4074.66L Cr' },
  { sym: 'EMAMI57', name: 'Emami Utilities Ltd', exc: 'BSE', sec: 'Energy', price: 553.27, chg: 4.7, pe: 30.1, hi: 677.38, lo: 501.58, mc: '1315.56L Cr' },
  { sym: 'NALCO58', name: 'Nalco Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 1750.06, chg: -1.49, pe: -1, hi: 2234.24, lo: 1434.89, mc: '7304.99L Cr' },
  { sym: 'STRIDE59', name: 'Strides Apparel Ltd', exc: 'BSE', sec: 'Textiles', price: 129.94, chg: 2.44, pe: 104.3, hi: 155.02, lo: 94.07, mc: '1166.87L Cr' },
  { sym: 'MAHIND60', name: 'Mahindra Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1851.35, chg: -3.62, pe: 136.5, hi: 2526.45, lo: 1486.84, mc: '8637.33L Cr' },
  { sym: 'RAMCO61', name: 'Ramco Fabrics Ltd', exc: 'BSE', sec: 'Textiles', price: 107.84, chg: -0.47, pe: -1, hi: 148.06, lo: 97.73, mc: '63.37L Cr' },
  { sym: 'COCHIN62', name: 'Cochin Shipyard Tech Ltd', exc: 'BSE', sec: 'Technology', price: 4200.5, chg: -1.17, pe: -1, hi: 4898.75, lo: 3228.14, mc: '1957.42L Cr' },
  { sym: 'GRANUL63', name: 'Granules FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 17599.0, chg: 1.12, pe: 24.8, hi: 24779.76, lo: 14499.53, mc: '34521.68L Cr' },
  { sym: 'MFAC64', name: 'MFAC FMCG Ltd', exc: 'NSE', sec: 'FMCG', price: 20179.3, chg: -3.35, pe: -1, hi: 26061.89, lo: 12962.42, mc: '8336.16L Cr' },
  { sym: 'JSW65', name: 'JSW Broadband Ltd', exc: 'NSE', sec: 'Telecom', price: 1715.63, chg: -3.94, pe: 63.7, hi: 2475.79, lo: 1521.93, mc: '15922.55L Cr' },
  { sym: 'BEML66', name: 'BEML Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 2169.39, chg: -0.18, pe: 31.8, hi: 2988.16, lo: 1800.84, mc: '5527.95L Cr' },
  { sym: 'VARROC67', name: 'Varroc Vehicles Ltd', exc: 'NSE', sec: 'Auto', price: 7404.3, chg: 2.18, pe: 76.5, hi: 9752.05, lo: 5456.35, mc: '12013.98L Cr' },
  { sym: 'BOSCH68', name: 'Bosch Projects Ltd', exc: 'BSE', sec: 'Infra', price: 868.61, chg: -3.3, pe: 89.2, hi: 923.88, lo: 718.9, mc: '5139.32L Cr' },
  { sym: 'AARTI69', name: 'Aarti Apparel Ltd', exc: 'BSE', sec: 'Textiles', price: 580.65, chg: -1.73, pe: 56.9, hi: 808.46, lo: 450.66, mc: '2875.51L Cr' },
  { sym: 'HDIL70', name: 'HDIL Cement Ltd', exc: 'NSE', sec: 'Infra', price: 1561.08, chg: 2.06, pe: 71.6, hi: 2175.31, lo: 1013.16, mc: '16222.90L Cr' },
  { sym: 'STK0961', name: 'Bharat Forge Apparel Ltd', exc: 'BSE', sec: 'Textiles', price: 115.47, chg: -0.73, pe: 100.6, hi: 147.85, lo: 106.76, mc: '949.53L Cr' },
  { sym: 'STK0962', name: 'Global Health Medical Ltd', exc: 'BSE', sec: 'Healthcare', price: 2437.64, chg: 1.34, pe: 14.8, hi: 2588.31, lo: 2087.86, mc: '7565.28L Cr' },
  { sym: 'VOLTAS73', name: 'Voltas Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 850.22, chg: -3.45, pe: 110.6, hi: 1023.35, lo: 799.77, mc: '1118.46L Cr' },
  { sym: 'ADANIP74', name: 'Adani Ports Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 379.61, chg: -0.08, pe: 96.5, hi: 403.06, lo: 250.89, mc: '373.46L Cr' },
  { sym: 'DEEPAK75', name: 'Deepak Nitrite Health Ltd', exc: 'NSE', sec: 'Healthcare', price: 1691.74, chg: 2.29, pe: 112.6, hi: 2070.06, lo: 1327.99, mc: '2543.88L Cr' },
  { sym: 'DECCAN76', name: 'Deccan Cement Systems Ltd', exc: 'NSE', sec: 'Technology', price: 2026.55, chg: 4.43, pe: 64.2, hi: 2570.95, lo: 1266.97, mc: '5514.92L Cr' },
  { sym: 'CROMPT77', name: 'Crompton Fashion Ltd', exc: 'BSE', sec: 'Textiles', price: 178.87, chg: 3.78, pe: 56.7, hi: 252.19, lo: 160.75, mc: '1274.79L Cr' },
  { sym: 'YATHAR78', name: 'Yatharth Pharma Ltd', exc: 'BSE', sec: 'Pharma', price: 4401.39, chg: -3.23, pe: 19.6, hi: 5499.47, lo: 2720.14, mc: '1538.38L Cr' },
  { sym: 'EXIDE79', name: 'Exide Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 2317.34, chg: 2.53, pe: -1, hi: 3241.01, lo: 2175.61, mc: '2021.14L Cr' },
  { sym: 'JINDAL80', name: 'Jindal Materials Ltd', exc: 'BSE', sec: 'Chemicals', price: 1088.17, chg: 2.48, pe: 73.3, hi: 1541.89, lo: 753.09, mc: '228.51L Cr' },
  { sym: 'ADANIG81', name: 'Adani Green Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 1805.8, chg: -3.11, pe: 111.4, hi: 2563.64, lo: 1502.73, mc: '7716.68L Cr' },
  { sym: 'OBEROI82', name: 'Oberoi Capital Ltd', exc: 'NSE', sec: 'Finance', price: 1135.66, chg: 1.48, pe: 16.7, hi: 1442.94, lo: 1057.65, mc: '315.76L Cr' },
  { sym: 'COCHIN83', name: 'Cochin Shipyard IT Ltd', exc: 'BSE', sec: 'Technology', price: 2685.74, chg: -0.18, pe: 128.2, hi: 3863.67, lo: 1631.6, mc: '2326.73L Cr' },
  { sym: 'AMBUJA84', name: 'Ambuja Defence Ltd', exc: 'NSE', sec: 'Defence', price: 2602.56, chg: 1.02, pe: -1, hi: 3529.78, lo: 2195.01, mc: '9681.77L Cr' },
  { sym: 'BEML85', name: 'BEML Medical Ltd', exc: 'NSE', sec: 'Healthcare', price: 3290.49, chg: -0.98, pe: 138.1, hi: 3768.49, lo: 2080.24, mc: '290.72L Cr' },
  { sym: 'BIRLA86', name: 'Birla Aerospace Ltd', exc: 'NSE', sec: 'Defence', price: 3972.82, chg: 3.63, pe: -1, hi: 4372.83, lo: 2634.8, mc: '1250.79L Cr' },
  { sym: 'LAL87', name: 'Lal Biotech Ltd', exc: 'NSE', sec: 'Pharma', price: 6987.2, chg: -0.52, pe: 100.2, hi: 7550.03, lo: 6487.12, mc: '20412.75L Cr' },
  { sym: 'WHIRLP88', name: 'Whirlpool Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 2259.45, chg: 2.63, pe: 118.1, hi: 2636.94, lo: 1872.58, mc: '6546.68L Cr' },
  { sym: 'HINDAL89', name: 'Hindalco Products Ltd', exc: 'NSE', sec: 'FMCG', price: 1539.14, chg: 0.36, pe: -1, hi: 2177.61, lo: 1376.76, mc: '5004.29L Cr' },
  { sym: 'NLC90', name: 'NLC Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 2279.85, chg: -4.14, pe: 68.8, hi: 3090.74, lo: 2128.39, mc: '832.14L Cr' },
  { sym: 'ENDURA91', name: 'Endurance Consumer Ltd', exc: 'BSE', sec: 'Consumer', price: 1826.48, chg: -3.9, pe: 60.7, hi: 1931.57, lo: 1340.46, mc: '3768.67L Cr' },
  { sym: 'SOLARA92', name: 'Solara Infrastructure Ltd', exc: 'NSE', sec: 'Infra', price: 5347.42, chg: 2.1, pe: -1, hi: 7246.82, lo: 4962.56, mc: '73675.06L Cr' },
  { sym: 'MEDANT93', name: 'Medanta Metals Ltd', exc: 'BSE', sec: 'Metals', price: 740.6, chg: 3.07, pe: 125.2, hi: 906.22, lo: 555.19, mc: '7973.49L Cr' },
  { sym: 'NLC94', name: 'NLC Infotech Ltd', exc: 'NSE', sec: 'Technology', price: 4649.71, chg: -1.63, pe: 82.5, hi: 5670.48, lo: 3960.28, mc: '19132.76L Cr' },
  { sym: 'BLUEST95', name: 'Blue Star Constructions Ltd', exc: 'BSE', sec: 'Infra', price: 3766.32, chg: 4.58, pe: 104.0, hi: 4368.02, lo: 3576.43, mc: '17599.83L Cr' },
  { sym: 'MINDA96', name: 'Minda Properties Ltd', exc: 'BSE', sec: 'Realty', price: 69.34, chg: -1.81, pe: 99.7, hi: 94.21, lo: 41.9, mc: '282.99L Cr' },
  { sym: 'JSW97', name: 'JSW Coatings Ltd', exc: 'BSE', sec: 'Chemicals', price: 2141.84, chg: -4.33, pe: -1, hi: 2280.63, lo: 1554.02, mc: '15331.40L Cr' },
  { sym: 'WOCKHA98', name: 'Wockhardt Cement Ltd', exc: 'NSE', sec: 'Infra', price: 4720.65, chg: 4.47, pe: 143.2, hi: 5788.35, lo: 3258.68, mc: '19830.88L Cr' },
  { sym: 'DLF99', name: 'DLF Telecom Ltd', exc: 'NSE', sec: 'Telecom', price: 686.61, chg: 4.21, pe: 38.7, hi: 900.72, lo: 456.25, mc: '3104.29L Cr' },
  { sym: 'VOLTAS1', name: 'Voltas Steel Ltd', exc: 'NSE', sec: 'Metals', price: 699.82, chg: 5.02, pe: 146.4, hi: 739.32, lo: 626.85, mc: '6480.32L Cr' },
  { sym: 'OBEROI2', name: 'Oberoi Software Ltd', exc: 'NSE', sec: 'Technology', price: 3122.97, chg: -0.06, pe: 39.4, hi: 3686.09, lo: 2279.69, mc: '21677.00L Cr' },
  { sym: 'MUTHOO3', name: 'Muthoot Pharma Ltd', exc: 'BSE', sec: 'Pharma', price: 4410.3, chg: -1.23, pe: 53.6, hi: 5350.82, lo: 3652.58, mc: '40450.82L Cr' },
  { sym: 'BAJAJ4', name: 'Bajaj Properties Ltd', exc: 'NSE', sec: 'Realty', price: 202.3, chg: 4.8, pe: 8.7, hi: 261.7, lo: 178.59, mc: '1619.12L Cr' },
  { sym: 'AMBUJA5', name: 'Ambuja Motors Ltd', exc: 'BSE', sec: 'Auto', price: 11303.3, chg: 2.07, pe: 115.6, hi: 14803.76, lo: 10560.82, mc: '215069.37L Cr' },
  { sym: 'KANSAI6', name: 'Kansai Housing Ltd', exc: 'BSE', sec: 'Realty', price: 449.62, chg: 3.48, pe: 100.6, hi: 565.68, lo: 319.65, mc: '1018.37L Cr' },
  { sym: 'ORIENT7', name: 'Orient Cement Garments Ltd', exc: 'NSE', sec: 'Textiles', price: 330.08, chg: -2.19, pe: 146.0, hi: 438.09, lo: 249.46, mc: '2628.81L Cr' },
  { sym: 'STK0997', name: 'Oberoi Financial Ltd', exc: 'BSE', sec: 'Finance', price: 1164.87, chg: 2.03, pe: 70.1, hi: 1418.28, lo: 931.05, mc: '2581.92L Cr' },
  { sym: 'STK0998', name: 'Hindalco Automobiles Ltd', exc: 'NSE', sec: 'Auto', price: 11758.5, chg: 1.56, pe: 54.5, hi: 12901.26, lo: 8736.28, mc: '18645.40L Cr' },
  { sym: 'RATNAM10', name: 'Ratnamani Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 1829.78, chg: -2.83, pe: 116.0, hi: 2441.94, lo: 1398.78, mc: '3232.66L Cr' },
  { sym: 'PRESTI11', name: 'Prestige Chemicals Ltd', exc: 'BSE', sec: 'Chemicals', price: 206.24, chg: -3.18, pe: 138.2, hi: 291.15, lo: 149.32, mc: '932.28L Cr' },
  { sym: 'CEAT12', name: 'CEAT Products Ltd', exc: 'BSE', sec: 'FMCG', price: 2512.74, chg: 1.59, pe: 109.7, hi: 2712.51, lo: 2317.38, mc: '43517.55L Cr' },
  { sym: 'TATAST13', name: 'Tata Steel Drugs Ltd', exc: 'BSE', sec: 'Pharma', price: 3768.31, chg: 3.08, pe: 111.3, hi: 5047.59, lo: 3038.56, mc: '31790.26L Cr' },
  { sym: 'ACC14', name: 'ACC Health Ltd', exc: 'NSE', sec: 'Healthcare', price: 4317.45, chg: -0.71, pe: 78.8, hi: 5548.93, lo: 4018.12, mc: '2558.60L Cr' },
  { sym: 'STRIDE15', name: 'Strides Minerals Ltd', exc: 'NSE', sec: 'Metals', price: 711.83, chg: 0.58, pe: 46.4, hi: 856.78, lo: 615.77, mc: '699.32L Cr' },
  { sym: 'MINDA16', name: 'Minda Products Ltd', exc: 'NSE', sec: 'FMCG', price: 10877.33, chg: 4.3, pe: 55.4, hi: 12141.68, lo: 7622.24, mc: '24509.99L Cr' },
  { sym: 'STK1006', name: 'Amara Diagnostics Ltd', exc: 'BSE', sec: 'Healthcare', price: 3768.98, chg: 3.03, pe: 101.6, hi: 4170.0, lo: 2534.24, mc: '47887.92L Cr' },
  { sym: 'GLAND18', name: 'Gland Software Ltd', exc: 'NSE', sec: 'Technology', price: 7698.93, chg: 3.49, pe: -1, hi: 10647.63, lo: 4688.82, mc: '29535.10L Cr' },
  { sym: 'GRANUL19', name: 'Granules Real Estate Ltd', exc: 'BSE', sec: 'Realty', price: 596.39, chg: 3.81, pe: 20.9, hi: 794.71, lo: 534.16, mc: '2322.89L Cr' },
  { sym: 'MINDA20', name: 'Minda Consumer Ltd', exc: 'NSE', sec: 'Consumer', price: 4349.61, chg: 5.18, pe: 112.9, hi: 4954.1, lo: 2722.95, mc: '4675.17L Cr' },
  { sym: 'BALKRI21', name: 'Balkrishna Communications Ltd', exc: 'NSE', sec: 'Telecom', price: 1501.58, chg: -0.17, pe: 120.2, hi: 1767.38, lo: 1343.16, mc: '17452.83L Cr' }
];

// Global state
let STOCKS = [];
let cUser = '', cRole = '', cUserId = null;
let stockPageData = [], stockPage = 1;
const STOCKS_PER_PAGE = 50;
let currentDetailStock = null;

// Activity log — persists to DB permanently
function log(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  const record = { id: Date.now(), msg: entry, user: cUser || 'system', created_at: new Date().toISOString() };
  DB.tables.activity_log.unshift(record);
  if (DB.tables.activity_log.length > 200) DB.tables.activity_log = DB.tables.activity_log.slice(0, 200);
  DB.save();
  const el = document.getElementById('activity-log');
  if (el) el.innerHTML = DB.tables.activity_log.slice(0, 25).map(l => `<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.03)"><span style="color:var(--muted);font-size:10px">${l.user ? '[' + l.user + '] ' : ''}</span>${l.msg}</div>`).join('');
}
function logActivity(msg) { log(msg); }

function toast(msg, type = 'ok') {
  const w = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type === 'ok' ? '✓' : '✗'}</span> ${msg}`;
  w.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ═══ SIGNAL / PREDICTION HELPERS ═══
function sig(s) {
  if (s.chg > 1.5) return 'UPTREND';
  if (s.chg < -1) return 'WATCH';
  return 'STABLE';
}
function sigCls(s) { const g = sig(s); return g === 'UPTREND' ? 'bg' : g === 'WATCH' ? 'ba' : 'bb'; }
function predP(s) {
  const mult = sig(s) === 'UPTREND' ? 1.04 : sig(s) === 'WATCH' ? 0.97 : 1.01;
  return (s.price * (mult + (Math.random() - 0.5) * 0.02)).toFixed(2);
}
function confV() { return (72 + Math.random() * 15).toFixed(1); }

// ═══ AUTH TAB SWITCHER ═══
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('panel-login').style.display = isLogin ? 'block' : 'none';
  document.getElementById('panel-register').style.display = isLogin ? 'none' : 'block';
  document.getElementById('tab-login').style.background = isLogin ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'transparent';
  document.getElementById('tab-login').style.color = isLogin ? '#0a0800' : '#475569';
  document.getElementById('tab-register').style.background = isLogin ? 'transparent' : 'linear-gradient(135deg,#fbbf24,#f59e0b)';
  document.getElementById('tab-register').style.color = isLogin ? '#475569' : '#0a0800';
}

// ═══ AUTH ═══
function onRoleChange() {
  const r = document.getElementById('lr').value;
  const lbl = document.getElementById('lu-label');
  if (lbl) lbl.textContent = r === 'admin' ? 'Admin Username / Email' : 'Username / Email';
  const note = document.getElementById('admin-note');
  if (note) note.style.display = 'none';
}

function fd(u, p, r) {
  document.getElementById('lu').value = u;
  document.getElementById('lp').value = p;
  document.getElementById('lr').value = r;
  onRoleChange();
}

function fillDemo(u, p, r) { fd(u, p, r); }

// ═══ REGISTER ═══
function checkPassStr() {
  const p = document.getElementById('reg-pass').value;
  const bar = document.getElementById('pass-str-bar');
  const fill = document.getElementById('pass-str-fill');
  const lbl = document.getElementById('pass-str-lbl');

  if (!p) {
    bar.style.display = 'none'; lbl.style.display = 'none';
    return;
  }
  bar.style.display = 'block'; lbl.style.display = 'block';

  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;

  if (p.length < 8 || score < 2) {
    fill.style.width = '33%'; fill.style.background = '#fca5a5';
    lbl.textContent = 'Weak (minimum 8 characters)'; lbl.style.color = '#fca5a5';
  } else if (score < 4) {
    fill.style.width = '66%'; fill.style.background = '#fbbf24';
    lbl.textContent = 'Medium (good)'; lbl.style.color = '#fbbf24';
  } else {
    fill.style.width = '100%'; fill.style.background = '#34d399';
    lbl.textContent = 'Strong (excellent)'; lbl.style.color = '#34d399';
  }
}

async function doRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const uname = document.getElementById('reg-uname').value.trim().toLowerCase();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value.trim();
  const pass2 = document.getElementById('reg-pass2').value.trim();
  const role = document.getElementById('reg-role').value;
  const err = document.getElementById('rerr');
  const ok = document.getElementById('rok');
  err.style.display = 'none'; ok.style.display = 'none';

  if (!name || name.length < 2) { err.textContent = 'Full name must be at least 2 characters.'; err.style.display = 'block'; return; }
  if (!uname || uname.length < 3) { err.textContent = 'Username must be at least 3 characters.'; err.style.display = 'block'; return; }
  if (!/^[a-z0-9_]+$/.test(uname)) { err.textContent = 'Username can only contain letters, numbers and underscore.'; err.style.display = 'block'; return; }
  if (!email || !email.includes('@')) { err.textContent = 'Please enter a valid email address.'; err.style.display = 'block'; return; }
  if (!pass || pass.length < 8) { err.textContent = 'Password must be at least 8 characters.'; err.style.display = 'block'; return; }
  if (pass !== pass2) { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }

  // Check username uniqueness
  const existing = DB.tables.users ? DB.tables.users.find(x => x.username.toLowerCase() === uname || x.email.toLowerCase() === email.toLowerCase()) : null;
  if (existing) {
    if (existing.email.toLowerCase() === email.toLowerCase()) {
      err.textContent = `Email "${email}" is already registered. Please login or use another.`;
    } else {
      err.textContent = `Username "${uname}" is already taken. Please choose another.`;
    }
    err.style.display = 'block';
    return;
  }

  try {
    const res = await StockSenseAPI.register({ username: uname, name, email, password: pass, role });
    if (res.tables) DB.tables = { ...DB.tables, ...res.tables };
    else if (res.user) DB.tables.users.push(res.user);
    logActivity(`New account registered: ${uname} (${role})`);

    ok.textContent = `Account created! You can sign in as "${uname}" (${role}).`;
    ok.style.display = 'block';
    ['reg-name', 'reg-uname', 'reg-email', 'reg-pass', 'reg-pass2'].forEach(id => document.getElementById(id).value = '');
    setTimeout(() => {
      switchAuthTab('login');
      document.getElementById('lu').value = uname;
      document.getElementById('lr').value = role;
      onRoleChange();
    }, 1200);
  } catch (e) {
    err.textContent = e.message || 'Registration failed. Please try again.';
    err.style.display = 'block';
  }
}

// ═══ LOGIN ═══
async function doLogin() {
  const u = document.getElementById('lu').value.trim();
  const p = document.getElementById('lp').value.trim();
  const r = document.getElementById('lr').value;
  const err = document.getElementById('lerr');

  err.style.display = 'none';
  if (!u || u.length < 2) {
    err.textContent = 'Please enter your username or email.';
    err.style.display = 'block';
    return;
  }
  if (!p || p.length < 1) {
    err.textContent = 'Please enter a password.';
    err.style.display = 'block';
    return;
  }

  const btn = document.querySelector('#panel-login .btn.bfull');
  if (btn) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = '⏳ Logging in...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
  }

  let user = null;
  try {
    const res = await StockSenseAPI.login({ login: u, password: p, role: r });
    StockSenseAPI.setToken(res.token);
    user = res.user;
    if (res.tables) DB.tables = { ...DB.tables, ...res.tables };
  } catch (e) {
    if (btn) {
      btn.innerHTML = btn.dataset.originalHtml;
      btn.disabled = false;
      btn.style.opacity = '1';
    }
    const msg = e && e.message ? e.message : '';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
      err.textContent = 'Backend connection error. If using free cloud hosting (Render), it may take ~45 seconds to spin up on first request — please wait a moment and try again.';
    } else {
      err.textContent = msg || 'Login failed. Please check your details.';
    }
    err.style.display = 'block';
    return;
  }

  cRole = user.role || r || 'user';
  cUser = user.name || u;
  cUserId = user.id;

  const rb = document.getElementById('rbadge');
  if (rb) {
    rb.textContent = cRole[0].toUpperCase() + cRole.slice(1);
    rb.className = 'role-badge ' + (cRole === 'admin' ? 'rb-admin' : cRole === 'employee' ? 'rb-emp' : 'rb-user');
  }
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('sbuser', cUser);
  setTxt('tbav', cUser[0].toUpperCase());
  setTxt('tbusr', cUser);
  setTxt('pav', cUser[0].toUpperCase());
  setTxt('pname', cUser);
  setTxt('prole', cRole[0].toUpperCase() + cRole.slice(1));
  const pn2 = document.getElementById('pn2'); if (pn2) pn2.value = cUser;
  const pem = document.getElementById('pem'); if (pem) pem.value = user.email || '';

  const mnEmp = document.getElementById('mn-emp'); if (mnEmp) mnEmp.style.display = cRole !== 'user' ? 'block' : 'none';
  const mnAdm = document.getElementById('mn-adm'); if (mnAdm) mnAdm.style.display = cRole === 'admin' ? 'block' : 'none';

  log(`User "${cUser}" (${cRole}) logged in`);

  // INSTANT TRANSITION: Hide login page and show dashboard perfectly rendered immediately
  document.getElementById('login-page').style.display = 'none';
  if (window.__stopLoginBG) window.__stopLoginBG();
  if (window.__startDashBG) setTimeout(window.__startDashBG, 50);
  document.getElementById('app-page').style.display = 'block';
  sv('dashboard');

  // Reset button state silently for next logout
  if (btn) {
    btn.innerHTML = btn.dataset.originalHtml;
    btn.disabled = false;
    btn.style.opacity = '1';
  }

  // Show a loading state ON the dashboard so user knows prices are arriving
  const sb = document.getElementById('mk-tbl');
  if (sb) sb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#94a3b8;font-size:14px;">⏳ Fetching Live Market Data...</td></tr>';

  // Build the rest of the UI and fetch prices in the background
  buildAll();
}

function doLogout() {
  log(`User "${cUser}" logged out`);
  DB.save();
  StockSenseAPI.setToken('');
  document.getElementById('app-page').style.display = 'none';
  if (window.__stopDashBG) window.__stopDashBG();
  if (window.__startLoginBG) setTimeout(window.__startLoginBG, 50);
  document.getElementById('login-page').style.display = 'flex';
  cUser = ''; cRole = ''; cUserId = null;
}

// ═══ NAVIGATION ═══
const TITLES = { dashboard: 'Dashboard', stocks: 'Stock Explorer', detail: 'Stock Detail', prediction: 'AI Prediction Engine', watchlist: 'My Watchlist', alerts: 'Price Alerts', reports: 'Reports', profile: 'My Profile', addstock: 'Manage Stocks', users: 'User Management', adminrep: 'All Reports', database: 'Database Console', system: 'System Settings', emprep: 'Generate Reports' };

function sv(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  const v = document.getElementById('v-' + id);
  if (v) v.classList.add('active');
  document.querySelectorAll('.ni').forEach(n => { if ((n.getAttribute('onclick') || '').includes(`'${id}'`)) n.classList.add('active'); });
  document.getElementById('tbtitle').textContent = TITLES[id] || id;
  if (id === 'database') { buildDbStats(); updateDbStatus(); }
  if (id === 'users') buildUsers();
  if (id === 'adminrep') buildAdminReports();
  if (id === 'system') buildSysHealth();
  if (id === 'watchlist') buildWL();
  if (id === 'alerts') buildAlerts();
  if (id === 'reports' || id === 'emprep') buildReps();
}

// ═══ BUILD ALL ═══
let _livePriceTimer = null;

async function fetchLivePrices(quiet = false) {
  const badge = document.getElementById('live-price-badge');
  const upTime = document.getElementById('live-update-time');
  if (badge) badge.style.display = 'flex';

  try {
    const res = await StockSenseAPI.request('/api/stocks/live');
    if (res && res.prices && Object.keys(res.prices).length > 0) {
      let changed = false;

      // Update STOCKS array with live data
      STOCKS.forEach(s => {
        if (res.prices[s.sym]) {
          const live = res.prices[s.sym];
          if (s.price !== live.price || s.chg !== live.chg) {
            s.price = live.price;
            s.chg = live.chg;
            s.hi = live.hi;
            s.lo = live.lo;
            s._updated = true;
            changed = true;
          } else {
            s._updated = false;
          }
        }
      });

      if (changed && !quiet) {
        if (upTime) {
          const now = new Date();
          upTime.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
        }
        buildTicker();
        buildDashboard();
        buildStocks(STOCKS);
        STOCKS.forEach(s => s._updated = false);
      }
    }
  } catch (e) {
    console.warn("Live price fetch failed:", e);
  }
}

function startLivePriceUpdates() {
  if (_livePriceTimer) clearInterval(_livePriceTimer);
  _livePriceTimer = setInterval(() => fetchLivePrices(false), 15000);
}

async function buildAll() {
  // Merge BASE_STOCKS with any DB stock updates
  STOCKS = [...BASE_STOCKS];
  DB.tables.stocks.forEach(dbS => {
    const idx = STOCKS.findIndex(s => s.sym === dbS.sym);
    if (idx > -1) STOCKS[idx] = { ...STOCKS[idx], ...dbS };
    else STOCKS.push(dbS);
  });

  // Fetch real-time prices FIRST so user sees correct data instantly
  await fetchLivePrices(true);
  STOCKS.forEach(s => s._updated = false); // clear flags for initial render

  buildTicker();
  buildDashboard();
  buildStocks(STOCKS);
  buildWL();
  buildAlerts();
  buildPredHist();
  buildReps();
  buildAdminStocks();
  buildUsers();
  initSymDD();
  updateDbStatus();

  // Kick off real-time prices loop
  startLivePriceUpdates();

  document.getElementById('dash-total').textContent = STOCKS.length.toLocaleString();
  document.getElementById('dash-preds').textContent = DB.tables.predictions.length;
  document.getElementById('dash-wl').textContent = DB.tables.alerts.length || '6';

  // Fill sector filter
  const sectors = [...new Set(STOCKS.map(s => s.sec))].sort();
  const ssec = document.getElementById('ssec');
  if (ssec) {
    ssec.innerHTML = '<option value="">All Sectors</option>' + sectors.map(s => `<option>${s}</option>`).join('');
  }
  // Fill emp report stock select
  const erepStock = document.getElementById('erep-stock');
  if (erepStock) {
    erepStock.innerHTML = '<option value="ALL">All Stocks</option>' + STOCKS.map(s => `<option value="${s.sym}">${s.sym} — ${s.name}</option>`).join('');
  }
}

function updateDbStatus() {
  const total = Object.values(DB.tables).reduce((a, t) => a + t.length, 0);
  const el = document.getElementById('sb-record-count');
  if (el) el.textContent = total;
}

// ═══ TICKER ═══
function buildTicker() {
  const t = STOCKS.map(s => {
    let fCls = '';
    if (s._updated) fCls = s.chg > 0 ? ' price-flash-up' : ' price-flash-down';
    return `<div class="ti${fCls}"><span class="ti-s">${s.sym}</span><span class="ti-p">₹${s.price.toLocaleString()}</span><span class="${s.chg > 0 ? 'up' : 'dn'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</span></div>`;
  }).join('');
  document.getElementById('tkr').innerHTML = t + t;
}

// ═══ DASHBOARD MARKET OVERVIEW ═══
let mkPage = 1, mkPageData = [], MK_PER_PAGE = 20;

function buildDashboard() {
  mkPageData = STOCKS;
  mkPage = 1;
  renderMkPage();

  // Fill sector filter
  const sectors = [...new Set(STOCKS.map(s => s.sec))].sort();
  const mkSec = document.getElementById('mk-sector-filter');
  if (mkSec) {
    mkSec.innerHTML = '<option value="">All Sectors ▼</option>' + sectors.map(s => `<option>${s}</option>`).join('');
  }

  // Recent predictions from DB
  const preds = [...DB.tables.predictions].reverse().slice(0, 8);
  if (preds.length) {
    document.getElementById('rp-tbl').innerHTML = preds.map(p => `
      <tr><td class="sym">${p.symbol}</td>
      <td style="color:var(--accent)">₹${p.predicted_price}</td>
      <td style="color:var(--green)">${p.confidence}%</td>
      <td style="color:var(--muted2);font-size:11px">${p.algorithm}</td></tr>`).join('');
    document.getElementById('dash-pred-src').textContent = 'From SQL DB (' + preds.length + ')';
  } else {
    document.getElementById('rp-tbl').innerHTML = `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:16px">No predictions yet — run one in AI Prediction!</td></tr>`;
  }

  // Sector bars
  const secMap = {};
  STOCKS.forEach(s => { secMap[s.sec] = (secMap[s.sec] || 0) + 1; });
  const total = STOCKS.length;
  const cols = ['var(--accent)', 'var(--accent2)', 'var(--green)', 'var(--amber)', 'var(--red)', '#a78bfa', '#f472b6', '#34d399'];
  document.getElementById('sec-bars').innerHTML = Object.entries(secMap).sort((a, b) => b[1] - a[1]).map(([k, v], i) => {
    const pct = ((v / total) * 100).toFixed(1);
    return `<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--muted2)">${k} <span style="color:var(--muted);font-size:10px">(${v})</span></span><span style="color:${cols[i % cols.length]};font-weight:600">${pct}%</span></div><div class="pb"><div class="pf" style="width:${pct}%;background:${cols[i % cols.length]}"></div></div></div>`;
  }).join('');

  // Update avg confidence metric
  const confEl = document.getElementById('dash-conf');
  if (confEl) confEl.textContent = '78%';
}

function filterDashMk() {
  const sec = document.getElementById('mk-sector-filter')?.value || '';
  const sig2 = document.getElementById('mk-signal-filter')?.value || '';
  mkPageData = STOCKS.filter(s => (!sec || s.sec === sec) && (!sig2 || sig(s) === sig2));
  mkPage = 1;
  renderMkPage();
}

function renderMkPage() {
  const start = (mkPage - 1) * MK_PER_PAGE;
  const pageData = mkPageData.slice(start, start + MK_PER_PAGE);
  document.getElementById('mk-count').textContent = `${mkPageData.length} stocks`;
  document.getElementById('mk-tbl').innerHTML = pageData.map(s => {
    let fCls = '';
    if (s._updated) fCls = s.chg > 0 ? ' class="price-flash-up"' : ' class="price-flash-down"';
    return `
    <tr${fCls}>
      <td class="sym" style="cursor:pointer;color:var(--accent)" onclick="openDetail('${s.sym}')">${s.sym}</td>
      <td>₹${s.price.toLocaleString()}</td>
      <td class="${s.chg > 0 ? 'up' : 'dn'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</td>
      <td><span class="b ${sigCls(s)}">${sig(s)}</span></td>
      <td><button class="ab ab-v" style="font-size:10px;padding:2px 8px" onclick="showDashTrend('${s.sym}')">View</button></td>
    </tr>`;
  }).join('');
  buildMkPagination();
}

function buildMkPagination() {
  const totalPages = Math.ceil(mkPageData.length / MK_PER_PAGE);
  if (totalPages <= 1) { document.getElementById('mk-pagination').innerHTML = ''; return; }
  let html = `<button class="pag-btn" onclick="mkGoPage(${mkPage - 1})" ${mkPage === 1 ? 'disabled' : ''}>◀</button>`;
  html += `<span class="pag-info">Page ${mkPage}/${totalPages} · ${mkPageData.length} stocks</span>`;
  const s = Math.max(1, mkPage - 2), e = Math.min(totalPages, s + 4);
  for (let i = s; i <= e; i++) html += `<button class="pag-btn ${i === mkPage ? 'active' : ''}" onclick="mkGoPage(${i})">${i}</button>`;
  html += `<button class="pag-btn" onclick="mkGoPage(${mkPage + 1})" ${mkPage === totalPages ? 'disabled' : ''}>▶</button>`;
  document.getElementById('mk-pagination').innerHTML = html;
}

function mkGoPage(p) {
  const max = Math.ceil(mkPageData.length / MK_PER_PAGE);
  if (p < 1 || p > max) return;
  mkPage = p;
  renderMkPage();
}

function showDashTrend(sym) {
  const s = STOCKS.find(x => x.sym === sym);
  if (!s) return;
  const symEl = document.getElementById('dash-trend-sym');
  const sigEl = document.getElementById('dash-trend-signal');
  const statsEl = document.getElementById('dash-trend-stats');
  const chartEl = document.getElementById('dash-trend-chart');
  if (symEl) symEl.textContent = `${sym} — 30 Day Trend`;
  if (sigEl) {
    sigEl.style.display = 'inline-block';
    const isUp = s.chg > 1;
    sigEl.textContent = isUp ? 'UPTREND' : s.chg < -0.5 ? 'WATCH' : 'STABLE';
    sigEl.className = `b ${isUp ? 'bg' : s.chg < -0.5 ? 'ba' : 'bb'}`;
  }
  // Build 30-day sparkline
  const pts = genHistory(s.price, s.chg, 30);
  const minP = Math.min(...pts), maxP = Math.max(...pts), rng = maxP - minP || 1;
  const W = 580, H = 160, pL = 44, pR = 16, pT = 14, pB = 28;
  const scX = i => pL + (i / (pts.length - 1)) * (W - pL - pR);
  const scY = v => pT + (H - pT - pB) * (1 - (v - minP) / rng);
  const isUp = pts[pts.length - 1] >= pts[0];
  const col = isUp ? '#38bdf8' : '#f87171';
  let lnPts = `M${scX(0).toFixed(1)},${scY(pts[0]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    lnPts += ` C${scX(i - 0.6).toFixed(1)},${scY(pts[i - 1]).toFixed(1)} ${scX(i - 0.4).toFixed(1)},${scY(pts[i]).toFixed(1)} ${scX(i).toFixed(1)},${scY(pts[i]).toFixed(1)}`;
  }
  let areaPts = `M${scX(0).toFixed(1)},${H - pB} ` + pts.map((v, i) => `L${scX(i).toFixed(1)},${scY(v).toFixed(1)}`).join(' ') + ` L${scX(pts.length - 1).toFixed(1)},${H - pB} Z`;
  // X-axis labels
  let xlabels = '';
  [0, 6, 13, 20, 27, 29].forEach(i => {
    const d = new Date(); d.setDate(d.getDate() - (pts.length - 1 - i));
    const lbl = i === 0 ? 'D1' : `D${i + 1}`;
    xlabels += `<text x="${scX(i).toFixed(1)}" y="${H + 4}" font-size="8" fill="#475569" text-anchor="middle" font-family="Inter">${lbl}</text>`;
  });
  // Y-axis labels
  let ylabels = '';
  [0, 1, 2, 3, 4].forEach(t => {
    const val = minP + rng * t / 4, y = scY(val);
    ylabels += `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${W - pR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,5" stroke-width="1"/>`;
    ylabels += `<text x="${pL - 4}" y="${(y + 3.5).toFixed(1)}" font-size="8" fill="#475569" text-anchor="end" font-family="Inter">₹${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)}</text>`;
  });
  // Prediction dashed extension
  const pp = parseFloat(predP(s));
  const predX = W - pR + 28;
  const predY = scY(Math.min(Math.max(pp, minP * 0.99), maxP * 1.01));
  const lastX = scX(pts.length - 1), lastY = scY(pts[pts.length - 1]);
  const predLine = `<line x1="${lastX.toFixed(1)}" y1="${lastY.toFixed(1)}" x2="${predX}" y2="${predY.toFixed(1)}" stroke="${col}" stroke-width="1.8" stroke-dasharray="5,3" opacity="0.6"/>`;
  const predDot = `<circle cx="${predX}" cy="${predY.toFixed(1)}" r="4" fill="${col}" opacity="0.7"/>
    <text x="${predX + 4}" y="${(predY - 5).toFixed(1)}" font-size="9" fill="${col}" font-family="Inter" font-weight="600">Pr</text>`;
  chartEl.innerHTML = `<svg viewBox="0 0 ${W + 40} ${H + 18}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">
    <defs><linearGradient id="dtg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.22"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${ylabels}
    <path d="${areaPts}" fill="url(#dtg)"/>
    <path d="${lnPts}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="5" fill="${col}" stroke="#060d1f" stroke-width="2"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="10" fill="${col}" opacity="0.12"/>
    ${predLine}${predDot}
    ${xlabels}
  </svg>`;
  if (statsEl) {
    statsEl.style.display = 'block';
    document.getElementById('dash-ts-cur').textContent = '₹' + s.price.toLocaleString();
    document.getElementById('dash-ts-hi').textContent = '₹' + maxP.toFixed(0);
    document.getElementById('dash-ts-pred').textContent = '₹' + pp.toFixed(2);
  }
}

// ═══ STOCK TABLE ═══
function buildStocks(data) {
  stockPageData = data || STOCKS;
  stockPage = 1;
  document.getElementById('sc-count').textContent = `${stockPageData.length} stocks`;
  renderStockPage();
}

function renderStockPage() {
  const start = (stockPage - 1) * STOCKS_PER_PAGE;
  const pageData = stockPageData.slice(start, start + STOCKS_PER_PAGE);
  document.getElementById('s-tbl').innerHTML = pageData.map(s => {
    let fCls = '';
    if (s._updated) fCls = s.chg > 0 ? ' class="price-flash-up"' : ' class="price-flash-down"';
    return `
    <tr${fCls}><td class="sym">${s.sym}</td>
    <td style="color:var(--muted2)">${s.name}</td>
    <td><span class="b bb">${s.exc}</span></td>
    <td style="color:var(--muted2)">${s.sec}</td>
    <td>₹${s.price.toLocaleString()}</td>
    <td class="${s.chg > 0 ? 'up' : 'dn'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</td>
    <td><span class="b ${sigCls(s)}">${sig(s)}</span></td>
    <td style="display:flex;gap:4px">
      <button class="ab ab-v" onclick="openDetail('${s.sym}')">Detail</button>
      <button class="ab" style="background:rgba(251,191,36,.12);color:var(--amber)" onclick="quickAddWL('${s.sym}')" title="Add to Watchlist">★</button>
    </td></tr>`;
  }).join('');
  buildPagination();
}

function buildPagination() {
  const total = stockPageData.length;
  const totalPages = Math.ceil(total / STOCKS_PER_PAGE);
  if (totalPages <= 1) { document.getElementById('s-pagination').innerHTML = ''; return; }
  let html = `<button class="pag-btn" onclick="goPage(${stockPage - 1})" ${stockPage === 1 ? 'disabled' : ''}>◀</button>`;
  html += `<span class="pag-info">Page ${stockPage}/${totalPages}</span>`;
  const s = Math.max(1, stockPage - 2), e = Math.min(totalPages, s + 4);
  for (let i = s; i <= e; i++) html += `<button class="pag-btn ${i === stockPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  html += `<button class="pag-btn" onclick="goPage(${stockPage + 1})" ${stockPage === totalPages ? 'disabled' : ''}>▶</button>`;
  document.getElementById('s-pagination').innerHTML = html;
}

function goPage(p) {
  const max = Math.ceil(stockPageData.length / STOCKS_PER_PAGE);
  if (p < 1 || p > max) return;
  stockPage = p;
  renderStockPage();
}

function filterS() {
  const q = document.getElementById('sq').value.toLowerCase();
  const ex = document.getElementById('sex').value;
  const sc = document.getElementById('ssec').value;
  const sg = document.getElementById('ssig').value;
  buildStocks(STOCKS.filter(s =>
    (!q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) &&
    (!ex || s.exc === ex) && (!sc || s.sec === sc) && (!sg || sig(s) === sg)));
}

function applyQF(type, btn) {
  document.querySelectorAll('.qf-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  let filtered = STOCKS;
  if (type === 'gainers') filtered = [...STOCKS].sort((a, b) => b.chg - a.chg).slice(0, 20);
  else if (type === 'losers') filtered = [...STOCKS].sort((a, b) => a.chg - b.chg).slice(0, 20);
  else if (type === 'uptrend') filtered = STOCKS.filter(s => sig(s) === 'UPTREND');
  else if (type === 'watch') filtered = STOCKS.filter(s => sig(s) === 'WATCH');
  else if (type === 'nse') filtered = STOCKS.filter(s => s.exc === 'NSE');
  else if (type === 'bse') filtered = STOCKS.filter(s => s.exc === 'BSE');
  else if (type === 'tech') filtered = STOCKS.filter(s => s.sec === 'Technology');
  else if (type === 'fin') filtered = STOCKS.filter(s => s.sec === 'Finance');
  else if (type === 'health') filtered = STOCKS.filter(s => s.sec === 'Healthcare');
  buildStocks(filtered);
}

// ═══ STOCK DETAIL ═══
function openDetail(sym) {
  const s = STOCKS.find(x => x.sym === sym);
  if (!s) return;
  currentDetailStock = s;
  document.getElementById('d-sym').textContent = s.sym;
  document.getElementById('d-name').textContent = s.name;
  document.getElementById('d-exc').textContent = s.exc;
  document.getElementById('d-sec').textContent = s.sec;
  document.getElementById('d-price').textContent = '₹' + s.price.toLocaleString();
  document.getElementById('d-chg').innerHTML = `<span class="${s.chg > 0 ? 'up' : 'dn'}">${s.chg > 0 ? '▲' : '▼'} ${Math.abs(s.chg)}% today</span>`;
  document.getElementById('d-hi').textContent = '₹' + s.hi.toLocaleString();
  document.getElementById('d-lo').textContent = '₹' + s.lo.toLocaleString();
  document.getElementById('d-pe').textContent = s.pe > 0 ? s.pe : 'N/A';
  document.getElementById('d-mc').textContent = s.mc;
  document.getElementById('d-pred-out').innerHTML = '';
  buildDetailChart(s, '1M');
  document.querySelectorAll('.pct-btn').forEach(b => b.classList.toggle('active', b.textContent === '1M'));
  sv('detail');
}

function setPriceRange(btn, range) {
  document.querySelectorAll('.pct-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (currentDetailStock) buildDetailChart(currentDetailStock, range);
}

function genHistory(basePrice, chg, points) {
  const prices = [];
  let p = basePrice * (1 - Math.abs(chg / 100) * points * 0.3 + Math.random() * 0.02);
  for (let i = 0; i < points; i++) {
    const drift = (chg > 0 ? 0.0006 : -0.0002) + (Math.random() - 0.48) * 0.01;
    p = p * (1 + drift);
    prices.push(parseFloat(p.toFixed(2)));
  }
  prices[prices.length - 1] = basePrice;
  return prices;
}

function buildDetailChart(s, range) {
  const pts = { '1M': 30, '3M': 60, '6M': 90, '1Y': 120 }[range] || 30;
  const prices = genHistory(s.price, s.chg, pts);
  const el = document.getElementById('d-chart');
  if (!el) return;
  const W = 600, H = 160, pL = 46, pR = 16, pT = 14, pB = 28;
  const mn = Math.min(...prices), mx = Math.max(...prices), rng = mx - mn || 1;
  const scX = i => pL + (i / (prices.length - 1)) * (W - pL - pR);
  const scY = v => pT + (H - pT - pB) * (1 - (v - mn) / rng);
  const isUp = prices[prices.length - 1] >= prices[0];
  const col = isUp ? '#34d399' : '#f87171';
  let area = `M${scX(0).toFixed(1)},${(H - pB).toFixed(1)}`;
  prices.forEach((v, i) => { area += ` L${scX(i).toFixed(1)},${scY(v).toFixed(1)}`; });
  area += ` L${scX(prices.length - 1).toFixed(1)},${(H - pB).toFixed(1)} Z`;
  let line = `M${scX(0).toFixed(1)},${scY(prices[0]).toFixed(1)}`;
  for (let i = 1; i < prices.length; i++) {
    line += ` C${scX(i - 0.6).toFixed(1)},${scY(prices[i - 1]).toFixed(1)} ${scX(i - 0.4).toFixed(1)},${scY(prices[i]).toFixed(1)} ${scX(i).toFixed(1)},${scY(prices[i]).toFixed(1)}`;
  }
  let ticks = '';
  [0, 1, 2, 3, 4].forEach(t => {
    const val = mn + rng * t / 4;
    const y = scY(val);
    ticks += `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${W - pR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,5" stroke-width="1"/>`;
    ticks += `<text x="${pL - 4}" y="${(y + 3.5).toFixed(1)}" font-size="9" fill="#475569" text-anchor="end" font-family="Inter">₹${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)}</text>`;
  });
  const ex = scX(prices.length - 1), ey = scY(prices[prices.length - 1]);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">
    <defs><linearGradient id="dg${isUp ? 'g' : 'r'}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.22"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${ticks}
    <path d="${area}" fill="url(#dg${isUp ? 'g' : 'r'})"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5" fill="${col}" stroke="#060d1f" stroke-width="2"/>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="10" fill="${col}" opacity="0.15"/>
  </svg>`;
}

// ═══ QUICK DETAIL PREDICTION ═══
function runDetailPred() {
  if (!currentDetailStock) return;
  const s = currentDetailStock;
  const algo = document.getElementById('d-algo').value;
  const hor = document.getElementById('d-hor').value;
  document.getElementById('d-pred-out').innerHTML = `<div class="ai-thinking"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div><span style="font-size:12px;color:var(--muted2)">Analyzing ${s.sym}…</span></div>`;
  callClaudePredict(s, algo, hor, true).then(result => {
    document.getElementById('d-pred-out').innerHTML = `<div class="pred-res"><div class="pr"><div class="pl">Predicted Price</div><div class="pv" style="color:var(--accent)">₹${result.price}</div></div><div class="pr"><div class="pl">Expected Change</div><div class="pv" style="${result.change > 0 ? 'color:var(--green)' : 'color:var(--red)'}">${result.change > 0 ? '▲' : '▼'}${Math.abs(result.change)}%</div></div><div class="pr"><div class="pl">Signal</div><div class="pv"><span class="b ${result.signal === 'UPTREND' ? 'bg' : result.signal === 'WATCH' ? 'ba' : 'bb'}">${result.signal}</span></div></div><div class="pr"><div class="pl">Confidence</div><div class="pv" style="color:var(--green)">${result.confidence}%</div></div><div style="font-size:11px;color:var(--muted2);margin-top:8px;line-height:1.6">${result.summary}</div></div>`;
    toast('Detail prediction complete ✓');
  });
}

// ═══ CLAUDE AI BACKEND ═══
async function callClaudePredict(stock, algorithm, horizon, isQuick = false) {
  const indicators = [];
  if (document.getElementById('cb-tech')?.checked) indicators.push('RSI, MACD, Bollinger Bands');
  if (document.getElementById('cb-sent')?.checked) indicators.push('Sentiment Analysis');
  if (document.getElementById('cb-vol')?.checked) indicators.push('Volume & Momentum');
  if (document.getElementById('cb-fund')?.checked) indicators.push('Fundamental Ratios');

  const prompt = `You are a stock market prediction AI. Analyze the following stock data and provide a prediction.

STOCK DATA:
- Symbol: ${stock.sym}
- Company: ${stock.name}
- Current Price: ₹${stock.price}
- Today's Change: ${stock.chg}%
- Exchange: ${stock.exc}
- Sector: ${stock.sec}
- P/E Ratio: ${stock.pe}
- 52W High: ₹${stock.hi}
- 52W Low: ₹${stock.lo}
- Market Cap: ${stock.mc}
- Current Signal: ${sig(stock)}

PREDICTION PARAMETERS:
- Algorithm: ${algorithm}
- Horizon: ${horizon}
- Indicators Used: ${indicators.join(', ') || 'Default'}
- Risk Tolerance: ${document.getElementById('prisk')?.value || 'medium'}

Provide a JSON prediction response with EXACTLY this structure (no markdown, no extra text, just valid JSON):
{
  "predicted_price": <number>,
  "confidence": <number 60-95>,
  "signal": "<UPTREND|STABLE|WATCH>",
  "change_percent": <number>,
  "support_level": <number>,
  "resistance_level": <number>,
  "rsi": <number 30-70>,
  "summary": "<2-3 sentence analysis>",
  "risk_factors": "<1 sentence>",
  "recommendation": "<BUY|HOLD|SELL>"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = data.content?.map(c => c.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      price: parsed.predicted_price?.toFixed(2) || predP(stock),
      confidence: parsed.confidence || parseFloat(confV()),
      signal: parsed.signal || sig(stock),
      change: parsed.change_percent || parseFloat((((parsed.predicted_price - stock.price) / stock.price) * 100).toFixed(2)),
      summary: parsed.summary || 'Prediction generated by Claude AI.',
      support: parsed.support_level,
      resistance: parsed.resistance_level,
      rsi: parsed.rsi,
      recommendation: parsed.recommendation || 'HOLD',
      riskFactors: parsed.risk_factors || ''
    };
  } catch (e) {
    // Fallback if API fails
    const pp = parseFloat(predP(stock));
    const chg = parseFloat((((pp - stock.price) / stock.price) * 100).toFixed(2));
    return {
      price: pp.toFixed(2),
      confidence: parseFloat(confV()),
      signal: sig(stock),
      change: chg,
      summary: `${stock.sym} shows ${sig(stock) === 'UPTREND' ? 'positive' : sig(stock) === 'WATCH' ? 'cautious' : 'stable'} momentum. Based on ${algorithm} analysis with ${horizon} horizon, the stock is expected to ${chg > 0 ? 'rise' : 'decline'} by ${Math.abs(chg).toFixed(2)}%. Confidence based on technical indicators.`,
      support: (stock.price * 0.95).toFixed(2),
      resistance: (stock.price * 1.07).toFixed(2),
      rsi: (40 + Math.random() * 30).toFixed(1),
      recommendation: chg > 2 ? 'BUY' : chg < -2 ? 'SELL' : 'HOLD',
      riskFactors: 'Market volatility and sector headwinds are key risks.'
    };
  }
}

// ═══ RISK TOLERANCE BUTTONS ═══
let currentRisk = 'low';
function setRisk(level) {
  currentRisk = level;
  document.getElementById('prisk').value = level;
  const colors = { low: ['var(--green)', 'rgba(52,211,153,0.15)', '2px solid var(--green)'], medium: ['var(--amber)', 'rgba(251,191,36,0.15)', '2px solid var(--amber)'], high: ['var(--red)', 'rgba(248,113,113,0.15)', '2px solid var(--red)'] };
  const ids = { low: 'risk-low', medium: 'risk-med', high: 'risk-high' };
  const icons = { low: '🟢 Low', medium: '🟡 Medium', high: '🔴 High' };
  Object.keys(ids).forEach(k => {
    const btn = document.getElementById(ids[k]);
    if (!btn) return;
    if (k === level) {
      const [color, bg, border] = colors[k];
      btn.style.color = color; btn.style.background = bg; btn.style.border = border;
    } else {
      btn.style.color = 'var(--muted2)'; btn.style.background = 'transparent'; btn.style.border = `1px solid ${colors[k][0].replace('var', 'rgba').replace(')', ',0.3)')}`;
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  ENHANCED STOCK PICKER — shared across all modules
// ═══════════════════════════════════════════════════════════

// Per-picker active filters (keyed by dropdown id)
const spState = {};

function spGetState(ddId) {
  if (!spState[ddId]) spState[ddId] = { sec: '', exc: '' };
  return spState[ddId];
}

// Generic filtered search — renders into any dropdown id
function spRender(inputId, ddId, onSelect) {
  const dd = document.getElementById(ddId);
  if (!dd) return;
  const q = (document.getElementById(inputId)?.value || '').trim().toLowerCase();
  const st = spGetState(ddId);
  let pool = STOCKS.filter(s =>
    (!q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) &&
    (!st.sec || s.sec === st.sec) &&
    (!st.exc || s.exc === st.exc)
  ).slice(0, 14);
  dd.innerHTML = pool.length === 0
    ? `<div class="sp-dd-empty">No stocks found for this filter</div>`
    : pool.map(s => `<div class="sp-dd-item" onmousedown="${onSelect}('${s.sym}')">
        <div>
          <div class="sp-dd-sym">${s.sym}</div>
          <div class="sp-dd-meta">${s.name} · <span style="color:var(--accent2)">${s.exc}</span> · ${s.sec}</div>
        </div>
        <div class="sp-dd-right">
          <div class="sp-dd-price">₹${s.price.toLocaleString()}</div>
          <div class="sp-dd-chg" style="color:${s.chg > 0 ? 'var(--green)' : 'var(--red)'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</div>
        </div>
      </div>`).join('');
  dd.classList.add('open');
}

// Set sector filter for a picker
function spSetSec(inputId, ddId, tagEl, sec) {
  // Toggle tags in same filter group
  const parent = tagEl.closest('.sp-filters');
  if (parent) parent.querySelectorAll('.sp-tag:not(.exc)').forEach(t => t.classList.remove('on'));
  tagEl.classList.add('on');
  spGetState(ddId).sec = sec;
  spRender(inputId, ddId, spOnSelectMap[ddId] || 'symSelect');
  if (sec) { document.getElementById(inputId).value = ''; spRender(inputId, ddId, spOnSelectMap[ddId] || 'symSelect'); }
  document.getElementById(ddId).classList.add('open');
}

// Set exchange filter for a picker
function spSetExc(inputId, ddId, tagEl, exc) {
  const parent = tagEl.closest('.sp-filters');
  const st = spGetState(ddId);
  // Toggle exchange
  if (st.exc === exc) {
    st.exc = '';
    tagEl.classList.remove('on');
  } else {
    if (parent) parent.querySelectorAll('.sp-tag.exc').forEach(t => t.classList.remove('on'));
    st.exc = exc;
    tagEl.classList.add('on');
  }
  spRender(inputId, ddId, spOnSelectMap[ddId] || 'symSelect');
  document.getElementById(ddId).classList.add('open');
}

// Maps dropdown id → select callback name
const spOnSelectMap = {
  'sym-dd': 'symSelect',
  'wl-sym-dd': 'wlSelectStock',
  'al-sym-dd': 'alSelectStock',
  'rep-sym-dd': 'repSelectStock'
};

// ═══ PREDICTION ENGINE ═══
let symFiltered = [], symHighlight = -1, predNavIdx = 0;

function symSearch(query) { spRender('ps', 'sym-dd', 'symSelect'); }

function spFilter(inputId, ddId) { spRender(inputId, ddId, spOnSelectMap[ddId] || 'symSelect'); }

function symKeyNav(e) {
  const dd = document.getElementById('sym-dd');
  const items = dd.querySelectorAll('.sp-dd-item');
  if (e.key === 'ArrowDown') { e.preventDefault(); symHighlight = Math.min(symHighlight + 1, items.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); symHighlight = Math.max(symHighlight - 1, 0); }
  else if (e.key === 'Enter' && symHighlight >= 0) { e.preventDefault(); items[symHighlight]?.dispatchEvent(new MouseEvent('mousedown')); return; }
  else if (e.key === 'Escape') { dd.classList.remove('open'); return; }
  else return;
  items.forEach((it, i) => it.classList.toggle('hi', i === symHighlight));
  if (items[symHighlight]) items[symHighlight].scrollIntoView({ block: 'nearest' });
}

function symSelect(sym) {
  document.getElementById('ps').value = sym;
  document.getElementById('sym-dd').classList.remove('open');
  predNavIdx = STOCKS.findIndex(x => x.sym === sym);
  const s = STOCKS.find(x => x.sym === sym);
  if (s) {
    const chip = document.getElementById('ps-info');
    if (chip) {
      chip.style.display = 'block';
      chip.innerHTML = `<div class="sp-chip-inner"><div><strong style="color:var(--txt)">${s.name}</strong> &nbsp;<span style="color:var(--muted2)">${s.exc}</span> · <span style="color:var(--accent2)">${s.sec}</span></div><div><span style="color:var(--accent);font-family:Syne,sans-serif;font-weight:700">₹${s.price.toLocaleString()}</span> &nbsp;<span style="${s.chg > 0 ? 'color:var(--green)' : 'color:var(--red)'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</span></div></div>`;
    }
  }
}

function predNavStock(dir) {
  const max = STOCKS.length;
  predNavIdx = ((predNavIdx + dir) + max) % max;
  symSelect(STOCKS[predNavIdx].sym);
}

// ─── Watchlist picker ───
function symSearchWL(q) { spRender('wl-sym', 'wl-sym-dd', 'wlSelectStock'); }
function wlSelectStock(sym) {
  document.getElementById('wl-sym').value = sym;
  document.getElementById('wl-sym-dd').classList.remove('open');
}

// ─── Alerts picker ───
function symSearchAL(q) { spRender('al-sym', 'al-sym-dd', 'alSelectStock'); }
function alSelectStock(sym) {
  document.getElementById('al-sym').value = sym;
  document.getElementById('al-sym-dd').classList.remove('open');
}

async function runPred() {
  const sym = (document.getElementById('ps').value || 'RELIANCE').toUpperCase().trim();
  const s = STOCKS.find(x => x.sym === sym) || { sym, name: sym, price: 1500, chg: 0.5, sec: '—', exc: 'NSE', pe: 20, hi: 1700, lo: 1200, mc: '—' };
  const algo = document.getElementById('pa').value;
  const hor = document.getElementById('ph').value;

  document.getElementById('pred-out').innerHTML = `<div class="ai-thinking"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div><span style="font-size:12px;color:var(--muted2)">Analyzing ${sym} with ${algo}…</span></div><div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px">Running AI Engine · Saving to SQL Database</div>`;

  log(`Prediction requested: ${sym} via ${algo} (${hor})`);

  const result = await callClaudePredict(s, algo, hor);

  // SAVE TO SQL DATABASE
  const predRecord = DB.insert('predictions', {
    symbol: sym,
    company: s.name,
    current_price: s.price,
    predicted_price: result.price,
    change_percent: result.change,
    confidence: result.confidence,
    signal: result.signal,
    algorithm: algo,
    horizon: hor,
    recommendation: result.recommendation,
    summary: result.summary,
    user_id: cUserId,
    user_name: cUser
  });

  log(`Prediction saved to DB (ID: ${predRecord.id}) for ${sym}`);
  document.getElementById('dash-preds').textContent = DB.tables.predictions.length;
  updateDbStatus();
  buildPredHist();

  const isUp = parseFloat(result.change) > 0;
  const confColor = result.confidence >= 80 ? 'var(--green)' : result.confidence >= 65 ? 'var(--amber)' : 'var(--red)';

  document.getElementById('pred-out').innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(56,189,248,0.06),rgba(52,211,153,0.03));border:1px solid rgba(56,189,248,0.2);border-radius:14px;padding:16px;animation:fadeInUp .4s ease" class="fade-in">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div>
          <div style="font-family:Syne,sans-serif;font-size:1.3rem;font-weight:800">${sym} <span style="font-size:11px;color:var(--muted);font-family:Inter,sans-serif;font-weight:400">${s.name}</span></div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${algo} · ${hor} · DB Record #${predRecord.id}</div>
        </div>
        <div style="text-align:right">
          <span class="b ${result.signal === 'UPTREND' ? 'bg' : result.signal === 'WATCH' ? 'ba' : 'bb'}" style="font-size:11px">${result.signal}</span>
          <div style="font-size:10px;color:var(--muted);margin-top:4px">Rec: <strong style="color:${result.recommendation === 'BUY' ? 'var(--green)' : result.recommendation === 'SELL' ? 'var(--red)' : 'var(--amber)'}">${result.recommendation}</strong></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;border:1px solid rgba(255,255,255,0.06)">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px">Current Price</div>
          <div style="font-family:Syne,sans-serif;font-size:1.2rem;font-weight:800">₹${s.price.toFixed(2)}</div>
        </div>
        <div style="background:rgba(56,189,248,0.06);border-radius:10px;padding:12px;border:1px solid rgba(56,189,248,0.2)">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px">Predicted (${hor})</div>
          <div style="font-family:Syne,sans-serif;font-size:1.2rem;font-weight:800;color:var(--accent)">₹${result.price}</div>
        </div>
        <div style="background:${isUp ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)'};border-radius:10px;padding:12px;border:1px solid ${isUp ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px">Expected Change</div>
          <div style="font-family:Syne,sans-serif;font-size:1.2rem;font-weight:800;color:${isUp ? 'var(--green)' : 'var(--red)'}">${isUp ? '▲' : '▼'} ${Math.abs(result.change).toFixed(2)}%</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;border:1px solid rgba(255,255,255,0.06)">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px">Confidence</div>
          <div style="font-family:Syne,sans-serif;font-size:1.2rem;font-weight:800;color:${confColor}">${parseFloat(result.confidence).toFixed(1)}%</div>
          <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:4px;margin-top:6px;overflow:hidden"><div id="conf-bar" style="height:4px;width:0%;background:${confColor};border-radius:4px;transition:width 1.2s ease"></div></div>
        </div>
      </div>
      ${result.support ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;font-size:11px">
        <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px;border:1px solid rgba(255,255,255,0.06);text-align:center"><div style="color:var(--muted);margin-bottom:2px">Support</div><div style="font-weight:700;color:var(--green)">₹${result.support}</div></div>
        <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px;border:1px solid rgba(255,255,255,0.06);text-align:center"><div style="color:var(--muted);margin-bottom:2px">Resistance</div><div style="font-weight:700;color:var(--red)">₹${result.resistance}</div></div>
        <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px;border:1px solid rgba(255,255,255,0.06);text-align:center"><div style="color:var(--muted);margin-bottom:2px">RSI</div><div style="font-weight:700;color:var(--amber)">${result.rsi}</div></div>
      </div>` : ''}
      <div style="background:rgba(56,189,248,0.04);border:1px solid rgba(56,189,248,0.12);border-radius:10px;padding:12px;font-size:12px;line-height:1.7;color:var(--muted2)">
        <div style="font-size:10px;font-weight:700;color:var(--accent);margin-bottom:4px">📊 AI ANALYSIS</div>
        ${result.summary}
        ${result.riskFactors ? `<div style="margin-top:6px;color:var(--amber);font-size:11px">⚠ ${result.riskFactors}</div>` : ''}
      </div>
      <div style="font-size:10px;color:var(--muted);text-align:center;margin-top:8px">✓ Saved to SQL Database · Record ID: ${predRecord.id} · By: ${cUser}</div>
    </div>`;

  setTimeout(() => {
    const bar = document.getElementById('conf-bar');
    if (bar) bar.style.width = result.confidence + '%';
  }, 100);

  // Show prediction charts
  const chartsSection = document.getElementById('pred-charts-section');
  if (chartsSection) {
    chartsSection.style.display = 'grid';
    buildPredBarChart(sym, s.price, parseFloat(result.price));
    const predList = [...DB.tables.predictions].reverse().slice(0, 12);
    buildPredPieChart(predList);
    buildPredLineChart(predList);
    buildPredCandleChart(s);
  }

  toast('AI Prediction complete — saved to database ✓');
}

// ═══ PREDICTION HISTORY ═══
function buildPredHist() {
  const preds = [...DB.tables.predictions].reverse();
  const userPreds = cRole === 'admin' ? preds : preds.filter(p => p.user_id === cUserId);
  document.getElementById('ph-tbl').innerHTML = userPreds.length === 0
    ? `<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:20px">No predictions yet. Run one above!</td></tr>`
    : userPreds.slice(0, 20).map(p => `
      <tr>
        <td class="sym">${p.symbol}</td>
        <td style="color:var(--accent)">₹${p.predicted_price}</td>
        <td>₹${p.current_price}</td>
        <td><span class="b ${p.signal === 'UPTREND' ? 'bg' : p.signal === 'WATCH' ? 'ba' : 'bb'}">${p.signal}</span></td>
        <td style="color:var(--green)">${parseFloat(p.confidence).toFixed(1)}%</td>
        <td style="color:var(--muted2);font-size:11px">${p.algorithm}</td>
        <td style="font-size:11px;color:var(--muted2)">${new Date(p.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        <td style="font-size:11px;color:var(--muted2)">${p.user_name}</td>
      </tr>`).join('');
}

// ═══ WATCHLIST ═══
function buildWL() {
  const items = DB.findAll('watchlist', { user_id: cUserId });
  document.getElementById('wl-items').innerHTML = items.length === 0
    ? '<div style="text-align:center;padding:2rem;color:var(--muted)">No stocks in watchlist yet.</div>'
    : items.map(item => {
      const s = STOCKS.find(x => x.sym === item.symbol) || {};
      return `<div class="wli">
        <div>
          <div style="font-family:Syne,sans-serif;font-weight:700;color:var(--accent)">${item.symbol}</div>
          <div style="font-size:11px;color:var(--muted2)">${item.watchlist_name} ${item.notes ? '· ' + item.notes : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${s.price ? `<div style="text-align:right"><div style="font-weight:600">₹${s.price?.toLocaleString()}</div><div style="font-size:11px;color:${s.chg > 0 ? 'var(--green)' : 'var(--red)'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</div></div>` : ''}
          <button class="ab ab-d" onclick="deleteWL(${item.id})">✕</button>
        </div>
      </div>`;
    }).join('');
  document.getElementById('dash-wl').textContent = items.length;
}

function addToWatchlist() {
  if (!currentDetailStock) return;
  const name = document.getElementById('d-wl-sel').value;
  const notes = document.getElementById('d-wl-notes').value;
  DB.insert('watchlist', { user_id: cUserId, symbol: currentDetailStock.sym, watchlist_name: name, notes });
  toast(`${currentDetailStock.sym} added to ${name} ✓`);
  log(`Added ${currentDetailStock.sym} to watchlist`);
  buildWL();
  updateDbStatus();
}

function saveWatchlist() {
  const sym = document.getElementById('wl-sym').value.trim().toUpperCase();
  if (!sym) { toast('Enter a stock symbol', 'err'); return; }
  const name = document.getElementById('wl-name-sel').value;
  const notes = document.getElementById('wl-notes').value;
  DB.insert('watchlist', { user_id: cUserId, symbol: sym, watchlist_name: name, notes });
  toast(`${sym} saved to ${name} ✓`);
  log(`Watchlist: added ${sym}`);
  buildWL();
  updateDbStatus();
  document.getElementById('wl-sym').value = '';
  document.getElementById('wl-notes').value = '';
}

function quickAddWL(sym) {
  const existing = DB.findAll('watchlist', { user_id: cUserId }).find(w => w.symbol === sym);
  if (existing) { toast(`${sym} already in watchlist`); return; }
  DB.insert('watchlist', { user_id: cUserId, symbol: sym, watchlist_name: 'My Portfolio', notes: '' });
  toast(`★ ${sym} added to watchlist ✓`);
  log(`Watchlist: added ${sym} from dashboard`);
  buildWL();
  updateDbStatus();
}

function deleteWL(id) {
  DB.delete('watchlist', id);
  toast('Removed from watchlist');
  buildWL();
  updateDbStatus();
}

// ═══ ALERTS ═══
function buildAlerts() {
  const items = DB.findAll('alerts', { user_id: cUserId });
  document.getElementById('alert-items').innerHTML = items.length === 0
    ? '<div style="text-align:center;padding:2rem;color:var(--muted)">No alerts configured.<br><span style="font-size:11px">Use the form to set a price or signal alert.</span></div>'
    : items.map(item => {
      const s = STOCKS.find(x => x.sym === item.symbol);
      const triggered = s && ((item.type === 'above' && s.price >= item.target) || (item.type === 'below' && s.price <= item.target));
      const alertTypeLabel = item.alert_type === 'signal' ? 'Signal Alert' : item.alert_type === 'confidence' ? 'Confidence Alert' : 'Price Alert';
      const dirLabel = item.type === 'above' ? 'Above' : item.type === 'below' ? 'Below' : '% Change';
      return `<div class="ali" style="flex-direction:column;align-items:stretch;gap:6px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;border-radius:var(--r);background:rgba(56,189,248,0.1);display:flex;align-items:center;justify-content:center;font-size:16px">🔔</div>
            <div>
              <div style="font-family:Syne,sans-serif;font-weight:700">${item.symbol} <span style="font-size:11px;color:var(--muted2);font-family:Inter,sans-serif;font-weight:400">— ${alertTypeLabel}</span></div>
              <div style="font-size:11px;color:var(--muted2)">Price ${dirLabel} ₹${item.target}${item.confidence_threshold ? ' · Conf ≥ ' + item.confidence_threshold + '%' : ''}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="b ${triggered ? 'bg' : 'ba'}">${triggered ? '🔔 TRIGGERED' : '⏳ Pending'}</span>
            <button class="ab ab-d" onclick="deleteAlert(${item.id})">✕</button>
          </div>
        </div>
        ${s ? `<div style="font-size:11px;color:var(--muted);padding-left:46px">Current: ₹${s.price.toLocaleString()} <span class="${s.chg > 0 ? 'up' : 'dn'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</span> · Channel: ${item.channel || 'In-App'}</div>` : ''}
      </div>`;
    }).join('');
}

function createAlert() {
  const sym = document.getElementById('al-sym').value.trim().toUpperCase();
  const alertType = document.getElementById('al-alert-type') ? document.getElementById('al-alert-type').value : 'price';
  const type = document.getElementById('al-type').value;
  const val = parseFloat(document.getElementById('al-val').value);
  const confThresh = document.getElementById('al-conf') ? document.getElementById('al-conf').value : '';
  const channel = document.getElementById('al-channel') ? document.getElementById('al-channel').value : 'In-App Notification';
  if (!sym || !val) { toast('Fill symbol and price threshold', 'err'); return; }
  DB.insert('alerts', { user_id: cUserId, symbol: sym, alert_type: alertType, type, target: val, confidence_threshold: confThresh, channel });
  toast(`Alert created for ${sym} ✓`);
  log(`Alert: ${sym} ${type} ₹${val} via ${channel}`);
  buildAlerts();
  updateDbStatus();
  document.getElementById('al-sym').value = '';
  document.getElementById('al-val').value = '';
}

function deleteAlert(id) {
  DB.delete('alerts', id);
  toast('Alert deleted');
  buildAlerts();
}

// ═══ REPORTS ═══
function buildReps() {
  const reports = cRole === 'admin' ? DB.tables.reports : DB.findAll('reports', { user_id: cUserId });
  const list = [...reports].reverse().slice(0, 15);
  const html = list.length === 0 ? '<div style="text-align:center;padding:2rem;color:var(--muted)">No reports generated yet.</div>'
    : list.map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px">
        <div>
          <div style="font-weight:600;font-size:13px">${r.type}</div>
          <div style="font-size:11px;color:var(--muted2)">${r.stock !== 'ALL' ? '📌 ' + r.stock : 'All Stocks'} · By ${r.user_name}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="b bg" style="font-size:9px">#${r.id}</span>
          <button class="ab ab-v" onclick="showStockReport('${r.type}','${r.stock}',${r.id})">View</button>
          ${cRole === 'admin' ? `<button class="ab ab-d" onclick="deleteReport(${r.id})">✕</button>` : ''}
        </div>
      </div>`).join('');
  const el = document.getElementById('report-list');
  const el2 = document.getElementById('emp-rep-list');
  if (el) el.innerHTML = html;
  if (el2) el2.innerHTML = html;
}

let currentReportMeta = {};

function generateReport() {
  const type = document.getElementById('rep-type').value;
  const symRaw = document.getElementById('rep-sym').value.trim().toUpperCase();
  const stock = symRaw || 'ALL';
  const fmt = document.getElementById('rep-fmt').value;
  const from = document.getElementById('rep-from').value;
  const to = document.getElementById('rep-to').value;

  const r = DB.insert('reports', { type, stock, range: fmt, user_id: cUserId, user_name: cUser, status: 'Generated' });
  toast(`Report "${type}" saved to database ✓`);
  log(`Report generated: ${type} for ${stock}`);
  buildReps();
  updateDbStatus();

  if (fmt === 'csv') { downloadReportAs('csv', stock, type); return; }
  if (fmt === 'pdf') { showStockReport(type, stock, r.id); setTimeout(() => downloadReportAs('pdf'), 600); return; }
  showStockReport(type, stock, r.id);
}

function showStockReport(type, stock, reportId) {
  // Determine which stocks to show — ONLY the specific stock if given
  const isSpecific = stock && stock !== 'ALL' && STOCKS.find(s => s.sym === stock);
  const displayed = isSpecific
    ? STOCKS.filter(s => s.sym === stock)
    : STOCKS.slice(0, 25);

  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  document.getElementById('rm-title').textContent = `📊 ${type}`;
  document.getElementById('rm-meta').textContent = `Report #${reportId} · ${isSpecific ? stock : 'All Stocks'} · By ${cUser} · ${dateStr} ${timeStr}`;

  currentReportMeta = { type, stock, dateStr, reportId };

  const avgConf = (70 + Math.random() * 15).toFixed(1);
  const upCount = displayed.filter(s => sig(s) === 'UPTREND').length;
  const avgPE = (displayed.filter(s => s.pe > 0).reduce((a, s) => a + s.pe, 0) / Math.max(1, displayed.filter(s => s.pe > 0).length)).toFixed(1);

  let html = '';

  // Stock spotlight for specific stock
  if (isSpecific && displayed.length === 1) {
    const s = displayed[0];
    const pp = predP(s);
    const cv = confV();
    const sg = sig(s);
    const pct = (((parseFloat(pp) - s.price) / s.price) * 100).toFixed(2);
    html += `<div class="rep-section"><h4>🎯 Stock Spotlight — ${s.sym}</h4>
      <div class="rep-grid">
        <div class="rep-stat"><div class="rs-l">Company</div><div class="rs-v" style="font-size:.8rem;color:var(--txt)">${s.name}</div></div>
        <div class="rep-stat"><div class="rs-l">Current Price</div><div class="rs-v" style="color:var(--accent)">₹${s.price.toLocaleString()}</div></div>
        <div class="rep-stat"><div class="rs-l">Today's Change</div><div class="rs-v" style="color:${s.chg > 0 ? 'var(--green)' : 'var(--red)'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</div></div>
        <div class="rep-stat"><div class="rs-l">Predicted Price</div><div class="rs-v" style="color:var(--accent)">₹${pp}</div></div>
        <div class="rep-stat"><div class="rs-l">AI Signal</div><div class="rs-v"><span class="b ${sigCls(s)}">${sg}</span></div></div>
        <div class="rep-stat"><div class="rs-l">Confidence</div><div class="rs-v" style="color:var(--green)">${cv}%</div></div>
        <div class="rep-stat"><div class="rs-l">52W High</div><div class="rs-v" style="color:var(--green)">₹${s.hi.toLocaleString()}</div></div>
        <div class="rep-stat"><div class="rs-l">52W Low</div><div class="rs-v" style="color:var(--red)">₹${s.lo.toLocaleString()}</div></div>
        <div class="rep-stat"><div class="rs-l">P/E Ratio</div><div class="rs-v" style="color:var(--amber)">${s.pe > 0 ? s.pe : '—'}</div></div>
      </div></div>`;

    // 30-Day Price Chart
    const pts = genHistory(s.price, s.chg, 30);
    const minP = Math.min(...pts), maxP = Math.max(...pts), rng = maxP - minP || 1;
    const W = 700, H = 110, padL = 44, padR = 12, padT = 12, padB = 24;
    const scX = i => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const scY = v => padT + (H - padT - padB) * (1 - (v - minP) / rng);
    const isUp = pts[pts.length - 1] >= pts[0];
    const lc = isUp ? '#34d399' : '#f87171';
    let lnPts = `M${scX(0).toFixed(1)},${scY(pts[0]).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) lnPts += ` L${scX(i).toFixed(1)},${scY(pts[i]).toFixed(1)}`;
    let areaPts = `M${scX(0).toFixed(1)},${H - padB} ` + pts.map((v, i) => `L${scX(i).toFixed(1)},${scY(v).toFixed(1)}`).join(' ') + ` L${scX(pts.length - 1).toFixed(1)},${H - padB} Z`;
    html += `<div class="rep-section"><h4>📉 30-Day Price History — ${s.sym}</h4>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;background:rgba(56,189,248,0.03);border-radius:8px;border:1px solid rgba(56,189,248,0.1)">
        <defs><linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${lc}" stop-opacity="0.28"/><stop offset="100%" stop-color="${lc}" stop-opacity="0.02"/></linearGradient></defs>
        <path d="${areaPts}" fill="url(#repGrad)"/>
        <path d="${lnPts}" fill="none" stroke="${lc}" stroke-width="2" stroke-linecap="round"/>
        <circle cx="${scX(pts.length - 1).toFixed(1)}" cy="${scY(pts[pts.length - 1]).toFixed(1)}" r="4" fill="${lc}" stroke="#0a1422" stroke-width="2"/>
        <text x="${padL - 4}" y="${(scY(maxP) + 3.5).toFixed(1)}" font-size="8" fill="#64748b" text-anchor="end">₹${maxP.toFixed(0)}</text>
        <text x="${padL - 4}" y="${(scY(minP) + 3.5).toFixed(1)}" font-size="8" fill="#64748b" text-anchor="end">₹${minP.toFixed(0)}</text>
      </svg></div>`;
  }

  html += `<div class="rep-section"><h4>📊 Executive Summary</h4>
    <div class="rep-grid">
      <div class="rep-stat"><div class="rs-l">Stocks Analyzed</div><div class="rs-v" style="color:var(--accent)">${displayed.length}</div></div>
      <div class="rep-stat"><div class="rs-l">Avg Confidence</div><div class="rs-v" style="color:var(--green)">${avgConf}%</div></div>
      <div class="rep-stat"><div class="rs-l">Uptrend Signals</div><div class="rs-v" style="color:var(--green)">${upCount}/${displayed.length}</div></div>
      <div class="rep-stat"><div class="rs-l">Report Type</div><div class="rs-v" style="color:var(--accent2);font-size:.72rem">${type}</div></div>
      <div class="rep-stat"><div class="rs-l">Avg P/E Ratio</div><div class="rs-v" style="color:var(--amber)">${avgPE}</div></div>
      <div class="rep-stat"><div class="rs-l">Generated</div><div class="rs-v" style="color:var(--muted2);font-size:.72rem">${dateStr}</div></div>
    </div></div>`;

  html += `<div class="rep-section"><h4>📈 Stock Performance Data</h4>
    <table class="rep-table">
      <thead><tr><th>Symbol</th><th>Company</th><th>Price</th><th>Change</th><th>Signal</th><th>Pred. Price</th><th>Confidence</th><th>P/E</th></tr></thead>
      <tbody>
        ${displayed.map(s => `<tr>
          <td style="font-family:'Syne',sans-serif;font-weight:700;color:var(--accent)">${s.sym}</td>
          <td style="color:var(--muted2)">${s.name}</td>
          <td style="font-weight:600">₹${s.price.toLocaleString()}</td>
          <td class="${s.chg > 0 ? 'up' : 'dn'}">${s.chg > 0 ? '▲' : '▼'}${Math.abs(s.chg)}%</td>
          <td><span class="b ${sigCls(s)}">${sig(s)}</span></td>
          <td style="color:var(--accent)">₹${predP(s)}</td>
          <td style="color:var(--green)">${confV()}%</td>
          <td style="color:var(--muted2)">${s.pe > 0 ? s.pe : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;

  if (type.toLowerCase().includes('trend') || type.toLowerCase().includes('prediction')) {
    html += `<div class="rep-section"><h4>🤖 Algorithm Analysis</h4>
      <table class="rep-table">
        <thead><tr><th>Algorithm</th><th>Predictions</th><th>Avg Confidence</th><th>Accuracy Est.</th></tr></thead>
        <tbody>
          <tr><td>LSTM Neural Network</td><td>${Math.floor(Math.random() * 50 + 120)}</td><td style="color:var(--green)">${(78 + Math.random() * 8).toFixed(1)}%</td><td style="color:var(--green)">${(75 + Math.random() * 6).toFixed(1)}%</td></tr>
          <tr><td>Naive Bayes</td><td>${Math.floor(Math.random() * 30 + 55)}</td><td style="color:var(--amber)">${(70 + Math.random() * 7).toFixed(1)}%</td><td style="color:var(--amber)">${(67 + Math.random() * 6).toFixed(1)}%</td></tr>
          <tr><td>Logistic Regression</td><td>${Math.floor(Math.random() * 20 + 30)}</td><td style="color:var(--amber)">${(65 + Math.random() * 7).toFixed(1)}%</td><td style="color:var(--amber)">${(62 + Math.random() * 6).toFixed(1)}%</td></tr>
          <tr><td>Random Forest</td><td>${Math.floor(Math.random() * 25 + 20)}</td><td style="color:var(--green)">${(74 + Math.random() * 7).toFixed(1)}%</td><td style="color:var(--green)">${(71 + Math.random() * 6).toFixed(1)}%</td></tr>
        </tbody>
      </table></div>`;
  }

  html += `<div class="rep-section"><h4>⚠ Disclaimer</h4>
    <div style="font-size:11px;color:var(--muted);line-height:1.7">This report is generated by StockSense AI for analytical and research purposes only. The predictions and signals presented are based on historical data and machine learning models. They do not constitute financial advice. Always consult a SEBI-registered financial advisor before making investment decisions.</div></div>`;

  document.getElementById('rm-body').innerHTML = html;
  document.getElementById('rep-modal').style.display = 'flex';
  toast('Report generated successfully ✓');
}

function viewReport(id) {
  const r = DB.findById('reports', id);
  if (!r) return;
  showStockReport(r.type, r.stock, r.id);
}

function deleteReport(id) {
  DB.delete('reports', id);
  toast('Report deleted');
  buildReps();
  buildAdminReports();
  updateDbStatus();
}

function closeRepModal() { document.getElementById('rep-modal').style.display = 'none'; }

function downloadReportAs(format, stockOverride, typeOverride) {
  const stock = stockOverride || currentReportMeta.stock || 'ALL';
  const type = typeOverride || currentReportMeta.type || 'Report';
  const dateStr = currentReportMeta.dateStr || new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    const isSpecific = stock !== 'ALL' && STOCKS.find(s => s.sym === stock);
    const displayed = isSpecific ? STOCKS.filter(s => s.sym === stock) : STOCKS.slice(0, 25);
    const rows = [['Symbol', 'Company', 'Exchange', 'Sector', 'Price', 'Change%', 'Signal', 'Predicted Price', 'Confidence%', 'P/E']];
    displayed.forEach(s => rows.push([s.sym, s.name, s.exc, s.sec, s.price, s.chg, sig(s), predP(s), confV(), s.pe]));
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `StockSense_${type.replace(/\s+/g, '_')}_${stock}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast('CSV downloaded ✓');
    return;
  }

  if (format === 'pdf') {
    const modal = document.getElementById('rep-modal');
    if (modal.style.display === 'none') return;
    const printContent = document.getElementById('rm-body').innerHTML;
    const title = document.getElementById('rm-title').textContent;
    const meta = document.getElementById('rm-meta').textContent;
    const w = window.open('', '_blank', 'width=950,height=750');
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>
      body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;padding:30px;font-size:13px}
      h4{color:#0ea5e9;font-size:13px;font-weight:700;margin:0 0 8px;text-transform:uppercase;letter-spacing:.04em}
      table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px}
      th{background:#f0f9ff;padding:7px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;border-bottom:2px solid #bae6fd}
      td{padding:7px 10px;border-bottom:1px solid #e2e8f0;color:#1e293b}
      .rep-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
      .rep-stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px}
      .rs-l{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}
      .rs-v{font-size:1.1rem;font-weight:800;margin-top:2px;color:#0f172a}
      .rep-section{margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #f1f5f9}
      .header{background:#0f172a;color:#38bdf8;padding:18px 24px;margin:-30px -30px 24px;border-radius:4px 4px 0 0}
      .header h1{font-size:18px;font-weight:800;margin:0 0 4px}
      .header p{font-size:11px;color:#94a3b8;margin:0}
      .up{color:#16a34a}.dn{color:#dc2626}
      .b{font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px}
      .bg{background:#dcfce7;color:#16a34a}.ba{background:#fef9c3;color:#ca8a04}.bb{background:#dbeafe;color:#2563eb}.bp{background:#ede9fe;color:#7c3aed}
      svg{max-width:100%}
      @media print{body{padding:10px}.header{margin:-10px -10px 16px}}
    </style></head><body>
    <div class="header"><h1>📊 ${title}</h1><p>${meta}</p></div>
    ${printContent}
    <div style="font-size:10px;color:#94a3b8;margin-top:20px;padding-top:10px;border-top:1px solid #e2e8f0;text-align:center">StockSense © ${new Date().getFullYear()} · Generated ${new Date().toLocaleString('en-IN')}</div>
    </body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); }, 400);
    return;
  }
}

function empGenerateReport() {
  const type = document.getElementById('erep-type').value;
  const stock = document.getElementById('erep-stock').value;
  const range = document.getElementById('erep-range').value;
  const notes = document.getElementById('erep-notes').value;
  const r = DB.insert('reports', { type, stock, range, notes, user_id: cUserId, user_name: cUser, status: 'Employee Report' });
  toast(`Report "${type}" saved ✓`);
  log(`Employee report: ${type} for ${stock}`);
  buildReps();
  updateDbStatus();
  showStockReport(type, stock, r.id);
}

// ═══ ADMIN: STOCKS ═══
function buildAdminStocks() {
  const allStocks = STOCKS.slice(0, 30);
  document.getElementById('admin-stock-tbl').innerHTML = allStocks.map(s => `
    <tr><td class="sym">${s.sym}</td><td style="font-size:12px">${s.name}</td><td>₹${s.price.toLocaleString()}</td><td style="color:var(--muted2)">${s.sec}</td>
    <td style="display:flex;gap:5px">
      <button class="ab ab-e" onclick="editStock('${s.sym}')">Edit</button>
    </td></tr>`).join('');
}

function editStock(sym) {
  const s = STOCKS.find(x => x.sym === sym);
  if (!s) return;
  document.getElementById('as-sym').value = s.sym;
  document.getElementById('as-name').value = s.name;
  document.getElementById('as-exc').value = s.exc;
  document.getElementById('as-sec').value = s.sec;
  document.getElementById('as-price').value = s.price;
  document.getElementById('as-chg').value = s.chg;
  document.getElementById('as-hi').value = s.hi;
  document.getElementById('as-lo').value = s.lo;
  document.getElementById('as-pe').value = s.pe;
  document.getElementById('as-mc').value = s.mc;
  document.getElementById('edit-stock-id').value = sym;
}

function saveStock() {
  const sym = document.getElementById('as-sym').value.trim().toUpperCase();
  if (!sym) { toast('Symbol required', 'err'); return; }
  const data = {
    sym, name: document.getElementById('as-name').value,
    exc: document.getElementById('as-exc').value,
    sec: document.getElementById('as-sec').value,
    price: parseFloat(document.getElementById('as-price').value),
    chg: parseFloat(document.getElementById('as-chg').value),
    hi: parseFloat(document.getElementById('as-hi').value),
    lo: parseFloat(document.getElementById('as-lo').value),
    pe: parseFloat(document.getElementById('as-pe').value),
    mc: document.getElementById('as-mc').value
  };
  // Update in DB
  const existing = DB.tables.stocks.findIndex(s => s.sym === sym);
  if (existing > -1) DB.tables.stocks[existing] = { ...DB.tables.stocks[existing], ...data };
  else DB.tables.stocks.push({ id: DB.tables.stocks.length + 1, ...data, created_at: new Date().toISOString() });
  DB.save();
  buildAll();
  toast(`Stock ${sym} saved to database ✓`);
  log(`Stock ${sym} updated by ${cUser}`);
  clearStockForm();
}

function clearStockForm() {
  ['as-sym', 'as-name', 'as-price', 'as-chg', 'as-hi', 'as-lo', 'as-pe', 'as-mc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('edit-stock-id').value = '';
}

// ═══ ADMIN: USERS ═══
function buildUsers() {
  document.getElementById('users-tbl').innerHTML = DB.tables.users.map(u => `
    <tr>
      <td style="color:var(--muted)">#${u.id}</td>
      <td style="font-family:Syne,sans-serif;font-weight:700">${u.username}</td>
      <td><span class="b ${u.role === 'admin' ? 'br' : u.role === 'employee' ? 'ba' : 'bb'}">${u.role}</span></td>
      <td style="color:var(--muted2);font-size:12px">${u.email}</td>
      <td style="font-size:11px;color:var(--muted)">${u.joined}</td>
      <td style="display:flex;gap:5px">
        <button class="ab ab-e" onclick="editUser(${u.id})">Edit</button>
        ${u.id !== 1 ? `<button class="ab ab-d" onclick="deleteUser(${u.id})">Delete</button>` : ''}
      </td>
    </tr>`).join('');
}

function editUser(id) {
  const u = DB.findById('users', id);
  if (!u) return;
  document.getElementById('edit-user-id').value = id;
  document.getElementById('u-uname').value = u.username;
  document.getElementById('u-name').value = u.name;
  document.getElementById('u-email').value = u.email;
  document.getElementById('u-role').value = u.role;
}

function saveUser() {
  const id = document.getElementById('edit-user-id').value;
  const data = {
    username: document.getElementById('u-uname').value.trim(),
    name: document.getElementById('u-name').value.trim(),
    email: document.getElementById('u-email').value.trim(),
    role: document.getElementById('u-role').value
  };
  const pass = document.getElementById('u-pass').value;
  if (pass) data.password = pass;
  if (!data.username || !data.name) { toast('Username and name required', 'err'); return; }
  if (id) {
    DB.update('users', id, data);
    toast('User updated ✓');
    log(`User #${id} updated by ${cUser}`);
  } else {
    if (!pass) { toast('Password required for new user', 'err'); return; }
    data.joined = new Date().toISOString().split('T')[0];
    DB.insert('users', data);
    toast('User created ✓');
    log(`New user "${data.username}" created by ${cUser}`);
  }
  DB.save();
  buildUsers();
  clearUserForm();
  document.getElementById('dash-users').textContent = DB.tables.users.length;
  updateDbStatus();
}

function deleteUser(id) {
  if (id == cUserId) { toast('Cannot delete yourself', 'err'); return; }
  DB.delete('users', id);
  toast('User deleted');
  log(`User #${id} deleted by ${cUser}`);
  buildUsers();
  updateDbStatus();
}

function clearUserForm() {
  ['edit-user-id', 'u-uname', 'u-name', 'u-email', 'u-pass'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('u-role').value = 'user';
}

// ═══ ADMIN: ALL REPORTS ═══
function buildAdminReports() {
  // Reports
  const reports = [...DB.tables.reports].reverse();
  document.getElementById('admin-rep-tbl').innerHTML = reports.length === 0
    ? `<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:20px">No reports yet. Reports will appear here when any user generates one.</td></tr>`
    : reports.map(r => `
      <tr>
        <td style="color:var(--muted)">#${r.id}</td>
        <td style="font-weight:600">${r.type}</td>
        <td style="color:var(--muted2)">${r.stock || 'All'}</td>
        <td style="color:var(--accent2)">${r.user_name || '—'}</td>
        <td style="font-size:11px;color:var(--muted)">${new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        <td><span class="b bg" style="font-size:9px">${r.status || 'Generated'}</span></td>
        <td style="display:flex;gap:5px">
          <button class="ab ab-v" onclick="viewReport(${r.id})">View</button>
          <button class="ab ab-d" onclick="deleteReport(${r.id})">Delete</button>
        </td>
      </tr>`).join('');
  // All Predictions
  const preds = [...DB.tables.predictions].reverse();
  const predTbl = document.getElementById('admin-pred-tbl');
  if (predTbl) predTbl.innerHTML = preds.length === 0
    ? `<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:20px">No predictions yet. Predictions will appear here when any user runs one.</td></tr>`
    : preds.map(p => `
      <tr>
        <td style="color:var(--muted)">#${p.id}</td>
        <td class="sym">${p.symbol}</td>
        <td style="color:var(--accent)">₹${p.predicted_price}</td>
        <td><span class="b ${p.signal === 'UPTREND' ? 'bg' : p.signal === 'WATCH' ? 'ba' : 'bb'}">${p.signal}</span></td>
        <td style="color:var(--green)">${parseFloat(p.confidence).toFixed(1)}%</td>
        <td style="color:var(--muted2);font-size:11px">${p.algorithm}</td>
        <td style="color:var(--accent2)">${p.user_name || '—'}</td>
        <td style="font-size:11px;color:var(--muted)">${new Date(p.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
      </tr>`).join('');
  // Activity log
  const actEl = document.getElementById('admin-activity-log');
  if (actEl) actEl.innerHTML = DB.tables.activity_log.slice(0, 50).map(l => `<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.03)"><span style="color:var(--accent2);font-size:10px">${l.user ? '[' + l.user + '] ' : ''}</span><span style="color:var(--muted2)">${l.msg}</span></div>`).join('') || `<div style="color:var(--muted)">No activity logged yet.</div>`;
}

// ═══ DATABASE CONSOLE ═══
async function runSQL(preQuery) {
  const q = preQuery || document.getElementById('sql-input').value.trim();
  if (!q) return;
  if (preQuery) document.getElementById('sql-input').value = preQuery;
  try {
    const result = await StockSenseAPI.sql(q);
    const { columns, rows } = result;
    const html = `<div style="color:var(--green);margin-bottom:6px">✓ Query OK · ${rows.length} row(s) returned</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr>${columns.map(c => `<th style="padding:4px 8px;text-align:left;color:var(--accent);border-bottom:1px solid var(--border)">${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr>${row.map(cell => `<td style="padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.03)">${cell ?? 'NULL'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
    const el = document.getElementById('sql-result');
    el.style.display = 'block';
    el.innerHTML = html;
    log(`SQL: ${q} → ${rows.length} rows`);
  } catch (e) {
    document.getElementById('sql-result').innerHTML = `<div style="color:var(--red)">✗ Error: ${e.message}</div>`;
    document.getElementById('sql-result').style.display = 'block';
  }
}

function buildDbStats() {
  const stats = Object.entries(DB.tables).map(([k, v]) => ({ name: k, count: v.length }));
  document.getElementById('db-stats').innerHTML = stats.map(s => `
    <div class="metric"><div class="ml">${s.name}</div><div class="mv" style="font-size:1rem;color:var(--accent)">${s.count}</div><div class="mc" style="color:var(--muted2)">rows</div></div>`).join('');
}

// ═══ SYSTEM ═══
function buildSysHealth() {
  document.getElementById('sys-health').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="ali"><div><div style="font-weight:600">SQLite Database</div><div style="font-size:11px;color:var(--muted2)">Persistent backend storage in data/stocksense.sqlite3</div></div><span class="b bg">Online</span></div>
      <div class="ali"><div><div style="font-weight:600">Claude AI API</div><div style="font-size:11px;color:var(--muted2)">claude-sonnet-4-20250514 connected</div></div><span class="b bg">Ready</span></div>
      <div class="ali"><div><div style="font-weight:600">Stock Data</div><div style="font-size:11px;color:var(--muted2)">${STOCKS.length} stocks in memory + DB</div></div><span class="b bg">Active</span></div>
      <div class="ali"><div><div style="font-weight:600">Authentication</div><div style="font-size:11px;color:var(--muted2)">${DB.tables.users.length} users · Role-based access</div></div><span class="b bg">Secure</span></div>
      <div class="ali"><div><div style="font-weight:600">Predictions Engine</div><div style="font-size:11px;color:var(--muted2)">${DB.tables.predictions.length} predictions stored</div></div><span class="b ${DB.tables.predictions.length > 0 ? 'bg' : 'ba'}">${DB.tables.predictions.length > 0 ? 'Active' : 'Idle'}</span></div>
    </div>
    <div style="margin-top:14px">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:600;margin-bottom:8px">Database Tables</div>
      ${Object.entries(DB.tables).map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="color:var(--muted2);font-family:'JetBrains Mono',monospace">${k}</span><span style="color:var(--accent)">${v.length} rows</span></div>`).join('')}
    </div>`;
  const logEl = document.getElementById('activity-log');
  if (logEl) logEl.innerHTML = DB.tables.activity_log.slice(0, 25).map(l => `<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.03)"><span style="color:var(--muted);font-size:10px">${l.user ? '[' + l.user + '] ' : ''}</span>${l.msg}</div>`).join('');
}

function exportDB() {
  const json = JSON.stringify(DB.tables, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `StockSense_DB_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  toast('Database exported ✓');
}

async function resetDB() {
  if (!confirm('Reset database to defaults? This will clear all predictions, watchlists, and reports.')) return;
  await DB.seed();
  buildAll();
  toast('Database reset to defaults');
  log('Database reset by admin');
}

function clearPredictions() {
  DB.tables.predictions = [];
  DB.save();
  buildPredHist();
  document.getElementById('dash-preds').textContent = 0;
  toast('Predictions cleared');
  log('Predictions log cleared');
}

// ═══ PROFILE ═══
function saveProfile() {
  const name = document.getElementById('pn2').value;
  const email = document.getElementById('pem').value;
  DB.update('users', cUserId, { name, email });
  cUser = name;
  document.getElementById('sbuser').textContent = cUser;
  document.getElementById('pname').textContent = cUser;
  document.getElementById('pav').textContent = cUser[0].toUpperCase();
  document.getElementById('tbav').textContent = cUser[0].toUpperCase();
  document.getElementById('tbusr').textContent = cUser;
  toast('Profile saved to database ✓');
  log('Profile updated');
  buildProfileStats();
}

function buildProfileStats() {
  const myPreds = DB.findAll('predictions', { user_id: cUserId });
  const myWL = DB.findAll('watchlist', { user_id: cUserId });
  const myAlerts = DB.findAll('alerts', { user_id: cUserId });
  const myReports = DB.findAll('reports', { user_id: cUserId });
  document.getElementById('profile-stats').innerHTML = `
    <div class="g2" style="margin-bottom:12px">
      <div class="metric"><div class="ml">Predictions Run</div><div class="mv" style="color:var(--accent)">${myPreds.length}</div></div>
      <div class="metric"><div class="ml">Watchlist Stocks</div><div class="mv" style="color:var(--green)">${myWL.length}</div></div>
      <div class="metric"><div class="ml">Active Alerts</div><div class="mv" style="color:var(--amber)">${myAlerts.length}</div></div>
      <div class="metric"><div class="ml">Reports Generated</div><div class="mv" style="color:var(--accent2)">${myReports.length}</div></div>
    </div>
    <div class="ct">Recent Predictions</div>
    ${myPreds.slice(-5).reverse().map(p => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="color:var(--accent);font-family:Syne,sans-serif;font-weight:700">${p.symbol}</span><span style="color:var(--muted2)">₹${p.predicted_price} · ${p.algorithm}</span></div>`).join('') || '<div style="color:var(--muted);font-size:12px">No predictions yet</div>'}`;
}

// ═══ SYMBOL AUTOCOMPLETE init (no-op — handled by spRender system) ═══
function initSymDD() {
  // All pickers now use spRender — no legacy setup needed
}

function selectSymFor(inputId, sym, ddId) {
  document.getElementById(inputId).value = sym;
  document.getElementById(ddId)?.classList.remove('open');
}

document.addEventListener('click', e => {
  if (!e.target.closest('[id$="-dd"]') && !e.target.closest('input') && !e.target.closest('.sp-filters')) {
    document.querySelectorAll('.sp-dropdown,.sym-dropdown').forEach(d => d.classList.remove('open'));
  }
});

// ═══ PREDICTION CHARTS ═══
function buildPredBarChart(sym, curPrice, predPrice) {
  const el = document.getElementById('pred-bar-wrap');
  if (!el) return;
  const W = 260, H = 160, padL = 44, padR = 14, padT = 14, padB = 28;
  const vals = [curPrice, predPrice];
  const labels = ['Current', 'Predicted'];
  const colors = ['rgba(56,189,248,0.7)', 'rgba(52,211,153,0.85)'];
  const maxV = Math.max(...vals) * 1.08;
  const scY = v => padT + (H - padT - padB) * (1 - v / maxV);
  const barW = (W - padL - padR) / vals.length / 1.5;
  let svg = `<svg viewBox="0 0 ${W} ${H + 16}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">`;
  // Grid
  for (let t = 0; t <= 4; t++) {
    const v = maxV * t / 4, y = scY(v);
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,5" stroke-width="1"/>`;
    svg += `<text x="${padL - 4}" y="${(y + 3.5).toFixed(1)}" font-size="8" fill="#475569" text-anchor="end" font-family="Inter">₹${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}</text>`;
  }
  vals.forEach((v, i) => {
    const x = padL + i * (W - padL - padR) / vals.length + (W - padL - padR) / vals.length / 2 - barW / 2;
    const by = scY(v), bh = H - padB - by;
    svg += `<defs><linearGradient id="bg${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${colors[i]}" stop-opacity="1"/><stop offset="100%" stop-color="${colors[i]}" stop-opacity="0.4"/></linearGradient></defs>`;
    svg += `<rect x="${x.toFixed(1)}" y="${by.toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" fill="url(#bg${i})" rx="4" class="svg-bar"/>`;
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H + 14}" font-size="9" fill="#64748b" text-anchor="middle" font-family="Inter">${labels[i]}</text>`;
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" font-size="8" fill="${colors[i]}" text-anchor="middle" font-family="Syne" font-weight="bold">₹${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}</text>`;
  });
  svg += `</svg>`;
  el.innerHTML = svg;
}

function buildPredPieChart(predList) {
  const el = document.getElementById('pred-pie-wrap');
  const leg = document.getElementById('pred-pie-legend');
  if (!el) return;
  // Count signals from recent predictions
  const counts = { UPTREND: 0, STABLE: 0, WATCH: 0 };
  predList.forEach(p => { if (counts[p.signal] !== undefined) counts[p.signal]++; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const colors = { UPTREND: '#34d399', STABLE: '#38bdf8', WATCH: '#fbbf24' };
  const W = 130, H = 130, cx = W / 2, cy = H / 2, r = 52, ir = 30;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%">`;
  let startAngle = -Math.PI / 2;
  Object.entries(counts).forEach(([key, val]) => {
    const slice = (val / total) * 2 * Math.PI;
    const endAngle = startAngle + slice;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const xi1 = cx + ir * Math.cos(startAngle), yi1 = cy + ir * Math.sin(startAngle);
    const xi2 = cx + ir * Math.cos(endAngle), yi2 = cy + ir * Math.sin(endAngle);
    const big = slice > Math.PI ? 1 : 0;
    if (val > 0) {
      svg += `<path d="M${xi1.toFixed(1)},${yi1.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${big},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${xi2.toFixed(1)},${yi2.toFixed(1)} A${ir},${ir} 0 ${big},0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z" fill="${colors[key]}" opacity="0.85" stroke="#0d1830" stroke-width="1.5"/>`;
    }
    startAngle = endAngle;
  });
  svg += `<text x="${cx}" y="${cy + 4}" font-size="11" fill="#94a3b8" text-anchor="middle" font-family="Syne" font-weight="bold">${total}</text>`;
  svg += `<text x="${cx}" y="${cy + 15}" font-size="7" fill="#64748b" text-anchor="middle" font-family="Inter">signals</text>`;
  svg += `</svg>`;
  el.innerHTML = svg;
  if (leg) leg.innerHTML = Object.entries(counts).map(([k, v]) => `<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--muted2)"><div style="width:10px;height:10px;border-radius:2px;background:${colors[k]}"></div>${k} (${v})</div>`).join('');
}

function buildPredLineChart(predList) {
  const el = document.getElementById('pred-line-wrap');
  if (!el) return;
  const vals = predList.slice(0, 12).map(p => parseFloat(p.confidence) || 75);
  const labels = predList.slice(0, 12).map((p, i) => p.symbol || `P${i + 1}`);
  const W = 260, H = 130, padL = 30, padR = 10, padT = 14, padB = 22;
  const mn = Math.min(...vals) - 5, mx = Math.max(...vals) + 5;
  const scX = i => padL + (i / Math.max(vals.length - 1, 1)) * (W - padL - padR);
  const scY = v => padT + (H - padT - padB) * (1 - (v - mn) / (mx - mn));
  let svg = `<svg viewBox="0 0 ${W} ${H + 14}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">`;
  // Area
  let area = `M${scX(0).toFixed(1)},${H - padB}` + vals.map((v, i) => ` L${scX(i).toFixed(1)},${scY(v).toFixed(1)}`).join('') + ` L${scX(vals.length - 1).toFixed(1)},${H - padB} Z`;
  svg += `<defs><linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#818cf8" stop-opacity="0.3"/><stop offset="100%" stop-color="#818cf8" stop-opacity="0"/></linearGradient></defs>`;
  svg += `<path d="${area}" fill="url(#lineGrad)"/>`;
  let line = `M${scX(0).toFixed(1)},${scY(vals[0]).toFixed(1)}`;
  for (let i = 1; i < vals.length; i++) line += ` L${scX(i).toFixed(1)},${scY(vals[i]).toFixed(1)}`;
  svg += `<path d="${line}" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round"/>`;
  vals.forEach((v, i) => {
    const isHigh = v === Math.max(...vals);
    svg += `<circle cx="${scX(i).toFixed(1)}" cy="${scY(v).toFixed(1)}" r="${isHigh ? 4.5 : 3}" fill="${isHigh ? '#818cf8' : '#818cf8'}" stroke="#0d1830" stroke-width="1.5" opacity="${isHigh ? 1 : 0.8}"/>`;
    if (isHigh) svg += `<text x="${scX(i).toFixed(1)}" y="${(scY(v) - 7).toFixed(1)}" font-size="8" fill="#818cf8" text-anchor="middle" font-family="Inter" font-weight="bold">${v}%</text>`;
    if (i % 3 === 0 && labels[i]) svg += `<text x="${scX(i).toFixed(1)}" y="${H + 12}" font-size="7.5" fill="#64748b" text-anchor="middle" font-family="Inter">${labels[i].substring(0, 6)}</text>`;
  });
  svg += `</svg>`;
  el.innerHTML = svg + `<div style="font-size:10px;color:var(--muted2);margin-top:4px;text-align:center;opacity:.7">Confidence % across last ${vals.length} predictions</div>`;
}

function buildPredCandleChart(s) {
  const el = document.getElementById('pred-candle-wrap');
  if (!el) return;
  const baseP = s.price;
  const candles = [];
  let lastClose = baseP * 0.94;
  for (let i = 0; i < 14; i++) {
    const open = lastClose * (1 + (Math.random() - 0.49) * 0.008);
    const close = open * (1 + (Math.random() - 0.47) * 0.014);
    const high = Math.max(open, close) * (1 + Math.random() * 0.007);
    const low = Math.min(open, close) * (1 - Math.random() * 0.007);
    candles.push({ o: open, c: close, h: high, l: low });
    lastClose = close;
  }
  candles[candles.length - 1].c = baseP;
  candles[candles.length - 1].h = Math.max(candles[candles.length - 1].h, baseP * 1.003);

  const W = 260, H = 160, padL = 40, padR = 10, padT = 10, padB = 28;
  const allVals = candles.flatMap(c => [c.h, c.l]);
  const minV = Math.min(...allVals) * 0.9985, maxV = Math.max(...allVals) * 1.0015;
  const scY = v => padT + (H - padT - padB) * (1 - (v - minV) / (maxV - minV));
  const cW = Math.floor((W - padL - padR) / candles.length);
  const bodyW = Math.max(4, cW - 5);
  let svg = `<svg viewBox="0 0 ${W} ${H + 10}" xmlns="http://www.w3.org/2000/svg" style="width:100%;overflow:visible">`;
  svg += `<defs><linearGradient id="cUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#34d399" stop-opacity="1"/><stop offset="100%" stop-color="#34d399" stop-opacity="0.55"/></linearGradient><linearGradient id="cDn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f87171" stop-opacity="0.7"/><stop offset="100%" stop-color="#f87171" stop-opacity="1"/></linearGradient></defs>`;
  for (let t = 0; t <= 4; t++) {
    const val = minV + (maxV - minV) * (t / 4), y = scY(val);
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="3,5"/>`;
    svg += `<text x="${padL - 4}" y="${(y + 3.5).toFixed(1)}" font-size="7.5" fill="#475569" text-anchor="end" font-family="Inter">₹${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)}</text>`;
  }
  candles.forEach((c, i) => {
    const isUp = c.c >= c.o;
    const col = isUp ? 'url(#cUp)' : 'url(#cDn)', stroke = isUp ? '#34d399' : '#f87171';
    const x = padL + i * cW + cW / 2;
    const bodyTop = scY(Math.max(c.o, c.c)), bodyBot = scY(Math.min(c.o, c.c));
    const bodyH = Math.max(2, bodyBot - bodyTop), bodyX = x - bodyW / 2;
    svg += `<line x1="${x.toFixed(1)}" y1="${scY(c.h).toFixed(1)}" x2="${x.toFixed(1)}" y2="${scY(c.l).toFixed(1)}" stroke="${stroke}" stroke-width="1.2" opacity="0.7"/>`;
    svg += `<rect x="${bodyX.toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${bodyW}" height="${bodyH.toFixed(1)}" fill="${col}" stroke="${stroke}" stroke-width="0.8" rx="1.5" opacity="0.92"/>`;
    if (i % 4 === 0 || i === candles.length - 1) {
      const d = new Date(); d.setDate(d.getDate() - (candles.length - 1 - i));
      const lbl = i === candles.length - 1 ? 'Now' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      svg += `<text x="${x.toFixed(1)}" y="${H + 8}" font-size="7" fill="#475569" text-anchor="middle" font-family="Inter">${lbl}</text>`;
    }
  });
  // Predicted ghost candle
  const lastC = candles[candles.length - 1];
  const predClose = parseFloat(predP(s));
  const pgx = padL + candles.length * cW + cW / 2;
  if (pgx < W - padR) {
    const isUp2 = predClose > lastC.c;
    const stroke2 = isUp2 ? '#34d399' : '#f87171';
    const pbT = scY(Math.max(lastC.c, predClose)), pbB = scY(Math.min(lastC.c, predClose));
    svg += `<line x1="${pgx.toFixed(1)}" y1="${scY(Math.max(lastC.c, predClose) * 1.004).toFixed(1)}" x2="${pgx.toFixed(1)}" y2="${scY(Math.min(lastC.c, predClose) * 0.996).toFixed(1)}" stroke="${stroke2}" stroke-width="1.2" stroke-dasharray="2,2" opacity="0.6"/>`;
    svg += `<rect x="${(pgx - bodyW / 2).toFixed(1)}" y="${pbT.toFixed(1)}" width="${bodyW}" height="${Math.max(2, pbB - pbT).toFixed(1)}" fill="${isUp2 ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'}" stroke="${stroke2}" stroke-width="0.8" stroke-dasharray="2,2" rx="1.5"/>`;
    svg += `<text x="${pgx.toFixed(1)}" y="${H + 8}" font-size="7" fill="${stroke2}" text-anchor="middle" font-family="Inter" font-weight="bold">Pred</text>`;
  }
  svg += `</svg>`;
  el.innerHTML = svg + `<div style="display:flex;gap:10px;margin-top:6px;justify-content:center">
    <div style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--muted2)"><div style="width:8px;height:8px;background:#34d399;border-radius:1px"></div>Bullish</div>
    <div style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--muted2)"><div style="width:8px;height:8px;background:#f87171;border-radius:1px"></div>Bearish</div>
  </div>`;
}

// ═══ SYMBOL SEARCH FOR REPORT ═══
let repNavIdx2 = 0;
function symSearchRep(q) { spRender('rep-sym', 'rep-sym-dd', 'repSelectStock'); }

function repSelectStock(sym) {
  document.getElementById('rep-sym').value = sym;
  document.getElementById('rep-sym-dd').classList.remove('open');
  const s = STOCKS.find(x => x.sym === sym);
  if (s) {
    const chip = document.getElementById('rep-stock-chip');
    if (chip) {
      chip.style.display = 'block';
      document.getElementById('rsc-name').textContent = s.name;
      document.getElementById('rsc-sec').textContent = s.sec;
      document.getElementById('rsc-price').textContent = '₹' + s.price.toLocaleString();
      const chgEl = document.getElementById('rsc-chg');
      chgEl.textContent = (s.chg > 0 ? '▲' : '▼') + Math.abs(s.chg) + '%';
      chgEl.style.color = s.chg > 0 ? 'var(--green)' : 'var(--red)';
    }
  }
  repNavIdx2 = STOCKS.findIndex(x => x.sym === sym);
}

function closeRepSymDD() { document.getElementById('rep-sym-dd')?.classList.remove('open'); }

function repNavStockBtn(dir) {
  const max = STOCKS.length;
  repNavIdx2 = ((repNavIdx2 + dir) + max) % max;
  const s = STOCKS[repNavIdx2];
  document.getElementById('rep-sym').value = s.sym;
  repSelectStock(s.sym);
}

// ═══ INIT ═══
async function init() {
  await DB.init();
  log('StockSense backend initialized');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-page').style.display !== 'none') { if (document.getElementById('panel-register').style.display === 'block') doRegister(); else doLogin(); }
});

// Start
init().then(() => {
  document.getElementById('login-page').style.display = 'flex';
  // Set default target date (7 days from now)
  const ptdate = document.getElementById('ptdate');
  if (ptdate) {
    const d7 = new Date(Date.now() + 7 * 864e5);
    ptdate.value = d7.toISOString().split('T')[0];
  }
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0];
  const repFrom = document.getElementById('rep-from');
  const repTo = document.getElementById('rep-to');
  if (repFrom) repFrom.value = monthAgo;
  if (repTo) repTo.value = today;
  // Close dropdowns on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('[id$="-dd"]') && !e.target.closest('input')) {
      document.querySelectorAll('.sym-dropdown').forEach(d => d.classList.remove('open'));
    }
  });
});

// ═══ STATIC TRADING CANVAS BACKGROUND (drawn once, no animation loop) ═══
(function () {
  function drawTradingBG(canvasId, opts) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const O = Object.assign({
      bgColor: '#020912',
      gridColor: 'rgba(56,189,248,0.045)',
      candleUp: '#34d399',
      candleDown: '#f87171',
      textColor: 'rgba(56,189,248,0.22)',
      numCandles: 72
    }, opts);

    const W = canvas.width = canvas.offsetWidth || window.innerWidth;
    const H = canvas.height = canvas.offsetHeight || window.innerHeight;

    // ── Background ──
    ctx.fillStyle = O.bgColor;
    ctx.fillRect(0, 0, W, H);

    // Dark vignette overlay
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, H * 0.9);
    vig.addColorStop(0, 'rgba(2,9,18,0)');
    vig.addColorStop(1, 'rgba(2,9,18,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    // ── Generate candles ──
    const candles = [];
    let price = 19800 + Math.random() * 2000;
    for (let i = 0; i < O.numCandles; i++) {
      const o = price;
      const move = (Math.random() - 0.47) * price * 0.016;
      const c = o + move;
      candles.push({
        o, c,
        hi: Math.max(o, c) * (1 + Math.random() * 0.007),
        lo: Math.min(o, c) * (1 - Math.random() * 0.007),
        vol: 0.25 + Math.random() * 0.75
      });
      price = c;
    }

    const pHi = Math.max(...candles.map(c => c.hi)) * 1.012;
    const pLo = Math.min(...candles.map(c => c.lo)) * 0.988;
    const chartTop = H * 0.07, chartH = H * 0.60;
    const volBot = H * 0.84, volH = H * 0.10;
    const cW = W / O.numCandles;
    const bW = Math.max(3, cW * 0.62);

    function scY(v) { return chartTop + chartH * (1 - (v - pLo) / (pHi - pLo)); }

    // ── Grid ──
    ctx.strokeStyle = O.gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const y = chartTop + chartH * (i / 6);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      const lbl = '₹' + Math.round(pHi - (pHi - pLo) * (i / 6)).toLocaleString('en-IN');
      ctx.fillStyle = O.textColor;
      ctx.font = '10px "JetBrains Mono",monospace';
      ctx.fillText(lbl, 8, y - 4);
    }
    for (let i = 0; i < O.numCandles; i += 8) {
      const x = i * cW + cW / 2;
      ctx.strokeStyle = O.gridColor;
      ctx.beginPath(); ctx.moveTo(x, chartTop); ctx.lineTo(x, chartTop + chartH); ctx.stroke();
    }

    // ── MA line (gold) ──
    const maLen = 18;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(251,191,36,0.32)';
    ctx.lineWidth = 1.6;
    candles.forEach((c, i) => {
      if (i < maLen) return;
      const ma = candles.slice(i - maLen, i).reduce((s, x) => s + (x.o + x.c) / 2, 0) / maLen;
      const x = i * cW + cW / 2, y = scY(ma);
      i === maLen ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // ── EMA line (purple) ──
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(129,140,248,0.25)';
    ctx.lineWidth = 1.2;
    candles.forEach((c, i) => {
      if (i < 9) return;
      const ema = candles.slice(i - 9, i).reduce((s, x) => s + (x.o + x.c) / 2, 0) / 9;
      const x = i * cW + cW / 2, y = scY(ema);
      i === 9 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // ── Candles ──
    candles.forEach((c, i) => {
      const isUp = c.c >= c.o;
      const col = isUp ? O.candleUp : O.candleDown;
      const x = i * cW;
      const top = scY(Math.max(c.o, c.c));
      const bot = scY(Math.min(c.o, c.c));
      const bH = Math.max(1.5, bot - top);
      const cx = x + cW / 2;

      // Wick
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, scY(c.hi));
      ctx.lineTo(cx, scY(c.lo));
      ctx.stroke();

      // Glow
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = col;
      ctx.fillRect(x + (cW - bW) / 2 - 2, top - 1, bW + 4, bH + 2);

      // Body
      ctx.globalAlpha = isUp ? 0.75 : 0.65;
      ctx.fillStyle = col;
      ctx.fillRect(x + (cW - bW) / 2, top, bW, bH);
      ctx.globalAlpha = 1;

      // Volume
      const vH = volH * c.vol;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = col;
      ctx.fillRect(x + (cW - bW) / 2, volBot - vH, bW, vH);
      ctx.globalAlpha = 1;
    });

    // ── Bottom label ──
    ctx.fillStyle = 'rgba(56,189,248,0.18)';
    ctx.font = '9px "JetBrains Mono",monospace';
    const lbl = 'NIFTY 50  ●  BSE SENSEX  ●  NSE  ●  LIVE MARKET DATA';
    ctx.fillText(lbl, W / 2 - ctx.measureText(lbl).width / 2, H - 12);
  }

  function paintLoginBG() { drawTradingBG('trading-bg-canvas', { numCandles: 72 }); }
  function paintDashBG() {
    drawTradingBG('dash-trading-canvas', {
      numCandles: 80,
      bgColor: '#020912',
      gridColor: 'rgba(56,189,248,0.03)',
      textColor: 'rgba(56,189,248,0.14)'
    });
  }

  window.__startLoginBG = paintLoginBG;
  window.__stopLoginBG = function () { };
  window.__startDashBG = paintDashBG;
  window.__stopDashBG = function () { };

  document.addEventListener('DOMContentLoaded', paintLoginBG);
  window.addEventListener('resize', () => {
    const lp = document.getElementById('login-page');
    const ap = document.getElementById('app-page');
    if (lp && lp.style.display !== 'none') paintLoginBG();
    if (ap && ap.style.display !== 'none') paintDashBG();
  });
})();
