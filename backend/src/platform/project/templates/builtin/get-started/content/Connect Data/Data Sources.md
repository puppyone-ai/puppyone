# Data Sources

PuppyOne can mount data from 14+ external sources. Each connector defines a
**direction** (pull / bidirectional) and a **trigger mode** (manual /
scheduled / real-time) so your context space stays in sync with the outside
world.

## All connectors

### Cloud SaaS (OAuth)

| Connector | Trigger | Becomes |
|-----------|---------|---------|
| **Notion** | Incremental sync | Pages / databases → Markdown / JSON |
| **GitHub** | Incremental sync | Repos / Issues / PRs → JSON |
| **Gmail** | Scheduled polling | Email threads → JSON |
| **Google Calendar** | Scheduled polling | Events → JSON |
| **Google Drive** | Manual / scheduled | Files → Markdown / JSON |
| **Google Docs** | Manual / scheduled | Documents → Markdown |
| **Google Sheets** | Manual / scheduled | Sheets → JSON |
| **Linear** | Manual | Issues / projects → JSON |
| **Airtable** | Full sync | Tables → JSON |
| **PostHog** | Manual | Events / users / insights → JSON |

### Local sources

| Connector | Trigger | Becomes |
|-----------|---------|---------|
| **Folder sync** | Real-time, bidirectional | Local files ↔ content nodes |
| **File upload** | One-time import | PDF / DOCX / images → Markdown |

### Web & API sources

| Connector | Trigger | Becomes |
|-----------|---------|---------|
| **URL crawling** | One-time import | Public web pages → Markdown |
| **Database** | Manual | Database tables → JSON |

## How to add one

### From the dashboard

1. Click **Access** → **Add** → choose a source
2. Complete OAuth or paste an API key
3. Pick the resources to sync (pages / repos / labels / etc.)
4. Click **Start sync**

### From the CLI

```bash
puppyone access add notion <notion-url>
puppyone access add github <repo-url>
puppyone access add gmail
puppyone access add filesystem ~/workspace --name "My Workspace"
puppyone access add posthog --api-key phx_xxx --config '{"project_id":"123","mode":"events"}'
```

After sync completes, the data shows up in your project file tree and is
immediately available to any agent connected to your context.

---

## 📚 Read more

- [All connectors overview](https://puppyone.ai/doc/en/connect)
- [Notion connector](https://puppyone.ai/doc/en/connect/notion)
- [GitHub connector](https://puppyone.ai/doc/en/connect/github)
- [Gmail connector](https://puppyone.ai/doc/en/connect/gmail)
- [Google Drive connector](https://puppyone.ai/doc/en/connect/google-drive)
- [Local folder sync](https://puppyone.ai/doc/en/connect/local-folder)
- [URL / web crawling](https://puppyone.ai/doc/en/connect/urls)
