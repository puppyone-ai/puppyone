import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { getCloudOrganizationAccess, inviteCloudSpaceMember, listCloudOrganizationMembers,
  removeCloudSpaceMember, transferCloudSpaceOwnership, updateCloudSpace, updateCloudSpaceMemberRole,
  type DesktopCloudOrgMember, type DesktopCloudSession } from "../../../lib/cloudApi";
import { SettingsSubsection, SettingsValueRow } from "../components";

/** Uses the existing owner-authorized API; membership never starts a hidden purchase. */
export function SpaceSettings({ session, organizationId, name, apiBaseUrl, onSessionChange, onChanged, focusInvite = false }: {
  session: DesktopCloudSession; organizationId: string; name: string; apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void; onChanged: () => void;
  focusInvite?: boolean;
}) {
  const { t } = useLocalization();
  const [members, setMembers] = useState<DesktopCloudOrgMember[]>([]);
  const [owner, setOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState(name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "member">("viewer");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [revision, setRevision] = useState(0);
  const inviteInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusInvite && owner && !loading) inviteInput.current?.focus();
  }, [focusInvite, owner, loading]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      listCloudOrganizationMembers(session, organizationId, onSessionChange, apiBaseUrl),
      getCloudOrganizationAccess(session, organizationId, onSessionChange, apiBaseUrl),
    ]).then(([rows, access]) => {
      if (active) { setMembers(rows); setOwner(access.can_manage_billing); setError(null); }
    }, (failure) => { if (active) { setError(String(failure)); setOwner(false); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiBaseUrl, onSessionChange, organizationId, revision, session]);

  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await operation(); setRevision((value) => value + 1); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  const disabled = busy || loading;
  return <>
    <SettingsSubsection>
      <SettingsValueRow label={t("settings.space.name")} value={owner
        ? <input aria-label={t("settings.space.name")} value={newName} maxLength={80} disabled={disabled}
            onChange={(event) => setNewName(event.target.value)} /> : name}
        action={owner && <button className="desktop-settings-action" type="button"
          disabled={disabled || !newName.trim() || newName.trim() === name}
          onClick={() => void run(() => updateCloudSpace(session, organizationId, newName.trim(), onSessionChange, apiBaseUrl))}>
          {t("settings.space.save")}</button>} />
      {members.map((member) => <SettingsValueRow key={member.user_id}
        label={member.display_name || member.email || member.user_id}
        value={t(`settings.space.role.${member.role}`)}
        action={owner && member.user_id !== session.user_id && member.role !== "owner" ? <span className="desktop-plan-inline-actions">
          <button className="desktop-settings-action" disabled={disabled} type="button"
            onClick={() => void run(() => updateCloudSpaceMemberRole(session, organizationId, member.user_id,
              member.role === "viewer" ? "member" : "viewer", onSessionChange, apiBaseUrl))}>
            {t(member.role === "viewer" ? "settings.space.makeMember" : "settings.space.makeViewer")}</button>
          <button className="desktop-settings-action" disabled={disabled} type="button"
            onClick={() => void run(() => removeCloudSpaceMember(session, organizationId, member.user_id, onSessionChange, apiBaseUrl))}>
            {t("settings.space.remove")}</button>
        </span> : undefined} />)}
      {loading && <p className="desktop-plan-note">{t("settings.plan.loading")}</p>}
      {owner && <form className="desktop-space-member-form" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const invite = await inviteCloudSpaceMember(session, organizationId, email.trim(), role, onSessionChange, apiBaseUrl);
          setInviteUrl(invite.invite_url ?? null); setEmail("");
        });
      }}>
        <input ref={inviteInput} type="email" required aria-label={t("settings.space.inviteEmail")} value={email} disabled={disabled}
          onChange={(event) => setEmail(event.target.value)} placeholder={t("settings.space.inviteEmail")} />
        <select aria-label={t("settings.space.inviteRole")} value={role} disabled={disabled}
          onChange={(event) => setRole(event.target.value as "viewer" | "member")}>
          <option value="viewer">{t("settings.space.role.viewer")}</option>
          <option value="member">{t("settings.space.role.member")}</option>
        </select>
        <button className="desktop-settings-action" disabled={disabled || !email.trim()} type="submit">{t("settings.space.invite")}</button>
      </form>}
      {owner && <p className="desktop-plan-note">{t("settings.space.seatNotice")}</p>}
      {inviteUrl && <SettingsValueRow label={t("settings.space.invitationLink")} value={<input readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />} />}
      {owner && members.some((member) => member.user_id !== session.user_id) && <SettingsValueRow
        label={t("settings.space.transfer")} value={<select aria-label={t("settings.space.transfer")} value={transferTo}
          disabled={disabled} onChange={(event) => setTransferTo(event.target.value)}>
          <option value="">{t("settings.space.chooseMember")}</option>
          {members.filter((member) => member.user_id !== session.user_id).map((member) => <option key={member.user_id} value={member.user_id}>
            {member.display_name || member.email || member.user_id}</option>)}
        </select>} action={<button className="desktop-settings-action" type="button" disabled={disabled || !transferTo}
          onClick={() => void run(() => transferCloudSpaceOwnership(session, organizationId, transferTo, onSessionChange, apiBaseUrl))}>
          {t("settings.space.confirmTransfer")}</button>} />}
    </SettingsSubsection>
    {error && <p className="desktop-plan-error" role="alert">{error}</p>}
  </>;
}
