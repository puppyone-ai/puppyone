import { createTestArtifacts, finishTestArtifacts } from "./test-artifacts.mjs";

export default class SourceReceiptReporter {
  constructor({ directory }) { this.directory = directory; }
  onInit(context) { this.context = context; }
  async onTestRunStart() {
    if (!this.context?.config.watch) return;
    if (!this.started) { this.started = true; return; }
    // Each watch rerun is a fresh verification of the edited source. Point the
    // JSON reporter at its own destination before execution, preserving history.
    const artifacts = await createTestArtifacts({
      environment: { ...process.env, PUPPYONE_TEST_ARTIFACT_DIR: undefined, npm_lifecycle_event: "test-watch-cycle" },
    });
    this.directory = artifacts.directory;
    this.context.config.outputFile = { ...this.context.config.outputFile, json: artifacts.results };
    this.context.config.benchmark = { ...this.context.config.benchmark, outputJson: artifacts.benchmarks };
    this.context.config.coverage.reportsDirectory = artifacts.coverage;
    if (this.context.coverageProvider) this.context.coverageProvider.options.reportsDirectory = artifacts.coverage;
  }
  async onTestRunEnd(_modules, _errors, reason) {
    const receipt = await finishTestArtifacts(this.directory, { outcome: reason });
    if (receipt.sourceChanged) {
      throw new Error("Source changed during testing; this invocation cannot be used as verification evidence.");
    }
  }
}
