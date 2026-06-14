import { redirect } from 'next/navigation';

/**
 * Retired: the global tools-and-server page managed MCP servers via a removed
 * API (/api/v1/mcp/* instance routes → 404). MCP endpoints are now managed
 * per-project on the Access page, and tools per-project on the Toolkit page.
 * Redirect any stale link to /home (where a project is picked).
 */
export default function Page() {
  redirect('/home');
}
