import {
  runOfficePackageValidationWorkerTask,
  type OfficePackageValidationWorkerRequest,
  type OfficePackageValidationWorkerResponse,
} from "./officePackageValidationTask";

type OfficePackageValidationWorkerScope = {
  onmessage: ((event: MessageEvent<OfficePackageValidationWorkerRequest>) => void) | null;
  postMessage: (
    response: OfficePackageValidationWorkerResponse,
    transfer: Transferable[],
  ) => void;
};

const workerScope = self as unknown as OfficePackageValidationWorkerScope;

workerScope.onmessage = (event) => {
  void runOfficePackageValidationWorkerTask(
    event.data,
    (response, transfer) => workerScope.postMessage(response, transfer),
  );
};
