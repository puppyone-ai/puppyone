import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import agent from "../../../locales/renderer/zh-Hans/agent.json";
import automation from "../../../locales/renderer/zh-Hans/automation.json";
import cloud from "../../../locales/renderer/zh-Hans/cloud.json";
import common from "../../../locales/renderer/zh-Hans/common.json";
import editor from "../../../locales/renderer/zh-Hans/editor.json";
import hosts from "../../../locales/renderer/zh-Hans/hosts.json";
import onboarding from "../../../locales/renderer/zh-Hans/onboarding.json";
import plugins from "../../../locales/renderer/zh-Hans/plugins.json";
import settings from "../../../locales/renderer/zh-Hans/settings.json";
import sharedUi from "../../../locales/renderer/zh-Hans/shared-ui.json";
import shell from "../../../locales/renderer/zh-Hans/shell.json";
import sourceControl from "../../../locales/renderer/zh-Hans/source-control.json";
import terminal from "../../../locales/renderer/zh-Hans/terminal.json";
import updates from "../../../locales/renderer/zh-Hans/updates.json";
import workspace from "../../../locales/renderer/zh-Hans/workspace.json";

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
