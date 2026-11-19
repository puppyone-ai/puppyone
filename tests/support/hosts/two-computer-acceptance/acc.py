"""Two-computer acceptance helpers: each Docker container is one computer."""
import base64
import json
import os
import queue
import subprocess
import threading
import time

API = os.environ.get("ACCEPT_API", "https://qubits-api.puppyone.ai/api/v1")
# Electron userData on Linux is ~/.config/<App>; the host keeps its state in host-service/ under it.
STATE = "/home/test/.config/PuppyOne/host-service"
HOME = os.path.expanduser("~")


def _secrets():
    # A test account ({"email", "password"}) and the deployment's public Supabase URL and anon key.
    account = json.load(open(os.environ.get("ACCEPT_ACCOUNT_FILE", f"{HOME}/.secrets/qubits-e2e-colleague.json")))
    api = json.load(open(os.environ.get("ACCEPT_SUPABASE_FILE", f"{HOME}/.secrets/qubits-supabase-public.json")))
    return {
        "ACCEPT_EMAIL": account["email"], "ACCEPT_PASSWORD": account["password"],
        "ACCEPT_SUPABASE_URL": api["SUPABASE_URL"], "ACCEPT_SUPABASE_ANON": api["SUPABASE_ANON_KEY"],
    }


SECRETS = _secrets()


def sh(*args, check=True, **kw):
    return subprocess.run(list(args), check=check, capture_output=True, text=True, **kw)


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class Computer:
    def __init__(self, name):
        self.name = name
        self.folder = f"/home/test/Shared-{name}"
        self.desktop = None
        self.events = []
        self._lines = queue.Queue()
        self._next = 0

    # --- processes ---------------------------------------------------------
    def env(self):
        return {"ACCEPT_API": API, "ACCEPT_STATE": STATE, "ACCEPT_FOLDER": self.folder, "ACCEPT_NAME": self.name}

    def start_host(self):
        sh("docker", "exec", self.name, "mkdir", "-p", self.folder, STATE)
        envs = sum((["-e", f"{k}={v}"] for k, v in self.env().items()), [])
        sh("docker", "exec", "-d", *envs, self.name, "sh", "-c", "exec node /accept/host-main.mjs >> /home/test/host.log 2>&1")
        for _ in range(50):
            if "started" in sh("docker", "exec", self.name, "sh", "-c", "tail -5 /home/test/host.log", check=False).stdout:
                return
            time.sleep(0.2)
        raise RuntimeError(f"{self.name}: host did not start")

    def host_running(self):
        return sh("docker", "exec", self.name, "pgrep", "-f", "host-main.mjs", check=False).returncode == 0

    def kill_host(self):
        sh("docker", "exec", self.name, "pkill", "-f", "host-main.mjs", check=False)

    def start_desktop(self):
        envs = sum((["-e", f"{k}={v}"] for k, v in self.env().items()), []) + sum((["-e", k] for k in SECRETS), [])
        self.desktop = subprocess.Popen(["docker", "exec", "-i", *envs, self.name, "node", "/accept/driver.mjs"],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", f"{self.name}-driver.log"), "a"),
                                        text=True, env={**os.environ, **SECRETS})
        threading.Thread(target=self._read, args=(self.desktop,), daemon=True).start()
        started = self._wait(lambda m: m.get("event") == "started", 60)
        self.user_id = started["userId"]

    def quit_desktop(self):
        if self.desktop and self.desktop.poll() is None:
            try:
                self.call("quit", timeout=10)
            except Exception:
                pass
            self.desktop.wait(10)
        self.desktop = None

    def _read(self, process):
        for line in process.stdout:
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if "event" in message:
                message["_t"] = time.time()
                self.events.append(message)
            self._lines.put(message)

    def _wait(self, match, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                message = self._lines.get(timeout=max(0.05, deadline - time.monotonic()))
            except queue.Empty:
                break
            if match(message):
                return message
        raise TimeoutError(f"{self.name}: no reply")

    def call(self, command, timeout=60, **args):
        self._next += 1
        request_id = self._next
        self.desktop.stdin.write(json.dumps({"id": request_id, "command": command, **args}) + "\n")
        self.desktop.stdin.flush()
        reply = self._wait(lambda m: m.get("id") == request_id, timeout)
        if not reply["ok"]:
            raise RuntimeError(f"{self.name}.{command}: {reply['error']}")
        return reply["result"]

    def wait_event(self, match, timeout=30, since=0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for event in self.events[since:]:
                if match(event):
                    return event
            time.sleep(0.1)
        raise TimeoutError(f"{self.name}: event not seen")

    # --- the other computer's folder ---------------------------------------
    def remote(self, folder_id, **request):
        reply = self.call("remote", folderId=folder_id, request=request, timeout=90)
        return reply["result"], reply["ms"]

    # --- network and power -------------------------------------------------
    def network(self, up):
        sh("docker", "network", "connect" if up else "disconnect", "accept-net", self.name, check=False)

    def pause(self):
        sh("docker", "pause", self.name)

    def unpause(self):
        sh("docker", "unpause", self.name)

    def restart(self):
        self.quit_desktop()
        sh("docker", "restart", "-t", "5", self.name)


# This repository: its electron/ and shared/ are what each container runs.
DESKTOP = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
IMAGE = "puppyone-host-accept:3"


def start_containers(names=("pc-a", "pc-b")):
    """Fresh computers: each one a Linux user with bubblewrap, no PuppyOne state."""
    here = os.path.dirname(os.path.abspath(__file__))
    sh("docker", "build", "-q", "-t", IMAGE, os.path.join(here, "image"))
    sh("docker", "network", "create", "accept-net", check=False)
    for name in names:
        sh("docker", "rm", "-f", name, check=False)
        sh("docker", "run", "-d", "--name", name, "--hostname", name, "--network", "accept-net",
           "--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined", "--cap-add", "NET_ADMIN",
           "-v", f"{DESKTOP}/electron:/desktop/electron:ro", "-v", f"{DESKTOP}/shared:/desktop/shared:ro",
           "-v", f"{here}:/accept:ro", IMAGE)
    os.makedirs(os.path.join(here, "logs"), exist_ok=True)


def online(catalog, device_id):
    for host in catalog.get("hosts", []):
        if host.get("device_id") == device_id or host.get("id") == device_id:
            return host
    return None
