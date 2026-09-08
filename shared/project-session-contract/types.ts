export type ProjectSessionContext = Readonly<{
  projectId: string;
  generation: string;
  rootPath: string;
}>;

export type ProjectSession = ProjectSessionContext & Readonly<{
  state: "open" | "closing";
  failures: readonly string[];
}>;

export type ProjectSessionSnapshot = Readonly<{
  streamId: string;
  revision: number;
  projects: readonly ProjectSession[];
}>;

export type ProjectSessionFailure = Readonly<{
  projectFailure: { code: string; message: string; retryable: boolean };
}>;
