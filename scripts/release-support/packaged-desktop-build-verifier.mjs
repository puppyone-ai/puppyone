import fs from "node:fs/promises";
import path from "node:path";
import asarPackage from "@electron/asar";
import plistPackage from "plist";
import {
  assertDesktopBuildInfo,
  getDesktopBuildChannelPolicy,
} from "../../shared/desktop-build-identity.mjs";

import { verifyMacosAppIcon } from "../../tooling/desktop/build/macos-app-icon.mjs";

const { extractFile } = asarPackage;
const { parse: parsePlist } = plistPackage;

export async function verifyPackagedDesktopBuild({
  releaseDirectory,
  buildInfo,
}) {
  const identity = assertDesktopBuildInfo(buildInfo);
  const policy = getDesktopBuildChannelPolicy(identity.channel);
  const entries = await collectReleaseEntries(releaseDirectory);
  const applications = entries.filter((entry) => entry.type === "directory" && entry.path.endsWith(".app"));
  if (applications.length === 0) {
    throw new Error("No packaged macOS application was found for Build Identity verification.");
  }

  for (const application of applications) {
    const applicationBundleName = path.basename(application.path);
    const expectedApplicationBundleName = `${policy.applicationName}.app`;
    if (applicationBundleName.toLocaleLowerCase("en-US")
      !== expectedApplicationBundleName.toLocaleLowerCase("en-US")) {
      throw new Error(
        `Packaged app ${applicationBundleName} must be named ${expectedApplicationBundleName}, ignoring case.`,
      );
    }
    const resourcesDirectory = path.join(application.path, "Contents", "Resources");
    const embeddedBuildInfo = assertDesktopBuildInfo(JSON.parse(
      await fs.readFile(path.join(resourcesDirectory, "build-info.json"), "utf8"),
    ));
    if (JSON.stringify(embeddedBuildInfo) !== JSON.stringify(identity)) {
      throw new Error(`${path.basename(application.path)} embeds a different Build Identity.`);
    }

    const applicationPackage = JSON.parse(
      extractFile(path.join(resourcesDirectory, "app.asar"), "package.json").toString("utf8"),
    );
    if (applicationPackage.version !== identity.version) {
      throw new Error(
        `${path.basename(application.path)} package version ${applicationPackage.version} must equal ${identity.version}.`,
      );
    }

    await verifyMacosAppIcon(application.path);

    const plist = parsePlist(
      await fs.readFile(path.join(application.path, "Contents", "Info.plist"), "utf8"),
    );
    const expectedPlist = {
      CFBundleIdentifier: policy.applicationId,
      CFBundleName: policy.applicationName,
      CFBundleDisplayName: policy.applicationName,
      CFBundleShortVersionString: identity.baseVersion,
      CFBundleVersion: identity.platformBuildNumber ?? identity.baseVersion,
    };
    for (const [key, expected] of Object.entries(expectedPlist)) {
      if (String(plist[key] ?? "") !== expected) {
        throw new Error(
          `${path.basename(application.path)} ${key} must be ${expected}; received ${String(plist[key])}.`,
        );
      }
    }

    const updateConfigurationPath = path.join(resourcesDirectory, "app-update.yml");
    const updateConfiguration = await fs.readFile(updateConfigurationPath, "utf8").catch((error) => {
      if (error?.code === "ENOENT" && !policy.updateFeedUrl) return null;
      throw error;
    });
    if (policy.updateFeedUrl) {
      if (!updateConfiguration?.includes(`url: ${policy.updateFeedUrl}`)) {
        throw new Error(`${path.basename(application.path)} does not embed its canonical update feed.`);
      }
      if (!updateConfiguration.includes(`channel: ${policy.updateChannel}`)) {
        throw new Error(`${path.basename(application.path)} does not embed its canonical update channel.`);
      }
    } else if (updateConfiguration && /desktop\/(?:internal|stable)\//.test(updateConfiguration)) {
      throw new Error("Development builds must not embed an Internal or Stable update feed.");
    }
  }

  const distributableFiles = entries.filter((entry) => (
    entry.type === "file" && (entry.path.endsWith(".dmg") || entry.path.endsWith(".zip"))
  ));
  for (const extension of [".dmg", ".zip"]) {
    const candidates = distributableFiles.filter((entry) => entry.path.endsWith(extension));
    if (candidates.length === 0) throw new Error(`No ${extension} artifact was produced.`);
    for (const candidate of candidates) {
      if (!path.basename(candidate.path).includes(`-${identity.version}-`)) {
        throw new Error(`${path.basename(candidate.path)} does not contain Build Identity version ${identity.version}.`);
      }
    }
  }

  const updaterMetadataName = policy.updateChannel
    ? `${policy.updateChannel}-mac.yml`
    : null;
  const updaterMetadata = entries.filter((entry) => (
    entry.type === "file" && path.basename(entry.path) === updaterMetadataName
  ));
  if (policy.updateFeedUrl) {
    if (updaterMetadata.length === 0) {
      throw new Error(`No ${updaterMetadataName} was produced for a published build.`);
    }
    for (const entry of updaterMetadata) {
      const source = await fs.readFile(entry.path, "utf8");
      if (!source.includes(`version: ${identity.version}`)) {
        throw new Error(`${updaterMetadataName} version does not match Build Identity.`);
      }
    }
  }

  return Object.freeze({
    applications: applications.map((entry) => entry.path),
    distributables: distributableFiles.map((entry) => entry.path),
    updaterMetadata: updaterMetadata.map((entry) => entry.path),
  });
}

async function collectReleaseEntries(releaseDirectory) {
  const entries = [];
  const pending = [path.resolve(releaseDirectory)];
  while (pending.length > 0) {
    const current = pending.pop();
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(current, child.name);
      const type = child.isDirectory() ? "directory" : child.isFile() ? "file" : "other";
      entries.push({ path: childPath, type });
      if (child.isDirectory() && !child.name.endsWith(".app")) pending.push(childPath);
    }
  }
  return entries;
}
