// Git configuration is authoritative; only exit 1 means an unset key.
export async function readOptionalGitConfig(execGit, root, key, { all = false } = {}) {
  try {
    return (await execGit(root, ["config", all ? "--get-all" : "--get", key], { optionalLocks: false })).stdout.trim();
  } catch (error) {
    if (error?.code === 1) return null;
    throw error;
  }
}

export async function readGitPullPolicyArgs(execGit, root, branch) {
  const values = await Promise.all([
    `branch.${branch}.rebase`, "pull.rebase", "pull.ff",
    "rebase.autoStash", "merge.autoStash", "pull.autoStash",
  ].map((key) => readOptionalGitConfig(execGit, root, key)));
  // Preserve Desktop's default only when Git has no applicable user policy.
  // In particular --rebase must not override branch.rebase=false or pull.ff=only.
  return [
    ...(values.slice(0, 3).every((value) => value === null) ? ["--rebase"] : []),
    ...(values.slice(3).every((value) => value === null) ? ["--autostash"] : []),
  ];
}

export async function readGitBranchBinding(execGit, root) {
  const branch = (await execGit(root, ["branch", "--show-current"], { optionalLocks: false })).stdout.trim();
  if (!branch) throw new Error("Unable to synchronize changes: current workspace is not on a branch.");
  const [remote, merge, pushRemote, pushDefault] = await Promise.all([
    readOptionalGitConfig(execGit, root, `branch.${branch}.remote`),
    readOptionalGitConfig(execGit, root, `branch.${branch}.merge`, { all: true }),
    readOptionalGitConfig(execGit, root, `branch.${branch}.pushRemote`),
    readOptionalGitConfig(execGit, root, "remote.pushDefault"),
  ]);
  if ((remote !== null || merge !== null)
    && (!remote || !merge?.startsWith("refs/heads/") || merge.includes("\n"))) {
    throw new Error("Unable to synchronize changes: current branch upstream is incomplete or is not a remote branch.");
  }
  const configuredPushRemote = pushRemote ?? pushDefault;
  if (configuredPushRemote !== null && !configuredPushRemote) {
    throw new Error("Unable to synchronize changes: configured push remote is empty.");
  }
  return { branch, remote, destination: merge?.slice("refs/heads/".length) ?? null, pushRemote: configuredPushRemote };
}
