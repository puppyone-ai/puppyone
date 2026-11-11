import { net } from "electron";
import { createCloudAuthService } from "../cloud-auth-service.mjs";
import { createCloudNetwork } from "./cloud-api-client.mjs";

// Production and the real Electron regression share this composition. Auth
// cannot accidentally fall back to Node fetch when its options are assembled.
export function createDesktopCloudRuntime() {
  const network = createCloudNetwork({ fetchImpl: (input, init) => net.fetch(input, init) });
  return {
    requestCloudApi: network.requestCloudApi,
    createAuthService(options) {
      return createCloudAuthService({
        ...options, requestCloudApi: network.requestCloudApi, fetchImpl: network.fetch,
      });
    },
  };
}
