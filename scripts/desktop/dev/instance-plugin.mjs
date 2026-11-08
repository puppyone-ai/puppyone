/** Keep the launcher from attaching Electron to another worktree's Vite server. */
export function developmentInstancePlugin({ token = process.env.PUPPYONE_DESKTOP_DEV_INSTANCE_TOKEN } = {}) {
  return {
    name: "puppyone-development-instance",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!token || request.url !== "/__puppyone_dev_instance") return next();
        response.setHeader("Content-Type", "text/plain");
        response.setHeader("Cache-Control", "no-store");
        response.end(token);
      });
    },
  };
}
