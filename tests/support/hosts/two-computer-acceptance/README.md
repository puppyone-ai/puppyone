# Two-computer acceptance for device folders

Two Docker containers, each one Linux computer with its own PuppyOne Host
service and a Desktop stand-in, signed in as the same person, against a real
deployment (qubits by default). Everything after sign-in is this repository's
code: the host service, its SSH server and sandbox, the remote file and
terminal clients and their SSH client. Replaced for the test: the browser
sign-in (a Supabase password grant), Electron safeStorage and utilityProcess.

```bash
python3 -I tests/support/hosts/two-computer-acceptance/suite.py
```

Needs Docker, a test account file (`ACCEPT_ACCOUNT_FILE`, `{"email","password"}`)
and the deployment's public Supabase URL and anon key (`ACCEPT_SUPABASE_FILE`,
`{"SUPABASE_URL","SUPABASE_ANON_KEY"}`). The two restart checks redeploy the
environment's `device_gateway` and `api` and need its release configuration
(`ACCEPT_RELEASE_CONFIG`); only point them at a test environment.

Checks: catalog, byte-exact previews both ways, edit and conflict, directory
operations and path refusals, watch, latency (with the network round trip
measured separately), Desktop quitting, sandboxed terminal and consent
withdrawal, unsharing, shutdown and restart, sleep, network loss, gateway and
API restarts, device removal. Results go to `logs/results.json`.

Not covered here: the packaged macOS App (signing, keychain, Seatbelt),
real lid-close sleep, and networks other than this machine's.
