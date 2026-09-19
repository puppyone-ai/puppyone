import type { ModelConnectionCandidate, ModelConnectionSnapshot, SaveModelConnectionRequest } from "../../../../shared/model-connections/types";

export type ConnectionRevisionRequest = { id: string; expectedGeneration: number };
export interface ModelConnectionClientPort {
  read(): Promise<ModelConnectionSnapshot>;
  save(request: SaveModelConnectionRequest): Promise<ModelConnectionSnapshot>;
  remove(request: ConnectionRevisionRequest): Promise<ModelConnectionSnapshot>;
  refresh(request: { id: string }): Promise<ModelConnectionSnapshot>;
  verify(request: ConnectionRevisionRequest & { modelId: string }): Promise<ModelConnectionSnapshot>;
  discover(): Promise<ModelConnectionCandidate[]>;
  subscribe(listener: (snapshot: ModelConnectionSnapshot) => void): () => void;
}
