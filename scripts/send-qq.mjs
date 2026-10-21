#!/usr/bin/env node
/**
 * 把一段文本推到 QQ（OneBot v11 WebSocket）。
 *
 * 用法：node send-qq.mjs --user 123456 --file digest.txt [--url ws://127.0.0.1:3001]
 *       echo "文本" | node send-qq.mjs --user 123456
 *
 * 发送失败会以非 0 退出，调用方应该降级到对话内输出，不要静默。
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const userId = Number(arg('user', '0'));
const url = arg('url', process.env.ONEBOT_URL ?? 'ws://127.0.0.1:3001');
const file = arg('file', '');
const CHUNK = 1400;
const TIMEOUT_MS = Number(arg('timeout', '20000'));

if (!userId) {
  console.error('缺少 --user <QQ号>');
  process.exit(2);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

const text = (file ? readFileSync(file, 'utf8') : await readStdin()).trim();
if (!text) {
  console.error('没有可发送的正文');
  process.exit(2);
}

const chunks = [];
for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));

const ws = new WebSocket(url);
let echo = 0;
const pending = new Map();

const timer = setTimeout(() => {
  console.error('连接 OneBot 超时（服务没起？端口不对？）');
  process.exit(1);
}, TIMEOUT_MS);

ws.addEventListener('open', async () => {
  clearTimeout(timer);
  try {
    for (const part of chunks) {
      const id = ++echo;
      ws.send(JSON.stringify({ action: 'send_private_msg', params: { user_id: userId, message: part }, echo: id }));
      const res = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => reject(new Error('发送超时')), TIMEOUT_MS);
      });
      if (res.status !== 'ok') throw new Error(`服务返回 ${res.status}: ${res.retcode ?? ''}`);
      await new Promise((r) => setTimeout(r, 800));
    }
    console.log(`已发送 ${chunks.length} 条，共 ${chunks.reduce((n, c) => n + c.length, 0)} 字`);
    ws.close();
    process.exit(0);
  } catch (err) {
    console.error(`推送失败: ${err.message}`);
    ws.close();
    process.exit(1);
  }
});

ws.addEventListener('message', (ev) => {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    return;
  }
  pending.get(msg.echo)?.resolve(msg);
  pending.delete(msg.echo);
});

ws.addEventListener('error', () => {
  console.error(`无法连接 ${url}`);
  process.exit(1);
});
