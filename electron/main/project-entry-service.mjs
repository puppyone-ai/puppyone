import fs from "node:fs";
import path from "node:path";
import { cloneGitRepository } from "../../local-api/git/runner.mjs";
import { createProjectInitializationService } from "./project-initialization-service.mjs";

const PROJECT_NAME_MAX_LENGTH = 120;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function createProjectEntryService({
  fsPromises = fs.promises,
  pathModule = path,
  cloneGit = cloneGitRepository,
  journalDirectory = null,
} = {}) {
  const initialization = createProjectInitializationService({ journalDirectory });
  return Object.freeze({
    async createProject({ parentPath, name, source = { kind: "blank" }, locale = "en", operationId }) {
      const projectName = requireProjectName(name);
      const canonicalParent = await requireDirectory(parentPath, fsPromises, pathModule);
      const projectPath = resolveChildPath(canonicalParent, projectName, pathModule);
      try {
        const receipt = await initialization.initialize({ parentPath: canonicalParent, name: projectName, source, locale, operationId });
        return { path: projectPath, name: projectName, initialization: receipt };
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw projectEntryError(
            "PROJECT_ALREADY_EXISTS",
            `A file or folder named “${projectName}” already exists in that location.`,
          );
        }
        throw error;
      }
    },

    async cloneRepository({ parentPath, provider = null, repositoryUrl, signal }) {
      const repository = requireGitRepository(repositoryUrl, provider);
      const canonicalParent = await requireDirectory(parentPath, fsPromises, pathModule);
      const projectPath = resolveChildPath(canonicalParent, repository.name, pathModule);
      await requireMissingPath(projectPath, repository.name, fsPromises);

      const temporaryPath = await fsPromises.mkdtemp(
        pathModule.join(canonicalParent, `.puppyone-clone-${repository.name}-`),
      );
      let ownsProjectPath = false;
      try {
        await cloneGit(temporaryPath, repository.url, { signal });
        try {
          // Claim the final path exclusively after the network operation. This
          // prevents rename() from replacing a directory created by another
          // process while the clone was running.
          await fsPromises.mkdir(projectPath, { recursive: false });
          ownsProjectPath = true;
        } catch (error) {
          if (error?.code === "EEXIST") {
            throw projectEntryError(
              "PROJECT_ALREADY_EXISTS",
              `A file or folder named “${repository.name}” already exists in that location.`,
            );
          }
          throw error;
        }
        const entries = await fsPromises.readdir(temporaryPath);
        for (const entry of entries) {
          await fsPromises.rename(
            pathModule.join(temporaryPath, entry),
            pathModule.join(projectPath, entry),
          );
        }
        await fsPromises.rmdir(temporaryPath);
      } catch (error) {
        await fsPromises.rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined);
        if (ownsProjectPath) {
          await fsPromises.rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
        }
        throw normalizeCloneError(error, repository.provider);
      }

      return {
        path: projectPath,
        name: repository.name,
        repositoryUrl: repository.url,
      };
    },
  });
}

export function requireProjectName(value) {
  if (typeof value !== "string") {
    throw projectEntryError("INVALID_PROJECT_NAME", "Enter a project name.");
  }
  const name = value.trim();
  if (!name) throw projectEntryError("INVALID_PROJECT_NAME", "Enter a project name.");
  if (name.length > PROJECT_NAME_MAX_LENGTH) {
    throw projectEntryError(
      "INVALID_PROJECT_NAME",
      `Project names must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`,
    );
  }
  if (
    name === "."
    || name === ".."
    || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name)
    || /[. ]$/.test(name)
    || WINDOWS_RESERVED_NAME.test(name)
  ) {
    throw projectEntryError(
      "INVALID_PROJECT_NAME",
      "Use a project name without slashes, reserved characters, or a trailing period.",
    );
  }
  return name;
}

export function requireGitRepository(value, expectedProvider = null) {
  if (expectedProvider !== null && !getProviderLabel(expectedProvider)) {
    throw projectEntryError(
      "INVALID_REPOSITORY_PROVIDER",
      "Choose GitHub or GitLab as the repository source.",
    );
  }
  const expectedProviderLabel = getProviderLabel(expectedProvider);
  if (typeof value !== "string" || !value.trim()) {
    throw projectEntryError(
      "INVALID_REPOSITORY_URL",
      expectedProviderLabel
        ? `Enter a ${expectedProviderLabel} repository URL.`
        : "Enter a GitHub or GitLab repository URL.",
    );
  }
  const repositoryUrl = value.trim();
  if (/^[\u0000-\u001f\u007f-]/.test(repositoryUrl)) {
    throw invalidRepositoryUrl(expectedProvider);
  }

  const scpMatch = /^git@(github\.com|gitlab\.com):([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+?)(?:\.git)?\/?$/i.exec(repositoryUrl);
  if (scpMatch) {
    const provider = getProviderForHost(scpMatch[1]);
    return buildRepositoryResult({
      repositoryUrl,
      provider,
      expectedProvider,
      segments: scpMatch[2].split("/"),
    });
  }

  let parsed;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    throw invalidRepositoryUrl(expectedProvider);
  }

  const protocolAllowed = parsed.protocol === "https:" || parsed.protocol === "ssh:";
  const provider = getProviderForHost(parsed.hostname);
  const credentialsAllowed = parsed.protocol === "ssh:"
    ? (!parsed.password && (!parsed.username || parsed.username === "git"))
    : !parsed.username && !parsed.password;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    !protocolAllowed
    || !provider
    || !credentialsAllowed
    || parsed.port
    || parsed.search
    || parsed.hash
  ) {
    throw invalidRepositoryUrl(expectedProvider, true);
  }

  return buildRepositoryResult({
    repositoryUrl,
    provider,
    expectedProvider,
    segments,
  });
}

function buildRepositoryResult({ repositoryUrl, provider, expectedProvider, segments }) {
  if (!provider || (expectedProvider && provider !== expectedProvider)) {
    throw invalidRepositoryUrl(expectedProvider, true);
  }
  const segmentCountAllowed = provider === "github"
    ? segments.length === 2
    : segments.length >= 2;
  if (!segmentCountAllowed || segments.some((segment) => (
    !/^[A-Za-z0-9_.-]+$/.test(segment)
    || segment === "."
    || segment === ".."
  ))) {
    throw invalidRepositoryUrl(expectedProvider ?? provider);
  }

  const repositorySegment = segments.at(-1)?.replace(/\.git$/i, "") ?? "";
  const namespaceSegments = segments.slice(0, -1);
  return {
    url: repositoryUrl,
    provider,
    owner: namespaceSegments.join("/"),
    namespace: namespaceSegments.join("/"),
    name: requireRepositoryName(repositorySegment, expectedProvider ?? provider),
  };
}

function requireRepositoryName(value, provider = null) {
  if (!value || !/^[A-Za-z0-9_.-]+$/.test(value) || value === "." || value === "..") {
    throw invalidRepositoryUrl(provider);
  }
  return requireProjectName(value);
}

function getProviderForHost(value) {
  const host = typeof value === "string" ? value.toLowerCase() : "";
  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  return null;
}

function getProviderLabel(provider) {
  if (provider === "github") return "GitHub";
  if (provider === "gitlab") return "GitLab";
  return null;
}

function invalidRepositoryUrl(provider, describeAllowedForm = false) {
  const providerLabel = getProviderLabel(provider);
  const target = providerLabel ? `${providerLabel} repository` : "GitHub or GitLab repository";
  return projectEntryError(
    "INVALID_REPOSITORY_URL",
    describeAllowedForm
      ? `Use an HTTPS or SSH URL for a ${target}.`
      : `Enter a valid ${target} URL.`,
  );
}

async function requireDirectory(value, fsPromises, pathModule) {
  if (typeof value !== "string" || !value.trim()) {
    throw projectEntryError("INVALID_PARENT_DIRECTORY", "Choose a folder for the project.");
  }
  const resolved = pathModule.resolve(value.trim());
  const canonical = await fsPromises.realpath(resolved);
  const stats = await fsPromises.stat(canonical);
  if (!stats.isDirectory()) {
    throw projectEntryError("INVALID_PARENT_DIRECTORY", "Choose a folder for the project.");
  }
  return canonical;
}

function resolveChildPath(parentPath, name, pathModule) {
  const childPath = pathModule.resolve(parentPath, name);
  if (pathModule.dirname(childPath) !== parentPath) {
    throw projectEntryError("INVALID_PROJECT_NAME", "Enter a valid project name.");
  }
  return childPath;
}

async function requireMissingPath(targetPath, projectName, fsPromises) {
  try {
    await fsPromises.lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw projectEntryError(
    "PROJECT_ALREADY_EXISTS",
    `A file or folder named “${projectName}” already exists in that location.`,
  );
}

function normalizeCloneError(error, provider) {
  if (error?.name === "AbortError" || error?.code === "ABORT_ERR") {
    return projectEntryError("CLONE_CANCELLED", "Repository cloning was cancelled.");
  }
  if (typeof error?.code === "string" && error.code.startsWith("PROJECT_")) return error;
  const diagnostic = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  if (/authentication failed|could not read username|permission denied \(publickey\)|terminal prompts disabled/i.test(diagnostic)) {
    const providerLabel = getProviderLabel(provider) ?? "Git provider";
    return projectEntryError(
      "CLONE_AUTHENTICATION_FAILED",
      `${providerLabel} authentication failed. Use an SSH URL with a configured key or sign in with your Git credential helper.`,
    );
  }
  const message = diagnostic
    ? diagnostic.split(/\r?\n/).filter(Boolean).at(-1)
    : error instanceof Error ? error.message : String(error);
  return projectEntryError("CLONE_FAILED", message || "Unable to clone that repository.");
}

function projectEntryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
