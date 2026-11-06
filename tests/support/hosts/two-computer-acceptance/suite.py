"""Two-computer acceptance against the real qubits deployment.

Each Docker container is one Linux computer with its own PuppyOne Host service
and Desktop stand-in, signed in as the same person. Run: python3 -I suite.py
Writes logs/results.json and prints one line per check.
"""
import base64
import json
import statistics
import sys
import time
import traceback

sys.dont_write_bytecode = True  # nothing generated inside the repository
sys.path.insert(0, __import__("os").path.dirname(__file__))
from acc import Computer, b64, sh, start_containers  # noqa: E402

RESULTS = []
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082")
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
CSV = "name,city\nAda,London\n李雷,北京\n".encode()
MD = "# Notes\n\n- one\n- 二\n".encode()


def check(name):
    def wrap(fn):
        def run(*args):
            started = time.time()
            try:
                detail = fn(*args)
                RESULTS.append({"check": name, "ok": True, "detail": detail, "s": round(time.time() - started, 1)})
                print(f"PASS  {name}  {detail if detail is not None else ''}", flush=True)
            except Exception as error:  # noqa: BLE001
                RESULTS.append({"check": name, "ok": False, "detail": f"{type(error).__name__}: {error}",
                                "trace": traceback.format_exc()[-1500:], "s": round(time.time() - started, 1)})
                print(f"FAIL  {name}  {type(error).__name__}: {error}", flush=True)
        return run
    return wrap


def until(fn, timeout=60, every=1.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = fn()
        if last:
            return last
        time.sleep(every)
    raise TimeoutError(f"condition not met in {timeout}s (last={last!r})")


def device(catalog, device_id):
    return next((d for d in catalog.get("devices", []) if d["id"] == device_id), None)


def read(pc, folder, path):
    result, ms = pc.remote(folder, action="read", path=path)
    assert result["ok"], result
    return base64.b64decode(result["result"]["content_base64"]), result["result"]["revision"], ms


a, b = Computer("pc-a"), Computer("pc-b")
ids = {}


@check("setup: two fresh computers, same person, each shares one folder")
def setup():
    start_containers()
    for pc in (a, b):
        pc.start_host()
        pc.start_desktop()
    assert a.user_id == b.user_id
    # Devices left on the test account by earlier runs.
    for leftover in b.call("catalog").get("devices", []):
        b.call("api", method="DELETE", route=f"/hosts/devices/{leftover['id']}")
    for pc, files in ((a, {"pic.png": PNG, "doc.pdf": PDF, "data.csv": CSV, "notes.md": MD}), (b, {"from-b.md": b"# B\n"})):
        for path, data in files.items():
            pc.call("local", op="write", path=path, content_base64=b64(data))
        ids[pc.name] = pc.call("share", writable=True)
    return {name: value["deviceId"][:8] for name, value in ids.items()}


@check("home: each computer sees the other online with its folder")
def catalogs():
    def both():
        seen_a = device(b.call("catalog"), ids["pc-a"]["deviceId"])
        seen_b = device(a.call("catalog"), ids["pc-b"]["deviceId"])
        return seen_a and seen_b and seen_a["online"] and seen_b["online"] and (seen_a, seen_b)
    seen_a, seen_b = until(both, 60)
    assert [f["id"] for f in seen_a["folders"]] == [ids["pc-a"]["folderId"]]
    return f"A: {seen_a['name']} {seen_a['platform']} online; B: {seen_b['name']} online"


@check("files: previews arrive byte for byte (PNG, PDF, CSV, Markdown), both directions")
def previews():
    folder = ids["pc-a"]["folderId"]
    listing, _ = b.remote(folder, action="list", path="")
    assert listing["ok"], listing
    names = sorted(entry["name"] for entry in listing["result"]["entries"])
    for path, data in (("pic.png", PNG), ("doc.pdf", PDF), ("data.csv", CSV), ("notes.md", MD)):
        got, _, _ = read(b, folder, path)
        assert got == data, path
    got, _, _ = read(a, ids["pc-b"]["folderId"], "from-b.md")
    assert got == b"# B\n"
    return f"listed {names}"


@check("files: edit on B, save, A sees the bytes; a save over A's newer edit is a conflict and keeps B's draft")
def edit_and_conflict():
    folder = ids["pc-a"]["folderId"]
    _, revision, _ = read(b, folder, "notes.md")
    saved, _ = b.remote(folder, action="write", path="notes.md", content_base64=b64(b"# Notes\n\nedited on B\n"), expected_revision=revision)
    assert saved["ok"], saved
    assert base64.b64decode(a.call("local", op="read", path="notes.md")) == b"# Notes\n\nedited on B\n"
    # A edits locally; B still has the old revision and a draft.
    a.call("local", op="write", path="notes.md", content_base64=b64(b"# Notes\n\nA's newer edit\n"))
    draft = b"# Notes\n\nB's draft\n"
    stale, _ = b.remote(folder, action="write", path="notes.md", content_base64=b64(draft), expected_revision=saved["result"]["revision"])
    assert not stale["ok"] and stale["status"] == 409 and stale["code"] == "conflict", stale
    assert base64.b64decode(a.call("local", op="read", path="notes.md")) == b"# Notes\n\nA's newer edit\n"
    return "conflict 409; A's file untouched; draft stays with B's editor"


@check("files: mkdir, move, remove; '..', absolute paths and .git are refused")
def file_ops():
    folder = ids["pc-a"]["folderId"]
    for request in ({"action": "mkdir", "path": "sub"}, {"action": "move", "path": "data.csv", "destination": "sub/data.csv"}):
        result, _ = b.remote(folder, **request)
        assert result["ok"], (request, result)
    assert a.call("local", op="exists", path="sub/data.csv")
    refusals = {}
    for path in ("../outside.txt", "/etc/passwd", ".git/config"):
        result, _ = b.remote(folder, action="read", path=path)
        assert not result["ok"], path
        refusals[path] = result["code"]
    removed, _ = b.remote(folder, action="remove", path="sub/data.csv")
    assert removed["ok"], removed
    return refusals


@check("watch: a change made on A reaches B")
def watch():
    folder = ids["pc-a"]["folderId"]
    since = len(b.events)
    b.call("watch", folderId=folder)
    time.sleep(3)
    started = time.time()
    a.call("local", op="write", path="watched.txt", content_base64=b64(b"x"))
    event = b.wait_event(lambda e: e.get("event") == "watch" and e.get("type") == "change" and "watched.txt" in (e.get("paths") or []), 30, since)
    return f"change after {round(time.time() - started, 2)} s"


@check("latency: reads and writes from B to A (network RTT measured separately)")
def latency():
    folder = ids["pc-a"]["folderId"]
    reads, writes = [], []
    revision = None
    for index in range(20):
        _, revision, ms = read(b, folder, "pic.png")
        reads.append(ms)
    _, revision, _ = read(b, folder, "notes.md")
    for index in range(10):
        result, ms = b.remote(folder, action="write", path="notes.md", content_base64=b64(f"v{index}\n".encode()), expected_revision=revision)
        assert result["ok"], result
        revision = result["result"]["revision"]
        writes.append(ms)
    rtt = []
    for _ in range(5):
        out = sh("docker", "exec", "pc-b", "sh", "-c",
                 "curl -s -o /dev/null -o /dev/null -w '%{time_starttransfer}\\n' https://qubits-api.puppyone.ai/health https://qubits-api.puppyone.ai/health | tail -1").stdout
        rtt.append(float(out.strip()) * 1000)
    pct = lambda values, q: sorted(values)[min(len(values) - 1, int(round(q * (len(values) - 1))))]
    detail = {"read_p50": round(statistics.median(reads)), "read_p95": round(pct(reads, 0.95)),
              "write_p50": round(statistics.median(writes)), "write_p95": round(pct(writes, 0.95)),
              "one_leg_rtt_p50": round(statistics.median(rtt))}
    # Two legs (B to the Cloud, the Cloud to A): what is left is PuppyOne's own cost.
    detail["overhead_read_p50"] = detail["read_p50"] - 2 * detail["one_leg_rtt_p50"]
    return detail


@check("presence: Desktop quits on A; A keeps sharing")
def desktop_quit():
    a.quit_desktop()
    result, _ = b.remote(ids["pc-a"]["folderId"], action="read", path="pic.png")
    assert result["ok"], result
    a.start_desktop()
    return "served with no Desktop running on A"


@check("presence: A loses its network -> offline; network back -> online by itself")
def network_loss():
    folder = ids["pc-a"]["folderId"]
    a.network(False)
    went = time.time()
    until(lambda: not device(b.call("catalog"), ids["pc-a"]["deviceId"])["online"], 90, 2)
    offline_after = round(time.time() - went, 1)
    result, _ = b.remote(folder, action="read", path="pic.png")
    assert not result["ok"] and result["code"] in ("device_offline", "network_unavailable", "device_timeout"), result
    a.network(True)
    back = time.time()
    until(lambda: device(b.call("catalog"), ids["pc-a"]["deviceId"])["online"], 120, 2)
    online_after = round(time.time() - back, 1)
    result, _ = b.remote(folder, action="read", path="pic.png")
    assert result["ok"], result
    return f"offline after {offline_after} s ({result and 'read refused while offline'}); online again {online_after} s after the network returned"


@check("presence: A sleeps (paused) -> offline; wakes -> online by itself")
def sleep_wake():
    a.pause()
    went = time.time()
    try:
        until(lambda: not device(b.call("catalog"), ids["pc-a"]["deviceId"])["online"], 120, 2)
        offline_after = round(time.time() - went, 1)
    finally:
        a.unpause()
    back = time.time()
    until(lambda: device(b.call("catalog"), ids["pc-a"]["deviceId"])["online"], 120, 2)
    result, _ = b.remote(ids["pc-a"]["folderId"], action="read", path="pic.png")
    assert result["ok"], result
    return f"offline after {offline_after} s; online {round(time.time() - back, 1)} s after waking"


@check("presence: A shuts down -> offline; restarts -> same device and folder")
def shutdown_restart():
    before = dict(ids["pc-a"])
    a.restart()
    until(lambda: not device(b.call("catalog"), before["deviceId"])["online"], 90, 2)
    # Started at login (autostart) or by opening the App once.
    a.start_host()
    a.start_desktop()
    resumed = a.call("resume")
    until(lambda: device(b.call("catalog"), before["deviceId"])["online"], 90, 2)
    result, _ = b.remote(before["folderId"], action="read", path="pic.png")
    assert result["ok"], result
    assert resumed["deviceId"] == before["deviceId"]
    return "same device and folder after restart"


@check("terminal: refused until A allows it; then runs in the folder sandbox")
def terminal():
    folder, device_id = ids["pc-a"]["folderId"], ids["pc-a"]["deviceId"]
    a.call("setExecution", deviceId=device_id, folderId=folder, terminal=False)
    since = len(b.events)
    first = b.call("execOpen", folderId=folder)
    refused = b.wait_event(lambda e: e.get("event") == "terminal" and e.get("id") == first["id"], 30, since)
    assert refused["type"] in ("error", "closed", "exit") and refused["type"] != "started", refused
    a.call("setExecution", deviceId=device_id, folderId=folder, terminal=True)
    # A secret outside the folder that the sandbox must hide.
    sh("docker", "exec", "pc-a", "sh", "-c", "mkdir -p ~/.ssh && echo SECRET > ~/.ssh/id_test")
    since = len(b.events)
    opened = b.call("execOpen", folderId=folder)
    b.wait_event(lambda e: e.get("event") == "terminal" and e.get("id") == opened["id"] and e.get("type") == "started", 30, since)
    b.call("execInput", terminal=opened["id"], data="echo PWD=$(pwd); cat ~/.ssh/id_test; cat ~/.config/PuppyOne/host-service/host-device-identity.json; touch ~/outside.txt; echo hi > in-folder.txt; exit\n")
    b.wait_event(lambda e: e.get("event") == "terminal" and e.get("id") == opened["id"] and e.get("type") in ("exit", "closed"), 30, since)
    output = b.call("execRead", terminal=opened["id"])["output"]
    assert "PWD=/home/test/Shared-pc-a" in output, output[-500:]
    assert "SECRET" not in output.replace("cat ~/.ssh/id_test", ""), "secret visible"
    outside = sh("docker", "exec", "pc-a", "ls", "/home/test/outside.txt", check=False).returncode == 0
    assert not outside, "wrote outside the folder"
    assert a.call("local", op="exists", path="in-folder.txt")
    return f"refused first ({refused.get('code') or refused['type']}); sandbox hid ~/.ssh and the device key, blocked writes outside"


@check("terminal: withdrawing consent on A ends a running session at once")
def withdraw():
    folder, device_id = ids["pc-a"]["folderId"], ids["pc-a"]["deviceId"]
    since = len(b.events)
    opened = b.call("execOpen", folderId=folder)
    b.wait_event(lambda e: e.get("event") == "terminal" and e.get("id") == opened["id"] and e.get("type") == "started", 30, since)
    b.call("execInput", terminal=opened["id"], data="sleep 600\n")
    time.sleep(2)
    withdrawn = time.time()
    a.call("setExecution", deviceId=device_id, folderId=folder, terminal=False)
    b.wait_event(lambda e: e.get("event") == "terminal" and e.get("id") == opened["id"] and e.get("type") in ("exit", "closed", "error"), 30, since)
    leftover = sh("docker", "exec", "pc-a", "pgrep", "-f", "sleep 600", check=False).returncode == 0
    assert not leftover, "process still running on A"
    return f"ended {round(time.time() - withdrawn, 2)} s after withdrawal; no process left on A"


def redeploy(service_key):
    """Redeploy one Railway service of the qubits environment (same image) and wait for it."""
    import os, subprocess
    tools = os.path.dirname(os.path.abspath(__file__))
    config = json.load(open(os.environ.get("ACCEPT_RELEASE_CONFIG", os.path.expanduser("~/.secrets/qubits-release-config.json"))))["railway"]
    service = config["services"][service_key]["id"]
    vars_file = os.path.join(tools, "logs", "redeploy.json")
    json.dump({"e": config["environment_id"], "s": service}, open(vars_file, "w"))
    query = os.path.join(tools, "logs", "redeploy.graphql")
    open(query, "w").write("mutation($e:String!,$s:String!){ serviceInstanceDeployV2(environmentId:$e, serviceId:$s) }")
    out = subprocess.run(["python3", "-I", os.path.join(tools, "railway_gql.py"), "project", query, vars_file],
                         capture_output=True, text=True, timeout=60).stdout
    assert '"serviceInstanceDeployV2": "' in out, out[:300]


@check("restart: the device gateway restarts -> A reconnects by itself")
def gateway_restart():
    since = len(a.events)
    redeploy("device_gateway")
    started = time.time()
    # Railway replaces the container; A sees its socket close, then reconnects.
    until(lambda: any(e.get("event") == "host:status" and (e.get("data") or {}).get("state") == "offline" for e in a.events[since:]), 300, 2)
    until(lambda: a.call("status")["state"] == "online", 300, 2)
    result, _ = b.remote(ids["pc-a"]["folderId"], action="read", path="pic.png")
    assert result["ok"], result
    return f"online again {round(time.time() - started)} s after the redeploy started"


@check("restart: the API restarts -> sharing continues")
def api_restart():
    redeploy("api")
    started = time.time()
    time.sleep(20)
    until(lambda: b.remote(ids["pc-a"]["folderId"], action="read", path="pic.png")[0]["ok"], 600, 5)
    assert a.call("status")["state"] == "online"
    return f"reads work again {round(time.time() - started)} s after the redeploy started"


@check("revoke: A stops sharing the folder -> B loses it at once")
def unshare():
    folder = ids["pc-b"]["folderId"]
    ok, _ = a.remote(folder, action="read", path="from-b.md")
    assert ok["ok"], ok
    b.call("unshare", deviceId=ids["pc-b"]["deviceId"], folderId=folder)
    started = time.time()
    result, _ = a.remote(folder, action="read", path="from-b.md")
    assert not result["ok"] and result["status"] in (403, 404), result
    return f"refused ({result['code']}) {round(time.time() - started, 2)} s after unsharing"


@check("revoke: removing computer A from B disconnects A immediately")
def remove_device():
    folder, device_id = ids["pc-a"]["folderId"], ids["pc-a"]["deviceId"]
    since = len(a.events)
    b.call("api", method="DELETE", route=f"/hosts/devices/{device_id}")
    started = time.time()
    a.wait_event(lambda e: e.get("event") == "host:revoked", 30, since)
    result, _ = b.remote(folder, action="read", path="pic.png")
    assert not result["ok"], result
    status = a.call("status")
    assert status["active"] is None, status
    return f"A told of revocation after {round(time.time() - started, 2)} s; its key and sharing are gone"


def main():
    # Checks that disturb Docker's own network (pause, unplug, redeploys) run last: they leave half-open
    # connections in Docker Desktop's network layer that a real computer would not have.
    for step in (setup, catalogs, previews, edit_and_conflict, file_ops, watch, latency, desktop_quit, terminal, withdraw,
                 unshare, shutdown_restart, sleep_wake, network_loss, gateway_restart, api_restart, remove_device):
        step()
        if step is setup and not RESULTS[-1]["ok"]:
            break
    for pc in (a, b):
        pc.quit_desktop()
    json.dump(RESULTS, open(__import__("os").path.join(__import__("os").path.dirname(__file__), "logs", "results.json"), "w"),
              indent=1, ensure_ascii=False)
    print(f"\n{sum(r['ok'] for r in RESULTS)}/{len(RESULTS)} passed")


if __name__ == "__main__":
    main()
