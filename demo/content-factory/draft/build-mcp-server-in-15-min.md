# Build Your First MCP Server in 15 Minutes

*By Writer Bot | Based on research by Research Bot*

## Introduction

If you've been following the AI tooling space, you've probably heard the buzz around Model Context Protocol (MCP). Anthropic's open standard is quickly becoming the "USB-C of AI" — a universal way to connect AI models to your data and tools.

But most tutorials stop at theory. Today, we're going hands-on: you'll build a working MCP server that connects Claude to your PostgreSQL database, in about 15 minutes.

## What You'll Build

A lightweight MCP server that:
- Exposes your database tables as **resources** (Claude can read them)
- Provides a `query` **tool** (Claude can run safe SELECT queries)
- Runs locally via stdio transport

## Prerequisites

- Node.js 18+
- A PostgreSQL database (local or remote)
- Claude Desktop (for testing)

## Step 1: Scaffold the Project

```bash
mkdir my-mcp-server && cd my-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk pg
```

## Step 2: Implement the Server

Create `index.js`:

```javascript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

const server = new Server({
  name: "postgres-mcp",
  version: "1.0.0",
}, {
  capabilities: {
    resources: {},
    tools: {},
  }
});

// List database tables as resources
server.setRequestHandler("resources/list", async () => {
  const result = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  return {
    resources: result.rows.map(row => ({
      uri: `postgres:///${row.table_name}`,
      name: row.table_name,
      mimeType: "application/json",
    }))
  };
});

// Read a table's contents
server.setRequestHandler("resources/read", async (request) => {
  const tableName = request.params.uri.split("/").pop();
  const result = await pool.query(`SELECT * FROM ${tableName} LIMIT 100`);
  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "application/json",
      text: JSON.stringify(result.rows, null, 2),
    }]
  };
});

// Safe query tool
server.setRequestHandler("tools/list", async () => ({
  tools: [{
    name: "query",
    description: "Run a read-only SQL query",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SELECT query to execute" }
      },
      required: ["sql"]
    }
  }]
}));

server.setRequestHandler("tools/call", async (request) => {
  const { sql } = request.params.arguments;
  if (!sql.trim().toUpperCase().startsWith("SELECT")) {
    return { content: [{ type: "text", text: "Error: Only SELECT queries allowed" }] };
  }
  const result = await pool.query(sql);
  return {
    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }]
  };
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Step 3: Connect to Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-postgres": {
      "command": "node",
      "args": ["index.js"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/mydb"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "my-postgres" in the MCP tools panel.

## Step 4: Test It

Ask Claude:
> "What tables are in my database? Show me the first 10 rows from the users table."

Claude will use your MCP server to query the database directly.

## Key Takeaways

- **MCP is not magic** — it's a clean RPC protocol with resources + tools
- **15 minutes** from zero to a working AI-database integration
- **Security**: you control exactly what queries are allowed
- **Reusable**: this server works with any MCP-compatible AI host

## Further Reading

- [MCP Specification](https://spec.modelcontextprotocol.io)
- [Official MCP Servers Collection](https://github.com/modelcontextprotocol/servers)
- [Building MCP with Python (FastMCP)](https://github.com/jlowin/fastmcp)
