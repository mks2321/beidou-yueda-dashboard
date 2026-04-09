#!/usr/bin/env node
/**
 * 北斗-悦达 看板自动更新脚本
 * 用法：
 *   node update.js          # 自动从 Google Sheets 拉最新数据
 *   node update.js data.csv # 手动指定本地 CSV
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── 配置区 ────────────────────────────────────────
const SHEET_ID  = '1jPoav8VPII5uK2GD8F-0kro8yelhTd8kkcf47AhnkcE';
const SHEET_GID = '0'; // 产品投放 Sheet
const HTML_FILE = "/Users/liebao/Library/CloudStorage/GoogleDrive-makuisi2321@gmail.com/我的云端硬盘/北斗悦达看板/index.html";
// ──────────────────────────────────────────────────

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };

  // 找真正的表头行（包含"产品名称"或"W1"等关键字）
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].includes('产品名称') || lines[i].includes('产品类型') || lines[i].includes('W1目标')) {
      headerIdx = i;
      break;
    }
  }

  const headers = lines[headerIdx].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const dataLines = lines.slice(headerIdx + 1);

  const rows = dataLines.map(line => {
    const cols = []; let cur = '', inQ = false;
    for (let ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || '').replace(/^"|"$/g, ''); });
    return obj;
  });

  return { headers, rows };
}

function findCol(row, candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find(k => k.includes(c));
    if (found) return found;
  }
  return null;
}

function toNum(v) {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[,%\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

async function main() {
  let csvText = '';
  const localFile = process.argv[2];

  if (localFile) {
    if (!fs.existsSync(localFile)) { console.error('❌ 找不到文件:', localFile); process.exit(1); }
    console.log('📂 读取本地文件:', localFile);
    csvText = fs.readFileSync(localFile, 'utf-8');
  } else {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
    console.log('🌐 正在从 Google Sheets 拉取最新数据...');
    try {
      csvText = await fetchURL(url);
      console.log('✅ 数据拉取成功！');
    } catch (err) {
      console.error('❌ 拉取失败:', err.message);
      console.error('💡 请手动导出 CSV 后运行: node update.js 产品投放.csv');
      process.exit(1);
    }
  }

  const { headers, rows } = parseCSV(csvText);
  console.log(`📊 找到表头: ${headers.slice(0,6).join(' | ')} ...`);
  console.log(`📊 数据行数: ${rows.length}`);

  if (rows.length === 0) { console.error('❌ 数据为空'); process.exit(1); }

  const firstRow = rows[0];
  const colName        = findCol(firstRow, ['产品名称', '产品名', '名称']);
  const colType        = findCol(firstRow, ['产品类型', '类型']);
  const colTarget      = findCol(firstRow, ['月度新增目标', '新增目标']);
  const colBudget      = findCol(firstRow, ['月度预算上限', '月度预算', '预算']);
  const colW1          = findCol(firstRow, ['W1实际']);
  const colW2          = findCol(firstRow, ['W2实际']);
  const colW3          = findCol(firstRow, ['W3实际']);
  const colW4          = findCol(firstRow, ['W4实际']);
  const colTotal       = findCol(firstRow, ['累计新增']);
  const colConsume     = findCol(firstRow, ['累计消耗']);
  const colCompletion  = findCol(firstRow, ['完成率']);
  const colConsumeRate = findCol(firstRow, ['消耗率']);

  if (!colName) {
    console.error('❌ 找不到"产品名称"列');
    console.error('   CSV 列名:', headers.join(', '));
    process.exit(1);
  }

  const products = rows
    .filter(r => r[colName] && r[colName].trim())
    .map(r => ({
      name: r[colName].trim(), type: r[colType] || '付费',
      target: toNum(r[colTarget]), budget: toNum(r[colBudget]),
      w1: toNum(r[colW1]), w2: toNum(r[colW2]),
      w3: toNum(r[colW3]), w4: toNum(r[colW4]),
      total: toNum(r[colTotal]), consume: toNum(r[colConsume]),
      completion: toNum(r[colCompletion]), consumeRate: toNum(r[colConsumeRate]),
    }));

  console.log(`\n✅ 解析到 ${products.length} 个产品：`);
  products.forEach(p => console.log(`   • ${p.name} (${p.type}) 完成率:${p.completion}% 消耗率:${p.consumeRate}%`));

  if (!fs.existsSync(HTML_FILE)) {
    console.error('\n❌ 找不到 index.html，请确保两个文件在同一文件夹');
    process.exit(1);
  }

  let html = fs.readFileSync(HTML_FILE, 'utf-8');
  const today = new Date().toISOString().slice(0, 10);

  const newDataJS = `const lastUpdated = '${today}';   // ← 每次更新数据时修改这里\n\nconst products = [\n${
    products.map(p =>
      `  { name:'${p.name.replace(/'/g, "\\'")}', type:'${p.type}', target:${p.target}, budget:${p.budget}, w1:${p.w1}, w2:${p.w2}, w3:${p.w3}, w4:${p.w4}, total:${p.total}, consume:${p.consume}, completion:${p.completion}, consumeRate:${p.consumeRate} },`
    ).join('\n')
  }\n];`;

  const dataStart = html.indexOf("const lastUpdated = '");
  const dataEnd   = html.indexOf('];\n', dataStart) + 3;

  if (dataStart === -1) {
    console.error('\n❌ 找不到数据区，请重新下载 index.html');
    process.exit(1);
  }

  fs.writeFileSync(HTML_FILE, html.slice(0, dataStart) + newDataJS + '\n' + html.slice(dataEnd), 'utf-8');

  console.log('\n🎉 看板更新完成！');
  console.log(`📅 数据日期: ${today}  |  📦 产品: ${products.length} 个`);
  console.log('👉 双击 index.html 打开看板查看最新数据\n');
}

main().catch(err => { console.error('❌ 出错:', err.message); process.exit(1); });

// 自动推送到 GitHub Pages
const { execSync } = require("child_process");
try {
  execSync("git add index.html && git commit -m \"Update data $(date +%Y-%m-%d)\" && git push", { cwd: __dirname, stdio: "inherit" });
  console.log("🚀 已推送到 GitHub Pages，同事刷新网页即可看到最新数据！");
} catch(e) {
  console.log("⚠️  推送失败，请手动运行 git push");
}
