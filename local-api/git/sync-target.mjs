export function createGitSyncTargetPolicy({ isPuppyoneRemote }) {
  if (typeof isPuppyoneRemote !== "function") {
    throw new TypeError("isPuppyoneRemote must be a function.");
  }

  function isPuppyoneHostingConfig(config) {
    return config?.sync?.sourceOfTruth?.service === "puppyone";
  }

  function choosePuppyoneRemoteName(remotes, config) {
    const configuredRemoteName = config?.sync?.sourceOfTruth?.remote
      ?? config?.git?.primaryRemote
      ?? config?.backup?.remote;
    const configuredRemote = configuredRemoteName
      ? remotes.find((remote) => remote.name === configuredRemoteName) ?? null
      : null;
    if (configuredRemote && isPuppyoneRemote(configuredRemote)) {
      return configuredRemote.name;
    }
    const puppyoneUrlRemote = remotes.find(isPuppyoneRemote);
    if (puppyoneUrlRemote) return puppyoneUrlRemote.name;
    return remotes.find((remote) => remote.name.toLowerCase() === "puppyone")?.name
      ?? null;
  }

  function hasEffectivePuppyoneHostingTarget(remotes, config) {
    // Hosting identity is independent of the current branch's sync destination.
    return Boolean(choosePuppyoneRemoteName(remotes, config));
  }

  function chooseGitSyncTarget(remotes, branches, currentBranchName, config) {
    const branch = normalizeCurrentBranchName(currentBranchName);
    const absent = { remote: null, branch: null };
    if (!branch) return absent; // Detached HEAD requires an explicit destination.
    const current = branches.find((entry) => entry.current && !entry.remote);
    if (current?.upstream) {
      // Remote names can contain slashes. Never reinterpret a removed upstream
      // as permission to choose another remote or fall back to main.
      const remote = [...remotes].sort((a, b) => b.name.length - a.name.length)
        .find((entry) => current.upstream.startsWith(`${entry.name}/`));
      return remote
        ? { remote: remote.name, branch: current.upstream.slice(remote.name.length + 1) }
        : absent;
    }
    const configuredRemote = config?.sync?.sourceOfTruth?.remote
      ?? config?.git?.primaryRemote
      ?? config?.backup?.remote;
    if (configuredRemote) {
      return remotes.some((entry) => entry.name === configuredRemote)
        ? { remote: configuredRemote, branch }
        : absent;
    }
    const remote = choosePuppyoneRemoteName(remotes, config)
      ?? remotes.find((entry) => entry.name === "origin")?.name
      ?? remotes[0]?.name
      ?? null;
    // Workspace-wide watched/default branch settings are not per-operation
    // authorization to publish a newly checked-out branch into another branch.
    return { remote, branch };
  }

  return {
    chooseGitSyncTarget,
    choosePuppyoneRemoteName,
    hasEffectivePuppyoneHostingTarget,
    isPuppyoneHostingConfig,
  };
}

export function normalizeCurrentBranchName(branchName) {
  return branchName && branchName !== "detached" ? branchName : null;
}

export function splitRemoteBranchName(value) {
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= value.length - 1) return null;
  return {
    remote: value.slice(0, slashIndex),
    branch: value.slice(slashIndex + 1),
  };
}
