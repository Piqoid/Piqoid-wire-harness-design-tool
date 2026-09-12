"""Validation report generators — JSON and HTML."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..engine.diagnostic import Diagnostic


def generate_json(diagnostics: "list[Diagnostic]") -> str:
    """Return JSON validation report."""
    return json.dumps(
        [d.as_dict() for d in diagnostics],
        indent=2,
        ensure_ascii=False,
    ) + "\n"


def generate_html(diagnostics: "list[Diagnostic]", harness_name: str = "") -> str:
    """Return self-contained HTML validation report."""
    errors   = [d for d in diagnostics if d.severity == "error"   and not d.waived]
    warnings = [d for d in diagnostics if d.severity == "warning" and not d.waived]
    infos    = [d for d in diagnostics if d.severity == "info"]
    waived   = [d for d in diagnostics if d.waived]

    sev_color = {"error": "#dc2626", "warning": "#d97706", "info": "#2563eb"}
    sev_bg    = {"error": "#fef2f2", "warning": "#fffbeb", "info": "#eff6ff"}

    def rows(diags: list) -> str:
        if not diags:
            return '<tr><td colspan="4" style="color:#94a3b8;padding:8px">None</td></tr>'
        out = []
        for d in sorted(diags, key=lambda x: x.rule_id):
            color = sev_color.get(d.severity, "#374151")
            bg    = sev_bg.get(d.severity, "#fff")
            waiver_note = f' <span style="color:#64748b;font-size:11px">({d.waiver_reason})</span>' if d.waiver_reason else ""
            ents = ", ".join(d.entities[:5])
            if len(d.entities) > 5:
                ents += f" +{len(d.entities)-5}"
            out.append(
                f'<tr style="background:{bg}">'
                f'<td style="padding:6px 10px;font-weight:600;color:{color}">{_h(str(d.severity).upper())}</td>'
                f'<td style="padding:6px 10px;font-family:monospace">{_h(d.rule_id)}</td>'
                f'<td style="padding:6px 10px">{_h(d.message)}{waiver_note}</td>'
                f'<td style="padding:6px 10px;font-family:monospace;font-size:11px;color:#64748b">{_h(ents)}</td>'
                f'</tr>'
            )
        return "\n".join(out)

    title = f"Validation Report — {harness_name}" if harness_name else "Validation Report"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{_h(title)}</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }}
  h1 {{ font-size: 18px; margin-bottom: 4px; }}
  .summary {{ display: flex; gap: 12px; margin: 12px 0 20px; }}
  .badge {{ padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }}
  .err  {{ background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }}
  .warn {{ background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }}
  .info {{ background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }}
  .waiv {{ background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }}
  table {{ width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px;
           overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1); margin-bottom: 24px; }}
  th    {{ text-align: left; padding: 8px 10px; background: #f1f5f9; font-size: 12px;
           color: #64748b; text-transform: uppercase; letter-spacing: .04em; }}
  tr + tr {{ border-top: 1px solid #f1f5f9; }}
</style>
</head>
<body>
<h1>{_h(title)}</h1>
<div class="summary">
  <span class="badge err">{len(errors)} error{'s' if len(errors) != 1 else ''}</span>
  <span class="badge warn">{len(warnings)} warning{'s' if len(warnings) != 1 else ''}</span>
  <span class="badge info">{len(infos)} info</span>
  <span class="badge waiv">{len(waived)} waived</span>
</div>

<h2 style="font-size:15px">Errors</h2>
<table><thead><tr><th>Sev</th><th>Rule</th><th>Message</th><th>Entities</th></tr></thead>
<tbody>{rows(errors)}</tbody></table>

<h2 style="font-size:15px">Warnings</h2>
<table><thead><tr><th>Sev</th><th>Rule</th><th>Message</th><th>Entities</th></tr></thead>
<tbody>{rows(warnings)}</tbody></table>

<h2 style="font-size:15px">Info</h2>
<table><thead><tr><th>Sev</th><th>Rule</th><th>Message</th><th>Entities</th></tr></thead>
<tbody>{rows(infos)}</tbody></table>

<h2 style="font-size:15px">Waived</h2>
<table><thead><tr><th>Sev</th><th>Rule</th><th>Message</th><th>Entities</th></tr></thead>
<tbody>{rows(waived)}</tbody></table>
</body>
</html>"""


def _h(s: str) -> str:
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
    )
