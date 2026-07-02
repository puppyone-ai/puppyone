import { GitBranch, Server, SquareTerminal } from "lucide-react";
import type { DesktopCloudMcpEndpoint, DesktopCloudRepoIdentity, DesktopCloudScope } from "../../../lib/cloudApi";
import { PageLoading } from "../../../components/loading";
import type { CloudWorkspaceSection } from "../types";
import {
  CloudCommandBlock,
  CloudMcpEndpointCard,
  CloudMethodCard,
  CloudMethodSection,
  CloudPromptBlock,
  CloudWebEmpty,
  CloudWebPage,
} from "../components/shared";
import { getApiBaseFromGitUrl, getScopeDisplayName, profileSlug, shellQuote } from "../utils";

export function CloudMcpCliSection({
  projectId,
  identity,
  scopes,
  mcpEndpoints,
  loading,
  onOpenProject,
}: {
  projectId: string;
  identity: DesktopCloudRepoIdentity | null;
  scopes: DesktopCloudScope[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  loading: boolean;
  onOpenProject: (projectId: string, section?: CloudWorkspaceSection) => void;
}) {
  const rootScope = scopes.find((scope) => scope.is_root) ?? scopes[0] ?? null;
  const apiBase = identity?.url ? getApiBaseFromGitUrl(identity.url) : "";
  const gitUrl = rootScope?.access_key && apiBase ? `${apiBase}/git/ap/${rootScope.access_key}.git` : identity?.url ?? "";
  const scopeName = rootScope ? getScopeDisplayName(rootScope) : "root";
  const profileName = profileSlug(scopeName);
  const cliCommand = rootScope?.access_key && apiBase
    ? `printf '%s' ${shellQuote(rootScope.access_key)} | puppyone ap login ${shellQuote(profileName)} --api-url ${shellQuote(apiBase)} --access-key-stdin`
    : "";

  return (
    <CloudWebPage
      title="MCP / CLI"
      count={loading ? "Loading" : "Ready"}
      action={<button className="desktop-cloud-row-action" type="button" onClick={() => onOpenProject(projectId, "mcp-cli")}>Open Access</button>}
    >
      {loading ? (
        <PageLoading variant="fill" label="Loading" className="desktop-cloud-web-loading" />
      ) : (
        <div className="desktop-cloud-method-page">
          {!rootScope?.access_key && (
            <div className="desktop-cloud-method-warning">
              This scope has no access key issued. Open Access to regenerate one before using CLI or Git.
            </div>
          )}
          <CloudMethodSection title="Puppyone CLI">
            <CloudMethodCard icon={SquareTerminal} subtitle="Direct terminal access" active={Boolean(cliCommand)}>
              <CloudPromptBlock
                value={`Use PuppyOne CLI to read and write ${scopeName} from any terminal. Paste this into Claude Code, Cursor, or your local shell.`}
              />
              <CloudCommandBlock
                label="Login"
                value={cliCommand || "Open Access and regenerate a root scope key."}
                disabled={!cliCommand}
              />
              <CloudCommandBlock
                label="Explore"
                value={`puppyone fs tree / --profile ${shellQuote(profileName)}\npuppyone fs ls / --profile ${shellQuote(profileName)}`}
                disabled={!cliCommand}
              />
            </CloudMethodCard>
          </CloudMethodSection>
          <CloudMethodSection title="Git Remote">
            <CloudMethodCard icon={GitBranch} subtitle="Native Git clone / push" active={Boolean(gitUrl)}>
              <CloudPromptBlock
                value={`This workspace is Git-native. The Cloud remote is the source of truth; desktop stays a local working copy.`}
              />
              <CloudCommandBlock
                label="Existing folder"
                value={`git remote add puppyone ${gitUrl || "<git-url>"}\ngit fetch puppyone`}
                disabled={!gitUrl}
              />
              <CloudCommandBlock
                label="Clone"
                value={`git clone ${gitUrl || "<git-url>"} ${shellQuote(scopeName)}`}
                disabled={!gitUrl}
              />
            </CloudMethodCard>
          </CloudMethodSection>
          <CloudMethodSection title="MCP endpoints">
            {mcpEndpoints.length === 0 ? (
              <CloudWebEmpty icon={Server} title="No MCP endpoint yet" detail="Create an MCP endpoint in Access, then it will appear here." />
            ) : (
              <div className="desktop-cloud-method-endpoint-list">
                {mcpEndpoints.map((endpoint) => (
                  <CloudMcpEndpointCard
                    key={endpoint.id}
                    endpoint={endpoint}
                    apiBase={apiBase}
                    onOpen={() => onOpenProject(projectId, "mcp-cli")}
                  />
                ))}
              </div>
            )}
          </CloudMethodSection>
        </div>
      )}
    </CloudWebPage>
  );
}
