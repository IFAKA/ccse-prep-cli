# CCSE Prep start-of-day gate. Source this file from ~/.zshrc.
# The mkdir is an atomic cross-shell lock: concurrent zsh startups can only launch one gate.
if [[ -o interactive && -z "${CCSE_GATE_ACTIVE:-}" ]]; then
  _ccse_today="$(date +%Y-%m-%d)"
  _ccse_marker="${XDG_STATE_HOME:-$HOME/.local/state}/ccse-prep/last-gated-day"
  _ccse_lock="${XDG_RUNTIME_DIR:-/tmp}/ccse-prep-gate-${USER:-unknown}-${_ccse_today}.lock"
  if [[ ! -r "${_ccse_marker}" || "$(<"${_ccse_marker}")" != "${_ccse_today}" ]] && mkdir "${_ccse_lock}" 2>/dev/null; then
    trap 'rmdir "${_ccse_lock}" 2>/dev/null' EXIT INT TERM
    if command -v ccse >/dev/null 2>&1; then
      mkdir -p "${_ccse_marker:h}"
      if [[ -n "${TMUX:-}" ]]; then
        _ccse_window="$(tmux list-windows -F '#W' 2>/dev/null | while IFS= read -r _ccse_name; do [[ "${_ccse_name}" == ccse-prep ]] && print -r -- yes && break; done)"
        if [[ "${_ccse_window}" != yes ]]; then
          tmux new-window -d -n ccse-prep 'CCSE_GATE_ACTIVE=1 ccse'
          print -r -- "${_ccse_today}" >| "${_ccse_marker}"
        fi
      else
        export CCSE_GATE_ACTIVE=1
        command ccse
        _ccse_status=$?
        unset CCSE_GATE_ACTIVE
        if (( _ccse_status == 0 )); then print -r -- "${_ccse_today}" >| "${_ccse_marker}"; fi
      fi
    fi
    rmdir "${_ccse_lock}" 2>/dev/null
    trap - EXIT INT TERM
  fi
  unset _ccse_today _ccse_marker _ccse_lock _ccse_window _ccse_status
fi
