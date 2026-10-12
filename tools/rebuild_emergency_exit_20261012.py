# -*- coding: utf-8 -*-
"""2026-10-12 应急:机场节点池今晚持续轮换,「应急出口」组成员全灭。
体检全部节点,把组成员换成当前实测活口。
文本级行替换(不动 YAML 其余部分,避开 round-trip 丢引号的老坑)。"""
import io, os, re, shutil, json, urllib.parse, urllib.request, concurrent.futures

AUTH = {"Authorization": "Bearer set-your-secret"}
def api(path, timeout=10):
    req = urllib.request.Request("http://127.0.0.1:9097" + path, headers=AUTH)
    return json.load(urllib.request.urlopen(req, timeout=timeout))

proxies = api("/proxies")["proxies"]
nodes = [n for n, p in proxies.items()
         if p.get("type") not in ("Selector", "Fallback", "URLTest", "Direct", "Reject", "RejectDrop", "Compatible", "Pass")
         and n != "GLOBAL"]

def probe(n):
    u = "/proxies/" + urllib.parse.quote(n) + "/delay?url=https://www.gstatic.com/generate_204&timeout=4000"
    try:
        return (api(u, timeout=7).get("delay", 0), n)
    except Exception:
        return None

with concurrent.futures.ThreadPoolExecutor(32) as ex:
    alive = sorted(x for x in ex.map(probe, nodes) if x)
print("alive %d/%d" % (len(alive), len(nodes)))
for d, n in alive[:10]:
    print("%5dms  %s" % (d, n))
if not alive:
    print("NO_ALIVE_NODE, abort")
    sys.exit(1)

top = [n for _, n in alive[:8]]

cfg = os.path.expandvars(r"%APPDATA%\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml")
shutil.copy(cfg, cfg + ".bak-20261012-emergency")
lines = io.open(cfg, encoding="utf-8").read().splitlines(keepends=True)

GROUP = "name: 应急出口"
start = next(i for i, l in enumerate(lines) if l.strip() == GROUP)
pidx = next(i for i in range(start, min(start + 15, len(lines))) if lines[i].strip() == "proxies:")
j = pidx + 1
while j < len(lines) and re.match(r"^\s+-\s", lines[j]):
    j += 1
new_lines = ["  - " + n + "\n" for n in top]
lines[pidx + 1:j] = new_lines
io.open(cfg, "w", encoding="utf-8").write("".join(lines))
print("group members replaced with", len(top), "alive nodes")
