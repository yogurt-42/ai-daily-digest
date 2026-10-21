#!/usr/bin/env bash
# 安全写入 GitHub token：输入不回显、不落 shell 历史、文件 600。
# 可选步骤，不配也能跑（限额 60 次/小时，配了 5000）。
set -euo pipefail

DIR="${HOME}/.config/dsh-github"
mkdir -p "$DIR"
chmod 700 "$DIR"

printf '粘贴 GitHub token 后回车（输入不回显，直接回车跳过）: '
read -rs TOKEN
echo
if [ -z "${TOKEN}" ]; then
  echo "已跳过，稍后想配可以重跑本脚本"
  exit 0
fi

printf '%s' "$TOKEN" >"$DIR/token"
chmod 600 "$DIR/token"
echo "已写入 $DIR/token（600）"
echo "验证：curl -s -H \"Authorization: Bearer \$(cat $DIR/token)\" https://api.github.com/user | head -c 120"
