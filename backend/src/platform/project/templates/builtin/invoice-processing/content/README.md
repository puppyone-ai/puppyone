# Receipt & Invoice Processing

A structured context space for an accounting or expense management agent.

## Structure

- **Policies/** — expense policies and approval guidelines
- **Templates/** — standard invoice JSON schemas
- **Inbox/** — folder to connect an email inbox for incoming receipts
- **Processed/** — folder for approved expenses

## How to use

1. Connect a specific email address (e.g. receipts@yourcompany.com) to the Inbox/ folder
2. Create an agent with an MCP tool that extracts data from emails
3. The agent reads the Inbox, parses receipts according to Templates/schema.json, and follows Policies/Expense Policy.md
