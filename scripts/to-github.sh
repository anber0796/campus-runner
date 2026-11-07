#!/usr/bin/env bash
#
# 把项目推到 GitHub
#
#   bash scripts/to-github.sh 你的GitHub用户名
#
# 前置条件（两条都得先在网页上做完）：
#   1. 有 GitHub 账号，并把 ~/.ssh/id_ed25519.pub 的内容加到
#      Settings → SSH and GPG keys
#   2. 在 GitHub 上建一个空仓库，名字叫 campus-runner（不要勾选初始化 README）
#
set -uo pipefail

USER_NAME="${1:-}"
if [ -z "$USER_NAME" ]; then
  echo "用法: bash scripts/to-github.sh 你的GitHub用户名"
  exit 1
fi

cd "$(dirname "$0")/.." || exit 1
REPO="git@github.com:${USER_NAME}/campus-runner.git"

echo "== 1/3 检查 SSH 是否已授权 =="
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  echo "✖ SSH 还没通。你需要先把下面这行公钥加到 GitHub："
  echo
  echo "  GitHub → 右上角头像 → Settings → SSH and GPG keys → New SSH key"
  echo
  echo "  $(cat "$HOME/.ssh/id_ed25519.pub" 2>/dev/null || echo '（没找到公钥，先运行 ssh-keygen -t ed25519）')"
  echo
  exit 1
fi
echo "✔ SSH 已授权"

echo
echo "== 2/3 配置远程仓库 =="
git remote remove origin 2>/dev/null
git remote add origin "$REPO"
echo "✔ origin → $REPO"

echo
echo "== 3/3 推送 =="
if ! git push -u origin main; then
  echo
  echo "✖ 推送失败。最常见的原因是远程仓库还没建。"
  echo "  去 https://github.com/new 建一个空仓库，名字填 campus-runner"
  echo "  注意：不要勾选 Add a README / .gitignore / license（否则会冲突）"
  exit 1
fi

echo
echo "✔ 完成：https://github.com/${USER_NAME}/campus-runner"
