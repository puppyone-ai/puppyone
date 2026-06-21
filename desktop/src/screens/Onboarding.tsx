import { FolderPlus, ShieldCheck } from "lucide-react";

type OnboardingProps = {
  onChooseFolder: () => void;
};

export function Onboarding({ onChooseFolder }: OnboardingProps) {
  return (
    <main className="onboarding-screen">
      <section className="onboarding-panel">
        <div className="brand-mark large">
          <ShieldCheck size={24} strokeWidth={2.2} />
        </div>
        <div className="onboarding-copy">
          <h1>puppyone</h1>
          <p>See and undo everything your local agents change.</p>
        </div>
        <button className="primary-action" type="button" onClick={onChooseFolder}>
          <FolderPlus size={18} />
          <span>Choose protected folder</span>
        </button>
        <button className="secondary-action" type="button">
          Sync with puppyone Cloud
        </button>
      </section>
    </main>
  );
}
