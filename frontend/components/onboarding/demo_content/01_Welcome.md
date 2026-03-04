# Welcome to PuppyOne

**The cloud file system built for AI Agents.**

PuppyOne unifies your scattered data from Notion, GitHub, Gmail, Airtable, local files, and more into a single context space designed for multi-agent collaboration. Connect any agent to this one space, and it instantly accesses all your context.

## What Problems Do We Solve?

### 1. Data is scattered; Agents can't see the full picture.
Your data might be in 30 different places: product specs in Notion, code in GitHub, customer info in Airtable, pricing in Google Sheets, plus piles of PDFs and Word docs locally. Every time you want an Agent to use this data, you have to connect it all over again.

### 2. Different Agents need different permissions; configuration is a mess.
A Support Agent should read product catalogs but not change prices; a Dev Agent needs to edit specs; a Sales Agent can view quotes but not delete customer records. You need fine-grained, centralized, scenario-based access control — not just "all or nothing."

### 3. Every Agent connects differently; maintenance is expensive.
Cursor needs MCP, backend scripts use REST APIs, real-time scenarios require SSE, and complex tasks need Agents running code in a sandbox. You need unified logging and monitoring for every connection: Which context was accessed? What was the query? When did it happen? Was it successful?

---

## How PuppyOne Solves This

### Connect
PuppyOne's answer is a **cloud folder**. Whether your data comes from Notion, GitHub, Airtable, or local PDFs, once connected to PuppyOne, they all become files in this folder.
- Notion pages → Markdown
- GitHub repos → Code directories
- Airtable bases → Structured documents

For your Agent, the world is now just **one single folder**, not 30 different SaaS silos.

### Collaborate
PuppyOne provides a complete infrastructure for human-agent collaboration:
- **Version history** — every change is tracked with full audit trail
- **Access control** — fine-grained permissions for users and agents
- **MCP protocol** — any MCP-compatible agent can read/write natively
- **Sandbox execution** — agents can run code in isolated environments
- **Real-time sync** — changes propagate instantly across all consumers
