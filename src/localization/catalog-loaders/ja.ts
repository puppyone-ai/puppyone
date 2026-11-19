import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import agent from "../../../locales/renderer/ja/agent.json";
import automation from "../../../locales/renderer/ja/automation.json";
import cloud from "../../../locales/renderer/ja/cloud.json";
import common from "../../../locales/renderer/ja/common.json";
import editor from "../../../locales/renderer/ja/editor.json";
import hosts from "../../../locales/renderer/ja/hosts.json";
import onboarding from "../../../locales/renderer/ja/onboarding.json";
import plugins from "../../../locales/renderer/ja/plugins.json";
import settings from "../../../locales/renderer/ja/settings.json";
import sharedUi from "../../../locales/renderer/ja/shared-ui.json";
import shell from "../../../locales/renderer/ja/shell.json";
import sourceControl from "../../../locales/renderer/ja/source-control.json";
import terminal from "../../../locales/renderer/ja/terminal.json";
import updates from "../../../locales/renderer/ja/updates.json";
import workspace from "../../../locales/renderer/ja/workspace.json";

export default mergeCatalogNamespaces({
  "agent": agent,
  "automation": automation,
  "cloud": cloud,
  "common": common,
  "editor": editor,
  "hosts": hosts,
  "onboarding": onboarding,
  "plugins": plugins,
  "settings": settings,
  "shared-ui": sharedUi,
  "shell": shell,
  "source-control": sourceControl,
  "terminal": terminal,
  "updates": updates,
  "workspace": workspace,
});
