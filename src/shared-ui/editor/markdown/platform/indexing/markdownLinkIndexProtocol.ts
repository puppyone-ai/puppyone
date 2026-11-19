import type {
  MarkdownLinkGraphDocument,
  MarkdownLinkGraphIndexSnapshot,
} from "../../core/links/markdownLinkGraph";

export type MarkdownLinkIndexWorkerRequest =
  | {
      type: "initialize";
      requestId: number;
      operationId: number;
      documents: MarkdownLinkGraphDocument[];
    }
  | {
      type: "index-document";
      requestId: number;
      operationId: number;
      document: MarkdownLinkGraphDocument;
    }
  | {
      type: "snapshot";
      requestId: number;
      operationId: number;
    };

export type MarkdownLinkIndexWorkerResponse = {
  requestId: number;
  operationId: number;
  type: "ack" | "snapshot" | "error";
  index?: MarkdownLinkGraphIndexSnapshot;
  error?: string;
};
