/** Pure projection. Missing evidence must never become an installation claim. */
export function adviseSetup({ registry, platform, request, installations, companions, now, sessionSuppressed }) {
  const environmentHealthy = !installations.results.some(({ reasonCode }) =>
    reasonCode === "environment-unavailable" || reasonCode === "context-error");
  return registry.filter((route) => route.platforms.includes(platform)
    && request.eligibleInstallationIds.includes(route.installationId)).map((route) => {
    const observed = installations.results.find(({ agentId }) => agentId === route.installationId);
    const status = observed?.status === "found" ? "found"
      : environmentHealthy && observed?.status === "not-found" ? "not-found" : "unknown";
    const companionPresent = companions.some((entry) => entry.companionId === route.companionId && entry.status === "present");
    return {
      setupId: route.id, installationId: route.installationId, displayName: route.displayName,
      strategy: route.strategy, status, companionPresent,
      recommended: status === "not-found" && companionPresent && request.preferences.enabled
        && !request.hiddenAgentIds.includes(route.installationId)
        && !request.preferences.dismissedSetupIds.includes(route.id)
        && !(request.preferences.snoozedUntil[route.id] > now)
        && !sessionSuppressed.has(route.id),
    };
  });
}
