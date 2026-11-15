#!/usr/bin/env python3
"""Explicit real-deployment acceptance; ordinary checks send no invitation mail."""
import argparse
import os
from test_runner import run_gate

PREFIX = 'workspace::acceptance::'
CHECKS = {
    'project': dict(test=PREFIX + 'the_cloud_flows_work_against_the_real_deployment', timeout=900),
    'computers': dict(test='workspace::hosts::acceptance::two_computers_share_a_folder_through_the_real_cloud', timeout=600),
    # The deployment retains deleted projects for one hour before removing a space.
    'space': dict(test=PREFIX + 'the_v044_space_flows_work_against_the_real_deployment', timeout=5400),
    'invitation-email': dict(test=PREFIX + 'the_space_invitation_flow_sends_and_revokes_a_test_invitation', timeout=300),
}


def select_checks(names=None, *, allow_email=False):
    scope = list(dict.fromkeys(names or ['project', 'computers', 'space']))
    if any(name not in CHECKS for name in scope):
        raise ValueError('Unknown Cloud acceptance check')
    if 'invitation-email' in scope and not allow_email:
        raise ValueError('Invitation email requires explicit --allow-invitation-email approval')
    return scope


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', action='append', choices=CHECKS)
    parser.add_argument('--allow-invitation-email', action='store_true')
    args = parser.parse_args()
    try:
        scope = select_checks(args.only, allow_email=args.allow_invitation_email)
    except ValueError as error:
        parser.error(str(error))
    env = dict(os.environ, PUPPYONE_LIVE_EMAIL='1' if args.allow_invitation_email else '0')
    result = run_gate('cloud-acceptance', [dict(name=name, package='po-workspace', **CHECKS[name]) for name in scope], env=env, metadata={
        'scope': scope,
        'omittedChecks': sorted(set(CHECKS) - set(scope)),
        'qualification': 'Real test account and deployment. Project, device and space mutations use disposable resources and require cleanup. Invitations send actual email only with separate explicit opt-in. No GUI, browser login, payment, or cross-language Host interop is certified.',
    })
    raise SystemExit(0 if result['passed'] else 1)
