export function createWorkspaceCloudRemoteActions({
  execGit,
  getGitErrorOutput,
  getWorkspaceGitStatus,
  mutationTimeoutMs,
  normalizeGitRemoteName,
  normalizeGitRemoteUrl,
  resolveWorkspacePath,
  platform = process.platform,
}) {
  async function configureWorkspaceCloudRemote(
    rootPath,
    remoteUrl,
    remoteName = "puppyone",
    credential = null,
    username = "x-puppyone-token",
  ) {
    const root = resolveWorkspacePath(rootPath, null);
    const normalizedRemoteName = normalizeGitRemoteName(remoteName);
    const normalizedRemoteUrl = normalizeGitRemoteUrl(remoteUrl);
    const isRepo = await execGit(root, ["rev-parse", "--is-inside-work-tree"])
      .then((result) => result.stdout.trim() === "true")
      .catch(() => false);

    if (!isRepo) {
      await execGit(root, ["init"], { timeout: mutationTimeoutMs }).catch((error) => {
        throw new Error(`Unable to initialize repository: ${getGitErrorOutput(error)}`);
      });
    }

    const previousRemoteUrl = await execGit(
      root,
      ["remote", "get-url", normalizedRemoteName],
    ).then((result) => result.stdout.trim()).catch(() => null);
    const remoteExists = Boolean(previousRemoteUrl);
    const args = remoteExists
      ? ["remote", "set-url", normalizedRemoteName, normalizedRemoteUrl]
      : ["remote", "add", normalizedRemoteName, normalizedRemoteUrl];

    let credentialApproved = false;
    try {
      if (credential) {
        await ensureSecureCredentialHelper({ execGit, root, platform });
        await execGit(root, ["credential", "approve"], {
          timeout: mutationTimeoutMs,
          input: credentialInput(normalizedRemoteUrl, username, credential),
        });
        credentialApproved = true;
      }

      await execGit(root, args, { timeout: mutationTimeoutMs });
      if (credential) {
        await execGit(root, ["ls-remote", normalizedRemoteUrl], {
          timeout: mutationTimeoutMs,
        });
      }
    } catch (error) {
      if (credentialApproved) {
        await rejectCredential(execGit, root, normalizedRemoteUrl, username).catch(() => {});
      }
      await restoreRemote(
        execGit,
        root,
        normalizedRemoteName,
        previousRemoteUrl,
        mutationTimeoutMs,
      ).catch(() => {});
      throw new Error(`Unable to configure Cloud remote: ${getGitErrorOutput(error)}`);
    }

    return getWorkspaceGitStatus(root);
  }

  async function removeWorkspaceGitRemote(rootPath, remoteName = "puppyone") {
    const root = resolveWorkspacePath(rootPath, null);
    const normalizedRemoteName = normalizeGitRemoteName(remoteName);
    const remoteUrl = await execGit(root, ["remote", "get-url", normalizedRemoteName])
      .then((result) => result.stdout.trim())
      .catch(() => null);

    if (remoteUrl) {
      await rejectCredential(
        execGit,
        root,
        remoteUrl,
        "x-puppyone-token",
      ).catch(() => {});
      await execGit(root, ["remote", "remove", normalizedRemoteName], {
        timeout: mutationTimeoutMs,
      }).catch((error) => {
        throw new Error(`Unable to remove Cloud remote: ${getGitErrorOutput(error)}`);
      });
    }
    return getWorkspaceGitStatus(root);
  }

  return { configureWorkspaceCloudRemote, removeWorkspaceGitRemote };
}

function credentialInput(remoteUrl, username, password = null) {
  const url = new URL(remoteUrl);
  const fields = [
    `protocol=${url.protocol.slice(0, -1)}`,
    `host=${url.host}`,
    `path=${url.pathname.replace(/^\//, "")}`,
    `username=${username}`,
  ];
  if (password !== null) fields.push(`password=${password}`);
  return `${fields.join("\n")}\n\n`;
}

async function ensureSecureCredentialHelper({ execGit, root, platform }) {
  await execGit(root, ["config", "--local", "credential.useHttpPath", "true"]);
  const configured = await execGit(
    root,
    ["config", "--get-all", "credential.helper"],
  ).then((result) => result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))
    .catch(() => []);
  const isUnsafeHelper = (helper) => /(^|\s)(store|cache)(\s|$)/i.test(helper);
  const secureConfigured = configured.find((helper) => !isUnsafeHelper(helper)) ?? null;
  const unsafeConfigured = configured.some(isUnsafeHelper);
  if (secureConfigured && !unsafeConfigured) return;

  const helper = secureConfigured ?? (platform === "darwin"
    ? "osxkeychain"
    : platform === "win32"
      ? "manager"
      : null);
  if (!helper) {
    throw new Error(
      "No secure Git credential helper is configured. Install Git Credential Manager or libsecret.",
    );
  }

  // An inherited `store` helper would still receive the secret even if a
  // secure helper appears later in Git's helper chain. Reset the inherited
  // chain locally, then opt this repository into exactly one secure helper.
  await execGit(root, ["config", "--local", "--unset-all", "credential.helper"])
    .catch(() => {});
  await execGit(root, ["config", "--local", "--add", "credential.helper", ""]);
  await execGit(root, ["config", "--local", "--add", "credential.helper", helper]);
}

async function rejectCredential(execGit, root, remoteUrl, username) {
  const normalized = new URL(remoteUrl);
  const id = "[A-Za-z0-9][A-Za-z0-9_-]{0,199}";
  const canonicalPath = new RegExp(`^/git/(?:${id}\\.git|${id}/scopes/${id}\\.git)$`);
  if (!canonicalPath.test(normalized.pathname)) {
    return;
  }
  await execGit(root, ["credential", "reject"], {
    input: credentialInput(normalized.toString(), username),
  });
}

async function restoreRemote(execGit, root, remoteName, previousRemoteUrl, timeout) {
  if (previousRemoteUrl) {
    await execGit(root, ["remote", "set-url", remoteName, previousRemoteUrl], { timeout });
    return;
  }
  await execGit(root, ["remote", "remove", remoteName], { timeout }).catch(() => {});
}
