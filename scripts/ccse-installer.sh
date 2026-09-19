#!/bin/sh
set -eu

REPO_URL="${CCSE_REPO_URL:-https://github.com/IFAKA/ccse-prep-cli}"
REPO_BRANCH="${CCSE_REPO_BRANCH:-master}"
INSTALL_ROOT="${CCSE_INSTALL_ROOT:-${HOME}/.local/share/ccse-prep-cli}"
APP_DIR="${INSTALL_ROOT}/app"
BIN_DIR="${CCSE_BIN_DIR:-${HOME}/.local/bin}"
BIN_PATH="${BIN_DIR}/ccse"
DATA_DIR="${CCSE_DATA_DIR:-${HOME}/.local/share/ccse-prep}"

say() { printf '%s\n' "$*"; }
fail() { say "✗ $*" >&2; exit 1; }

usage() {
  say "CCSE Prep CLI installer"
  say ""
  say "Usage:"
  say "  install.sh              Install or reinstall CCSE Prep CLI"
  say "  install.sh uninstall    Remove the app and command"
  say "  install.sh status       Show installation paths"
  say ""
  say "Study data is preserved when uninstalling."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

install_app() {
  require_command node
  require_command npm
  require_command curl
  require_command tar

  node_major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$node_major" -ge 18 ] 2>/dev/null || fail "Node.js 18 or newer is required (found $(node --version))."

  temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/ccse-install.XXXXXX")
  cleanup() { rm -rf "$temporary_root"; }
  trap cleanup EXIT INT TERM

  say "CCSE Prep CLI installer"
  say "───────────────────────"
  say "✓ Node.js $(node --version)"
  say "↓ Downloading project release (${REPO_BRANCH})"
  archive_path="${temporary_root}/ccse.tar.gz"
  curl -fsSL "${REPO_URL}/archive/refs/heads/${REPO_BRANCH}.tar.gz" -o "$archive_path" || fail "Could not download the project release."
  tar -xzf "$archive_path" -C "$temporary_root" || fail "Could not unpack the project release."
  source_dir="${temporary_root}/ccse-prep-cli-${REPO_BRANCH}"
  [ -d "$source_dir" ] || fail "Downloaded release has an unexpected layout."

  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR" "$BIN_DIR"
  cp -R "$source_dir/bin" "$source_dir/data" "$source_dir/src" "$source_dir/scripts" "$source_dir/package.json" "$source_dir/package-lock.json" "$APP_DIR/"
  (cd "$APP_DIR" && npm ci --omit=dev --ignore-scripts >/dev/null) || fail "Dependency installation failed."
  chmod +x "$APP_DIR/bin/ccse.mjs"

  if [ -e "$BIN_PATH" ] && [ ! -L "$BIN_PATH" ]; then
    fail "$BIN_PATH already exists and is not managed by CCSE."
  fi
  rm -f "$BIN_PATH"
  ln -s "$APP_DIR/bin/ccse.mjs" "$BIN_PATH"

  say "✓ Installed application at $APP_DIR"
  say "✓ Installed command at $BIN_PATH"
  say "↓ Checking the latest question bank"
  set +e
  bank_output=$(CCSE_DATA_DIR="$DATA_DIR" "$BIN_PATH" --update-bank 2>&1)
  bank_status=$?
  set -e
  if [ "$bank_status" -eq 0 ]; then
    printf '%s\n' "$bank_output" | sed 's/^/  /'
  else
    say "  ! Latest bank unavailable; bundled bank remains available offline."
  fi

  say ""
  say "Installation complete."
  say "✓ 300-question CCSE bank with validation and safe fallback"
  say "✓ Automatic refresh: monthly, daily in December and January"
  say "✓ Offline study sessions with local progress storage"
  say "✓ Adaptive review, mock exams, countdown, and resume support"
  say ""
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) say "Run now: ccse" ;;
    *) say "Run now: ${BIN_PATH}"; say "For future terminals: export PATH=\"${BIN_DIR}:\$PATH\"" ;;
  esac
  say "Inspect status: ${BIN_PATH} --bank-info"
  say "Start studying: ${BIN_PATH}"
  say "Automatic start: source \"${APP_DIR}/scripts/ccse-shell-gate.zsh\" from ~/.zshrc"
  say "Uninstall app: $0 uninstall"
  say "Study data is preserved at $DATA_DIR"
}

uninstall_app() {
  if [ -L "$BIN_PATH" ] && [ "$(readlink "$BIN_PATH")" = "$APP_DIR/bin/ccse.mjs" ]; then
    rm -f "$BIN_PATH"
    say "✓ Removed command $BIN_PATH"
  elif [ -e "$BIN_PATH" ]; then
    fail "$BIN_PATH is not managed by CCSE; leaving it untouched."
  else
    say "✓ Command was already absent"
  fi
  rm -rf "$INSTALL_ROOT"
  say "✓ Removed application files"
  say "✓ Preserved study data at $DATA_DIR"
  say "Uninstall complete."
}

status_app() {
  if [ -L "$BIN_PATH" ] && [ "$(readlink "$BIN_PATH")" = "$APP_DIR/bin/ccse.mjs" ]; then
    say "Installed: yes"
    say "Application: $APP_DIR"
    say "Command: $BIN_PATH"
    say "Study data: $DATA_DIR"
  else
    say "Installed: no"
    say "Expected command: $BIN_PATH"
  fi
}

case "${1:-install}" in
  install) install_app ;;
  uninstall) uninstall_app ;;
  status) status_app ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
