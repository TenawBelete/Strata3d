# Security policy

## Reporting a vulnerability

Please do not report a security vulnerability in a public issue, discussion, or pull request. Use GitHub's private vulnerability reporting for this repository when it is enabled. If it is unavailable, contact the repository owner through GitHub and ask for a private channel.

Include the affected version or commit, the impact, and steps to reproduce. Avoid sending real credentials, personal data, or footage you do not have permission to share.

The maintainer will acknowledge reports, investigate them privately, and coordinate a fix before publishing technical details. Response time depends on maintainer availability.

## Exposed credentials

If a token or secret is committed, revoke or rotate it at the service that issued it immediately. Removing it from the latest commit does not remove it from Git history. Notify the maintainer privately so the history and any affected deployments can be reviewed.

## Scope

This policy covers the Strata3d source, build and deployment workflows, and project-controlled assets. It does not cover vulnerabilities in external providers or services, though reports about their impact on Strata are welcome.
