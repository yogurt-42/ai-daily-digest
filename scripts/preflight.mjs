#!/usr/bin/env node
/**
 * 环境自检：第一次使用前跑一遍，确认依赖齐不齐。
 *
 * 用法：node scripts/preflight.mjs [--json] [--qq]
 *
 * 退出码：0 = 核心可用（可能有警告）；1 = 缺核心依赖，先别往下跑。
 */
import { readFileSync, mkdirSync, accessSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { connect } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes('--json');

const results = [];
const add = (name, level, detail) => results.push({ name, level, detail });

function tcpCheck(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (ok, why) => {
      sock.destroy();
      resolve({ ok, why });
    };
    sock.setTimeout(timeoutMs, () => done(false, 'timeout'));
    sock.on('connect', () => done(true, ''));
    sock.on('error', (e) => done(false, e.code ?? e.message));
  });
}

async function main() {
  // 1. Node 版本
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) add('Node.js', 'ok', `v${process.versions.node}`);
  else add('Node.js', 'fail', `v${process.versions.node}，需要 18+`);

  // 2. 配置目录可写（优先工作区 .ai-digest/，沙箱里也能用）
  const cfgDir = process.env.AI_DIGEST_CONFIG
    ? dirname(process.env.AI_DIGEST_CONFIG)
    : join(process.cwd(), '.ai-digest');
  try {
    mkdirSync(cfgDir, { recursive: true });
    accessSync(cfgDir, constants.W_OK);
    add('配置目录', 'ok', cfgDir);
  } catch (err) {
    add('配置目录', 'fail', `${cfgDir} 不可写：${err.message}`);
  }

  // 3. 脚本齐不齐
  for (const f of ['collect-github.mjs', 'send-qq.mjs']) {
    try {
      accessSync(join(HERE, f), constants.R_OK);
      add(`脚本 ${f}`, 'ok', '存在');
    } catch {
      add(`脚本 ${f}`, 'fail', '缺失');
    }
  }

  // 4. GitHub API + 认证状态
  let token = process.env.GITHUB_TOKEN ?? '';
  if (!token) {
    for (const p of [join(homedir(), '.config', 'dsh-github', 'token'), join(homedir(), '.config', 'github', 'token')]) {
      try {
        token = readFileSync(p, 'utf8').trim();
        if (token) break;
      } catch {}
    }
  }
  try {
    const r = await fetch('https://api.github.com/rate_limit', {
      headers: { 'User-Agent': 'ai-digest-preflight', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (r.ok) {
      const j = await r.json();
      add('GitHub API', 'ok', `可达，限额 ${j.resources.core.limit}/小时，认证${token ? '已启用' : '未启用'}`);
    } else {
      add('GitHub API', 'fail', `返回 ${r.status}`);
    }
  } catch (err) {
    add('GitHub API', 'fail', `不可达：${err.message}（换网络或配代理）`);
  }

  // 5. trending 连通性（可选，被墙是常态，只警告）
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('https://github.com/trending', { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(t);
    if (r.ok) add('GitHub trending', 'ok', '直连可达');
    else add('GitHub trending', 'warn', `返回 ${r.status}，将退回 API 快照`);
  } catch {
    add('GitHub trending', 'warn', '直连不通，将退回 API 快照（不影响出稿）');
  }

  // 6. OneBot（只在需要推 QQ 时检查）
  let delivery = 'chat';
  const cfgFile = process.env.AI_DIGEST_CONFIG ?? join(cfgDir, 'config.json');
  try {
    delivery = JSON.parse(readFileSync(cfgFile, 'utf8')).delivery ?? 'chat';
  } catch {}
  const needQq = args.includes('--qq') || delivery === 'qq';
  if (needQq) {
    const { ok, why } = await tcpCheck('127.0.0.1', 3001);
    if (ok) add('OneBot (3001)', 'ok', '可连接');
    else add('OneBot (3001)', 'fail', `连不上（${why}），推送会失败，请改用 chat 模式`);
  } else {
    add('OneBot (3001)', 'skip', '未启用 QQ 推送，跳过');
  }

  const failed = results.filter((r) => r.level === 'fail');
  if (asJson) {
    console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
  } else {
    const mark = { ok: '✓', warn: '!', fail: '✗', skip: '-' };
    console.log('AI 早报 · 环境自检\n');
    for (const r of results) console.log(`  ${mark[r.level] ?? '?'} ${r.name}: ${r.detail}`);
    console.log('');
    if (failed.length) {
      console.log(`有 ${failed.length} 项阻塞，先解决：${failed.map((f) => f.name).join('、')}`);
    } else {
      console.log('核心依赖齐了，可以继续（标 ! 的只是降级，不影响出稿）。');
    }
  }
  process.exit(failed.length ? 1 : 0);
}

main();
