# Welcome to PuppyOne!

**The Context Base for AI Agents.**

A centralized, structured, and scalable context library. PuppyOne unifies your scattered data from Notion, GitHub, Airtable, and local files into a single context base designed for multi-agent collaboration. Connect any agent to this one library, and it instantly accesses all your context.

## What Problems Do We Solve?

### 1. Data is scattered; Agents can't see the full picture.
Your data might be in 30 different places: product specs in Notion, code in GitHub, customer info in Airtable, pricing in Google Sheets, plus piles of PDFs and Word docs locally. Every time you want an Agent to use this data, you have to connect it all over again.

### 2. Different Agents need different permissions; configuration is a mess.
A Support Agent should read product catalogs but not change prices; a Dev Agent needs to edit specs; a Sales Agent can view quotes but not delete customer records. You need fine-grained, centralized, scenario-based access control—not just "all or nothing."

### 3. Every Agent connects differently; maintenance is expensive.
Cursor needs MCP, backend scripts use REST APIs, real-time scenarios require SSE, and complex tasks need Agents running code in a sandbox. You need unified logging and monitoring for every connection: Which context was accessed? What was the query? When did it happen? Was it successful?

---

## How PuppyOne Solves This

We boil everything down to one thing: **Giving Agents a unified context library they can understand.**

### 🌐 One Unified Folder
PuppyOne's answer is a **Cloud Folder**. Whether your data comes from Notion, GitHub, Airtable, or local PDFs, once connected to PuppyOne, they all become files in this folder.
- Notion pages → Markdown
- GitHub repos → Code directories
- Airtable bases → Structured documents

For your Agent, the world is now just **one single folder**, not 30 different SaaS silos.

### 🛡️ Secure Sandbox & Granular Control
We provide a dedicated **Sandbox** for every Agent. You manage permissions just like a local file system:
- Support Agent can read `/product_docs` but can't see `/finance`.
- Dev Agent can write to `/specs`.
- Sales Agent can view `/quotes` but cannot delete.

Agents can not only "read" these files but also run Bash commands to organize them or execute code to process data within the sandbox—isolated, secure, and boundary-checked.

### 📊 Unified Monitoring
Whether your Agent connects via MCP (Cursor), REST API (scripts), or runs automated tasks in the sandbox, all requests go through a unified interface. You get a single view of all activity: Which Agent accessed which file, the query, the timestamp, and the result.

---

👇 **Follow the guide below (02-04) to start building your Context Base.**
