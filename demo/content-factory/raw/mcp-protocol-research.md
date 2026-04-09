# Research: Model Context Protocol (MCP)

## Source Summary
- **Anthropic Blog** (2024-11): MCP announcement, open-source protocol
- **GitHub**: modelcontextprotocol/specification (1.2k stars)
- **Hacker News**: 847 points, 234 comments

## Key Facts

### What is MCP?
Model Context Protocol is an open standard for connecting AI assistants to external data sources and tools. Think of it as "USB-C for AI" — one protocol to connect any model to any data source.

### Architecture
- **Host**: The AI application (e.g., Claude Desktop)
- **Client**: Protocol client inside the host
- **Server**: Lightweight service exposing data/tools
- Transport: stdio or HTTP+SSE

### Why It Matters
1. Before MCP: every AI app builds custom integrations (N x M problem)
2. After MCP: build once, connect everywhere (N + M)
3. Open standard — not locked to Anthropic

### Adoption
- Claude Desktop ships with MCP support
- Cursor, Windsurf, Cline adopting
- Community servers: GitHub, Slack, PostgreSQL, Puppeteer, etc.

### Competitive Landscape
| Protocol | Owner | Status |
|----------|-------|--------|
| MCP | Anthropic | Production, open-source |
| Function Calling | OpenAI | Proprietary |
| Tool Use | Google | Limited |

## Raw Quotes
> "MCP is to AI what HTTP was to the web — a shared language that lets everything connect." — Simon Willison

> "We've seen 10x reduction in integration time after adopting MCP." — Cursor team

## Suggested Angle
"Practical guide for developers: how to build your first MCP server in 15 minutes"
