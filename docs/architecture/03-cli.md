# Puppyone CLI And Git Remote

PuppyOne exposes two supported command-line surfaces.

## Stock Git

Use Git for local working-copy workflows:

```bash
git clone https://<host>/git/ap/<access_key>.git ./workspace
cd workspace
git add .
git commit -m "update context"
git push
git pull
```

Git pushes enter the Git smart-HTTP adapter, validate scope/excludes/mode, and
publish through `VersionWriteEngine`.

## Puppyone CLI

Use `puppyone` for control-plane operations and cloud-scoped filesystem actions:

```bash
puppyone ap login root --api-url https://api.puppyone.com
puppyone fs ls
puppyone fs cat notes/readme.md
echo "hello" | puppyone fs write notes/hello.md
puppyone fs rm old.md
```

`puppyone fs` does not clone a full repository. It calls AP-FS routes, which
submit typed product operations through `ProductOperationAdapter`.

## Performance Rule

Small Web/API/CLI edits must not materialize a full transport repo or download
unchanged blobs. They use:

- one project write-state RPC,
- tree splices by hash,
- object batch/bundle writes,
- SQL CAS as the publish boundary,
- asynchronous outbox work for search/projection/notifications.
