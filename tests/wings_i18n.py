"""English UI text for tests that pin it (CI ABGLEICH WG-R3, Etappe 2c).

Wings routes fixed UI text through t() and the wg_ keys in static/i18n.js.
Upstream tests that look for the English text in the source, or run a JS
function in Node without i18n.js, use this instead of the literal:

- en(key, *args): the English text, as t() returns it with the en locale.
- T_EN_JS: a JS prelude that defines t() from the real en locale, for Node
  harnesses (it leaves an existing t alone); T_EN_MJS the same for ES modules.
"""

import json
import pathlib
import shutil
import subprocess
from functools import lru_cache

I18N = pathlib.Path(__file__).parent.parent / "static" / "i18n.js"

T_EN_JS = r"""
const __wgEn = (() => {
  const fs = require('fs'), vm = require('vm');
  const c = {window: {}, document: {documentElement: {}, addEventListener() {}, querySelectorAll: () => []},
    localStorage: {getItem: () => null, setItem() {}}, navigator: {language: 'en'}, console};
  c.globalThis = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync(%s, 'utf8') + ';globalThis.__L = LOCALES;', c);
  return c.__L.en;
})();
if (typeof globalThis.t !== 'function') globalThis.t = (k, ...a) => {
  const v = __wgEn[k];
  if (v === undefined) return k;
  if (typeof v === 'function') return v(...a);
  return a.length ? String(v).replace(/\{(\d+)\}/g, (m, i) => (i in a ? String(a[i]) : m)) : v;
};
""" % json.dumps(str(I18N))

T_EN_MJS = "import { createRequire as __wgCreateRequire } from 'module';\n" + T_EN_JS.replace(
    "const fs = require('fs'), vm = require('vm');",
    "const __wgReq = __wgCreateRequire(import.meta.url), fs = __wgReq('fs'), vm = __wgReq('vm');")


@lru_cache(maxsize=1)
def _en():
    node = shutil.which("node")
    js = T_EN_JS + "console.log(JSON.stringify(Object.fromEntries(Object.entries(__wgEn).filter(([k, v]) => typeof v === 'string'))));"
    out = subprocess.run([node, "-e", js], capture_output=True, text=True, timeout=30, check=True)
    return json.loads(out.stdout)


def en(key, *args):
    text = _en()[key]
    for i, a in enumerate(args):
        text = text.replace("{%d}" % i, str(a))
    return text
