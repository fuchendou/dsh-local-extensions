#!/bin/zsh
set -euo pipefail

label=com.fuchen.personalai.dsh-web-tunnel
domain="gui/$(id -u)"
plist="$HOME/Library/LaunchAgents/$label.plist"

if [[ ! -f "$plist" ]]; then
  print -u2 "未找到 SSH 隧道配置：$plist"
  exit 1
fi
if ! /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then
  /bin/launchctl bootstrap "$domain" "$plist"
fi
/bin/launchctl kickstart "$domain/$label" >/dev/null 2>&1 || true

ready=false
for i in {1..30}; do
  pid=$(/bin/launchctl list | /usr/bin/awk -v label="$label" '$3 == label {print $1}')
  if [[ "$pid" == <-> ]] && /usr/sbin/lsof -nP -a -p "$pid" -iTCP:3080 -sTCP:LISTEN 2>/dev/null | /usr/bin/grep -q '127\.0\.0\.1:3080'; then
    if [[ "$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:3080/)" == 401 ]]; then
      ready=true
      break
    fi
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  print -u2 'SSH 隧道未就绪；请检查 personalai SSH 连接及本机 3080 端口。'
  exit 1
fi

token=$(/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 personalai python3 - <<'PY'
import re
import subprocess

invocation = subprocess.check_output(['systemctl', 'show', 'dsh-web', '-p', 'InvocationID', '--value'], text=True).strip()
log = subprocess.check_output(['sudo', '-n', 'journalctl', f'_SYSTEMD_INVOCATION_ID={invocation}', '-o', 'cat', '--no-pager'], text=True)
tokens = re.findall(r'token=([A-Za-z0-9_-]+)', log)
if not tokens:
    raise SystemExit('无法从当前服务日志获取访问令牌。')
print(tokens[-1])
PY
)
if [[ ! "$token" =~ '^[A-Za-z0-9_-]+$' ]]; then
  print -u2 '服务返回了无效的访问令牌。'
  exit 1
fi
/usr/bin/open "http://127.0.0.1:3080/?token=$token"
print '已在浏览器打开 DSH Web。'
