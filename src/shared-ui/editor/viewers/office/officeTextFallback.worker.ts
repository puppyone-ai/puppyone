import {
  runOfficeTextFallbackWorkerTask,
  type OfficeTextFallbackWorkerRequest,
  type OfficeTextFallbackWorkerResponse,
} from "./officeTextFallbackTask";

type OfficeTextFallbackWorkerScope = {
  onmessage: ((event: MessageEvent<OfficeTextFallbackWorkerRequest>) => void) | null;
  postMessage: (
    response: OfficeTextFallbackWorkerResponse,
    transfer: Transferable[],
  ) => void;
};

const workerScope = self as unknown as OfficeTextFallbackWorkerScope;

workerScope.onmessage = (event) => {
  void runOfficeTextFallbackWorkerTask(
    event.data,
    (response, transfer) => workerScope.postMessage(response, transfer),
  );
};
