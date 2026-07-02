export function remoteKindLabel(rawUrl: string | null) {
  if (!rawUrl) return "git";
  const normalized = rawUrl.toLowerCase();
  if (normalized.includes("puppyone")) return "puppyone";
  if (normalized.includes("github.com")) return "GitHub";
  if (normalized.includes("gitlab.com")) return "GitLab";
  if (normalized.includes("bitbucket.org")) return "Bitbucket";
  if (/^[\w.-]+@[\w.-]+:/.test(rawUrl)) return "SSH";
  return "git";
}

export async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard write failed.");
  }
}

export function shortCommit(commitId: string) {
  return commitId.slice(0, 8);
}
