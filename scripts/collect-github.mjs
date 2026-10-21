#!/usr/bin/env node
/**
 * 抓 GitHub 热门 AI 仓库，输出 JSON。
 *
 * 用法：node collect-github.mjs [--limit 5] [--topics llm,ai-agents,mcp,rag]
 *
 * 主路径抓 trending 页；本机到 github.com 经常被墙/断流，所以：
 *   1) 多个 IP 轮换 + 重试 + 传输被截断时用部分正文
 *   2) 都不行就退回 API 搜索 + 本地星数快照做差
 *   3) 连基线都没有，输出候选仓库但 starsToday 为 null（调用方必须标未知）
 *
 * 可选 token：GITHUB_TOKEN 环境变量，或 ~/.config/dsh-github/token。
 * 只读，不写远端。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { request } from 'node:https';
import { homedir } from 'node:os';

const API = 'https://api.github.com';
const DEFAULT_IPS = ['20.27.177.113', '140.82.112.3', '20.201.28.151', '20.200.245.247', '4.237.22.38'];

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const LIMIT = Number(arg('limit', '5'));
const TOPICS = arg('topics', 'llm,ai-agents,mcp,rag').split(',').filter(Boolean);
const STATE_DIR = arg('state', join(process.cwd(), '.ai-digest', 'state'));
const TIMEOUT = Number(arg('timeout', '10000'));
const IPS = (process.env.GH_TRENDING_IPS ?? DEFAULT_IPS.join(',')).split(',').filter(Boolean);

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  for (const p of [join(homedir(), '.config', 'dsh-github', 'token'), join(homedir(), '.config', 'github', 'token')]) {
    try {
      return readFileSync(p, 'utf8').trim();
    } catch {}
  }
  return '';
}
const TOKEN = readToken();
const HDR = {
  'User-Agent': 'ai-digest/1.0',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path, accept = HDR.Accept) {
  const r = await fetch(`${API}${path}`, { headers: { ...HDR, Accept: accept } });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${path.split('?')[0]}`);
  return r.json();
}

function httpsGetPinned(ip, host, path) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      fn(v);
    };
    const chunks = [];
    const req = request(
      {
        host: ip,
        servername: host, // 证书按域名校验，IP 只做传输
        path,
        headers: { Host: host, 'User-Agent': 'Mozilla/5.0 (compatible; ai-digest/1.0)' },
        timeout: TIMEOUT,
      },
      (res) => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => done(reject, e));
      },
    );
    req.on('timeout', () => {
      // 连上了但正文传不动：trending 列表在前半页，有部分就先解析
      if (chunks.length) done(resolve, { status: 200, body: Buffer.concat(chunks).toString('utf8') });
      else done(reject, new Error('timeout'));
      req.destroy();
    });
    req.on('error', (e) => done(reject, e));
    req.end();
  });
}

const strip = (h) =>
  h
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();

async function trending() {
  let html = '';
  for (const ip of IPS) {
    for (let i = 1; i <= 2 && !html; i++) {
      try {
        const r = await httpsGetPinned(ip, 'github.com', '/trending?since=daily');
        if (r.status === 200) html = r.body;
      } catch (err) {
        console.error(`[github] trending ${ip} 第 ${i} 次失败: ${err.message}`);
      }
    }
    if (html) break;
  }
  if (!html) return [];
  const items = [];
  for (const a of html.split('<article class="Box-row">').slice(1)) {
    if (!a.includes('</article>')) continue;
    const name = /<h2[^>]*>\s*<a[^>]*?href="\/([^"]+)"/.exec(a)?.[1];
    const stars = /([\d,]+)\s*stars today/.exec(a)?.[1];
    const desc = /<p class="col-9 color-fg-muted my-1[^"]*">\s*([\s\S]*?)\s*<\/p>/.exec(a)?.[1];
    if (name && stars) {
      items.push({
        repo: name.replace(/^sponsors\//, ''),
        starsToday: Number(stars.replace(/,/g, '')),
        desc: desc ? strip(desc).slice(0, 120) : '',
      });
    }
  }
  items.sort((a, b) => b.starsToday - a.starsToday);
  return items;
}

async function searchPool() {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const seen = new Map();
  for (const topic of TOPICS) {
    try {
      const j = await api(
        `/search/repositories?q=${encodeURIComponent(`topic:${topic} stars:>800 pushed:>${cutoff}`)}&sort=stars&order=desc&per_page=10`,
      );
      for (const it of j.items ?? []) {
        if (!seen.has(it.full_name)) {
          seen.set(it.full_name, {
            repo: it.full_name,
            desc: (it.description ?? '').slice(0, 120),
            totalStars: it.stargazers_count ?? null,
            topics: (it.topics ?? []).slice(0, 5),
          });
        }
      }
    } catch (err) {
      console.error(`[github] 搜索 ${topic} 失败: ${err.message}`);
    }
  }
  return [...seen.values()];
}

const SNAP = join(STATE_DIR, 'github-stars.json');

function loadSnap() {
  try {
    return JSON.parse(readFileSync(SNAP, 'utf8'));
  } catch {
    return {};
  }
}

function saveSnap(date, cands) {
  try {
    mkdirSync(dirname(SNAP), { recursive: true });
    writeFileSync(SNAP, JSON.stringify({ date, stars: Object.fromEntries(cands.map((c) => [c.repo, c.totalStars])) }));
  } catch {}
}

const AI = /\b(ai|llm|gpt|agent|agentic|mcp|rag|claude|openai|anthropic|llama|qwen|deepseek|diffusion|neural|embedding|inference)\b/i;
const isAI = (it) => AI.test(it.desc) || AI.test(it.repo) || (it.topics ?? []).some((t) => AI.test(t));

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const pool = await searchPool();
  const snap = loadSnap();
  const hasBase = Boolean(snap.date && snap.date < today && snap.stars);
  const deltas = hasBase
    ? pool
        .map((c) => ({ ...c, starsToday: snap.stars[c.repo] == null ? null : c.totalStars - snap.stars[c.repo] }))
        .filter((c) => c.starsToday != null && c.starsToday > 0)
        .sort((a, b) => b.starsToday - a.starsToday)
    : [];
  if (pool.length) saveSnap(today, pool);

  const hot = await trending();
  if (hot.length) {
    const out = [];
    for (const it of hot.slice(0, LIMIT * 3)) {
      try {
        const j = await api(`/repos/${it.repo}`);
        if (isAI({ ...it, topics: j.topics })) {
          out.push({ ...it, totalStars: j.stargazers_count ?? null, topics: (j.topics ?? []).slice(0, 5) });
        }
      } catch (err) {
        console.error(`[github] 补全 ${it.repo} 失败: ${err.message}`);
      }
      if (out.length >= LIMIT) break;
    }
    if (out.length) return out;
    console.error('[github] trending 无 AI 项目，改用快照差值');
  } else {
    console.error(`[github] trending 不可用，改用快照差值（可用 ${deltas.length} 条）`);
  }

  if (deltas.length) return deltas.slice(0, LIMIT);
  console.error('[github] 无基线，输出候选列表并标记 starsToday=null');
  return pool.filter(isAI).slice(0, LIMIT).map((c) => ({ ...c, starsToday: null }));
}

main()
  .then((out) => console.log(JSON.stringify(out, null, 2)))
  .catch((err) => {
    console.error(`[github] 失败: ${err.message}`);
    process.exit(1);
  });
