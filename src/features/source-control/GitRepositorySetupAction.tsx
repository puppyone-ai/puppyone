export type GitRepositorySetupActionProps = Readonly<{
  title: string;
  label: string;
  pendingLabel: string;
  pending: boolean;
  error?: string | null;
  onEnable: () => unknown;
}>;

/** One calm, actionable empty state shared by Git right-sidebar surfaces. */
export function GitRepositorySetupAction({
  title,
  label,
  pendingLabel,
  pending,
  error = null,
  onEnable,
}: GitRepositorySetupActionProps) {
  return (
    <div className="desktop-git-repository-setup">
      <strong className="desktop-git-repository-setup-title">{title}</strong>
      <button
        className="desktop-version-control-enable-button desktop-git-repository-setup-action"
        type="button"
        disabled={pending}
        onClick={() => void onEnable()}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && (
        <small className="desktop-git-repository-setup-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
