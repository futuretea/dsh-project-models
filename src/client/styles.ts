/** Page styles, scoped by the `dpm-` class prefix and built on the shell's semantic tokens. */
export const STYLES = `
.dpm-page { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 16px 0; }
.dpm-heading { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.dpm-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dpm-error { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }
.dpm-rule { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--dsw-alias-settings-card-fill); border: 1px solid var(--dsw-alias-settings-card-stroke); border-radius: 10px; }
.dpm-rule-head { display: flex; align-items: flex-end; gap: 12px; }
.dpm-rule-head > .dpm-link { padding-bottom: 7px; }
.dpm-grow { flex: 1; min-width: 0; }
.dpm-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dpm-label { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dpm-route { display: flex; gap: 8px; flex-wrap: wrap; }
.dpm-input, .dpm-select { box-sizing: border-box; height: 30px; padding: 0 8px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; min-width: 0; }
.dpm-input { width: 100%; }
.dpm-input[aria-invalid="true"] { border-color: var(--dsw-alias-state-error-primary); }
.dpm-select { flex: 1 1 220px; max-width: 360px; }
.dpm-effort { flex: 0 1 140px; }
.dpm-link { align-self: flex-start; padding: 0; font: inherit; font-size: 12px; color: var(--dsw-alias-link); background: none; border: 0; cursor: pointer; }
.dpm-link:disabled { cursor: default; opacity: .5; }
.dpm-danger { color: var(--dsw-alias-state-error-primary); }
`
