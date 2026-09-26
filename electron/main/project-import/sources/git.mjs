/** Fetches a Git source into the caller-owned staging directory. */
export function createGitImportSource({ cloneGit, requireGitRepository }) {
  return Object.freeze({
    async inspect(source) {
      const repository = requireGitRepository(source.repositoryUrl, source.provider);
      return { name: repository.name, source: repository };
    },
    async materialize({ source, stagingPath, signal }) {
      await cloneGit(stagingPath, source.url, { signal });
    },
  });
}
